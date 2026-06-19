import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { loginEvents, sessions, users, webauthnCredentials } from "../db/repositories.js";
import { ORIGIN, RP_ID, putChallenge, takeChallenge } from "../services/webauthn.js";
import { makeAuthenticate } from "../plugins/auth.js";
import {
  createSessionToken,
  dummyVerify,
  hashServerSecret,
  hashSessionToken,
  newId,
  normalizeEmail,
  verifyServerSecret,
} from "../services/security.js";
import { verifyAndConsumeTotp } from "../services/mfa.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours
const DEFAULT_KDF_PARAMS = JSON.stringify({
  mem_cost_kib: 65536,
  time_cost: 3,
  parallelism: 4,
});

const registerSchema = z.object({
  email: z.string().email(),
  masterPasswordHash: z.string().min(1),
  kdfParams: z.string().min(1),
  encryptedUserKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  publicKey: z.string().min(1),
});

const preloginSchema = z.object({ email: z.string().email() });
const loginSchema = z.object({
  email: z.string().email(),
  masterPasswordHash: z.string().min(1),
  totpCode: z.string().optional(),
  webauthnResponse: z.any().optional(),
});

export function registerAuthRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Enregistre une connexion (historique / détection d'anomalies).
  const recordLogin = (req: { ip: string; headers: Record<string, unknown> }, userId: string) => {
    const ua = String(req.headers["user-agent"] ?? "inconnu").slice(0, 300);
    return loginEvents.record(db, { id: newId(), userId, ip: req.ip, userAgent: ua });
  };

  // Inscription : stocke les blobs chiffrés et ouvre une session.
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const body = parsed.data;
    const email = normalizeEmail(body.email);

    if (users.findByEmail(db, email)) {
      return reply.code(409).send({ error: "email déjà utilisé" });
    }

    const { hash, salt } = hashServerSecret(body.masterPasswordHash);
    const userId = newId();
    users.create(db, {
      id: userId,
      email,
      kdfParams: body.kdfParams,
      serverPasswordHash: hash,
      passwordSalt: salt,
      encryptedUserKey: body.encryptedUserKey,
      encryptedPrivateKey: body.encryptedPrivateKey,
      publicKey: body.publicKey,
    });

    recordLogin(req, userId);
    const { token, tokenHash } = createSessionToken();
    sessions.create(db, { id: newId(), userId, tokenHash, ttlMs: SESSION_TTL_MS });
    return reply.code(201).send({ userId, token });
  });

  // Pré-login : renvoie les paramètres KDF nécessaires au client pour dériver son hash.
  // Pour un email inconnu, on renvoie des paramètres par défaut (anti-énumération).
  app.post(
    "/api/auth/prelogin",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const parsed = preloginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const user = users.findByEmail(db, normalizeEmail(parsed.data.email));
    return reply.send({ kdfParams: user ? user.kdf_params : DEFAULT_KDF_PARAMS });
  });

  // Connexion : vérifie le hash et renvoie le token + les blobs pour déverrouiller le coffre.
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const { masterPasswordHash, totpCode, webauthnResponse } = parsed.data;
    const email = normalizeEmail(parsed.data.email);
    const user = users.findByEmail(db, email);
    // Réponse générique + scrypt à temps égal même si l'email est inconnu (anti-énumération
    // par timing : on ne court-circuite pas le coût scrypt).
    if (!user) {
      dummyVerify(masterPasswordHash);
      return reply.code(401).send({ error: "identifiants invalides" });
    }
    if (!verifyServerSecret(masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "identifiants invalides" });
    }

    // Second facteur. Priorité à WebAuthn (clé de sécurité) si l'utilisateur en a enregistré une,
    // sinon TOTP. Le master password a déjà été vérifié → pas d'oracle d'énumération ici.
    const creds = webauthnCredentials.listByUser(db, user.id);
    if (creds.length > 0) {
      if (!webauthnResponse) {
        const options = await generateAuthenticationOptions({
          rpID: RP_ID,
          allowCredentials: creds.map((c) => ({
            id: c.id,
            transports: c.transports ? (JSON.parse(c.transports) as never) : undefined,
          })),
          userVerification: "preferred",
        });
        putChallenge(`auth:${user.id}`, options.challenge);
        return reply.code(401).send({ mfaRequired: true, mfaType: "webauthn", options });
      }
      const expectedChallenge = takeChallenge(`auth:${user.id}`);
      const cred =
        typeof webauthnResponse?.id === "string"
          ? webauthnCredentials.findById(db, webauthnResponse.id)
          : undefined;
      if (!expectedChallenge || !cred || cred.user_id !== user.id) {
        return reply.code(401).send({ error: "authentification 2FA échouée" });
      }
      try {
        const v = await verifyAuthenticationResponse({
          response: webauthnResponse,
          expectedChallenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: false,
          credential: {
            id: cred.id,
            publicKey: new Uint8Array(Buffer.from(cred.public_key, "base64url")),
            counter: cred.counter,
            transports: cred.transports ? (JSON.parse(cred.transports) as never) : undefined,
          },
        });
        if (!v.verified) return reply.code(401).send({ error: "authentification 2FA échouée" });
        webauthnCredentials.updateCounter(db, cred.id, v.authenticationInfo.newCounter);
      } catch {
        return reply.code(401).send({ error: "authentification 2FA échouée" });
      }
    } else if (user.mfa_enabled) {
      if (!totpCode || !verifyAndConsumeTotp(db, user, totpCode)) {
        return reply
          .code(401)
          .send({ error: "code 2FA requis ou invalide", mfaRequired: true, mfaType: "totp" });
      }
    }

    recordLogin(req, user.id);
    const { token, tokenHash } = createSessionToken();
    sessions.create(db, { id: newId(), userId: user.id, tokenHash, ttlMs: SESSION_TTL_MS });
    return reply.send({
      token,
      kdfParams: user.kdf_params,
      encryptedUserKey: user.encrypted_user_key,
      encryptedPrivateKey: user.encrypted_private_key,
    });
  });

  // Historique des connexions (appareil/IP/date) — pour repérer un accès inhabituel.
  app.get("/api/account/activity", { preHandler: authenticate }, async (req) => {
    const events = loginEvents.listByUser(db, req.currentUser!.id);
    return {
      events: events.map((e) => ({
        ip: e.ip,
        userAgent: e.user_agent,
        newDevice: e.new_device === 1,
        createdAt: e.created_at,
      })),
    };
  });

  // Déconnexion : révoque la session courante (le token n'est plus valide ensuite).
  app.post("/api/auth/logout", async (req, reply) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      sessions.deleteByTokenHash(db, hashSessionToken(header.slice("Bearer ".length).trim()));
    }
    return reply.code(204).send();
  });
}
