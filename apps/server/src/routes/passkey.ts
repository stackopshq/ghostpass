import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { DB } from "../db/database.js";
import { passkeys, sessions, users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { ORIGIN, RP_ID, RP_NAME, putChallenge, takeChallenge } from "../services/webauthn.js";
import { createSessionToken, newId, normalizeEmail } from "../services/security.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const toB64Url = (u: Uint8Array): string => Buffer.from(u).toString("base64url");

function parseTransports(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const t = JSON.parse(json);
    return Array.isArray(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

// Passkeys de déverrouillage SANS mot de passe. Le serveur fait du WebAuthn standard ; l'extension
// PRF (qui dérive le secret enveloppant l'USK) est gérée CÔTÉ CLIENT. Le serveur ne voit que la
// clé publique du credential et l'USK déjà enveloppée par le PRF (illisible pour lui).
export function registerPasskeyRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // ─── Enrôlement (utilisateur déverrouillé) ───
  app.post(
    "/api/passkey/register/options",
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const user = req.currentUser!;
      const existing = passkeys.listByUser(db, user.id);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({
          id: c.id,
          transports: parseTransports(c.transports) as never,
        })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      putChallenge(`pkreg:${user.id}`, options.challenge);
      return options;
    },
  );

  const verifySchema = z.object({
    response: z.any(),
    name: z.string().min(1).max(64).optional(),
    prfWrappedUserKey: z.string().min(1),
  });
  app.post("/api/passkey/register/verify", { preHandler: authenticate }, async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = req.currentUser!;
    const expectedChallenge = takeChallenge(`pkreg:${user.id}`);
    if (!expectedChallenge) return reply.code(400).send({ error: "challenge expiré" });
    try {
      const verification = await verifyRegistrationResponse({
        response: parsed.data.response,
        expectedChallenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: "vérification échouée" });
      }
      const cred = verification.registrationInfo.credential;
      passkeys.create(db, {
        id: cred.id,
        userId: user.id,
        publicKey: toB64Url(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports ? JSON.stringify(cred.transports) : null,
        name: parsed.data.name?.trim() || "Passkey",
        prfWrappedUserKey: parsed.data.prfWrappedUserKey,
      });
      return reply.code(201).send({ ok: true });
    } catch {
      return reply.code(400).send({ error: "vérification échouée" });
    }
  });

  app.get("/api/passkey/credentials", { preHandler: authenticate }, async (req) => {
    return {
      credentials: passkeys
        .listByUser(db, req.currentUser!.id)
        .map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at })),
    };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/passkey/credentials/:id",
    { preHandler: authenticate },
    async (req, reply) => {
      const ok = passkeys.remove(db, { id: req.params.id, userId: req.currentUser!.id });
      if (!ok) return reply.code(404).send({ error: "passkey introuvable" });
      return reply.code(204).send();
    },
  );

  // ─── Login passwordless ───
  const optionsSchema = z.object({ email: z.string().email() });
  app.post(
    "/api/auth/passkey/options",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = optionsSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const email = normalizeEmail(parsed.data.email);
      const user = users.findByEmail(db, email);
      const creds = user ? passkeys.listByUser(db, user.id) : [];
      if (!user || creds.length === 0) {
        return reply.code(404).send({ error: "aucune passkey pour ce compte" });
      }
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: creds.map((c) => ({
          id: c.id,
          transports: parseTransports(c.transports) as never,
        })),
        userVerification: "preferred",
      });
      putChallenge(`pklogin:${email}`, options.challenge);
      return options;
    },
  );

  const loginSchema = z.object({ email: z.string().email(), response: z.any() });
  app.post(
    "/api/auth/passkey/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const email = normalizeEmail(parsed.data.email);
      const user = users.findByEmail(db, email);
      const expectedChallenge = takeChallenge(`pklogin:${email}`);
      const cred =
        typeof parsed.data.response?.id === "string"
          ? passkeys.findById(db, parsed.data.response.id)
          : undefined;
      if (!user || !expectedChallenge || !cred || cred.user_id !== user.id) {
        return reply.code(401).send({ error: "authentification par passkey échouée" });
      }
      try {
        const v = await verifyAuthenticationResponse({
          response: parsed.data.response,
          expectedChallenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: false,
          credential: {
            id: cred.id,
            publicKey: new Uint8Array(Buffer.from(cred.public_key, "base64url")),
            counter: cred.counter,
            transports: parseTransports(cred.transports) as never,
          },
        });
        if (!v.verified) return reply.code(401).send({ error: "authentification par passkey échouée" });
        passkeys.updateCounter(db, cred.id, v.authenticationInfo.newCounter);
      } catch {
        return reply.code(401).send({ error: "authentification par passkey échouée" });
      }

      const { token, tokenHash } = createSessionToken();
      sessions.create(db, { id: newId(), userId: user.id, tokenHash, ttlMs: SESSION_TTL_MS });
      // Le client déverrouille l'USK avec le secret PRF + ces deux blobs.
      return reply.send({
        token,
        prfWrappedUserKey: cred.prf_wrapped_user_key,
        encryptedPrivateKey: user.encrypted_private_key,
      });
    },
  );
}
