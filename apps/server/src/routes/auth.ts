import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { sessions, users } from "../db/repositories.js";
import {
  createSessionToken,
  hashServerSecret,
  newId,
  verifyServerSecret,
} from "../services/security.js";
import { verifyTOTP } from "../services/totp.js";

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
});

export function registerAuthRoutes(app: FastifyInstance, db: DB): void {
  // Inscription : stocke les blobs chiffrés et ouvre une session.
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide", details: parsed.error.issues });
    }
    const body = parsed.data;

    if (users.findByEmail(db, body.email)) {
      return reply.code(409).send({ error: "email déjà utilisé" });
    }

    const { hash, salt } = hashServerSecret(body.masterPasswordHash);
    const userId = newId();
    users.create(db, {
      id: userId,
      email: body.email,
      kdfParams: body.kdfParams,
      serverPasswordHash: hash,
      passwordSalt: salt,
      encryptedUserKey: body.encryptedUserKey,
      encryptedPrivateKey: body.encryptedPrivateKey,
      publicKey: body.publicKey,
    });

    const { token, tokenHash } = createSessionToken();
    sessions.create(db, { id: newId(), userId, tokenHash, ttlMs: SESSION_TTL_MS });
    return reply.code(201).send({ userId, token });
  });

  // Pré-login : renvoie les paramètres KDF nécessaires au client pour dériver son hash.
  // Pour un email inconnu, on renvoie des paramètres par défaut (anti-énumération).
  app.post("/api/auth/prelogin", async (req, reply) => {
    const parsed = preloginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const user = users.findByEmail(db, parsed.data.email);
    return reply.send({ kdfParams: user ? user.kdf_params : DEFAULT_KDF_PARAMS });
  });

  // Connexion : vérifie le hash et renvoie le token + les blobs pour déverrouiller le coffre.
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const { email, masterPasswordHash, totpCode } = parsed.data;
    const user = users.findByEmail(db, email);
    // Réponse générique en cas d'échec (ne révèle pas si l'email existe).
    if (!user || !verifyServerSecret(masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "identifiants invalides" });
    }

    // Second facteur : si la 2FA est activée, un code TOTP valide est exigé.
    if (user.mfa_enabled) {
      if (!totpCode || !verifyTOTP(user.mfa_secret!, totpCode)) {
        return reply.code(401).send({ error: "code 2FA requis ou invalide", mfaRequired: true });
      }
    }

    const { token, tokenHash } = createSessionToken();
    sessions.create(db, { id: newId(), userId: user.id, tokenHash, ttlMs: SESSION_TTL_MS });
    return reply.send({
      token,
      kdfParams: user.kdf_params,
      encryptedUserKey: user.encrypted_user_key,
      encryptedPrivateKey: user.encrypted_private_key,
    });
  });
}
