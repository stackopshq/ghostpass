import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { sessions, users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { hashServerSecret, verifyServerSecret } from "../services/security.js";

const enrollSchema = z.object({
  recoveryAuthHash: z.string().min(1),
  encryptedUserKeyRecovery: z.string().min(1),
});

const blobSchema = z.object({ email: z.string().email() });

const recoverSchema = z.object({
  email: z.string().email(),
  recoveryAuthHash: z.string().min(1),
  newMasterPasswordHash: z.string().min(1),
  newEncryptedUserKey: z.string().min(1),
});

export function registerRecoveryRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Active/enregistre le kit de récupération (la preuve est re-hachée avant stockage).
  app.post("/api/account/recovery", { preHandler: authenticate }, async (req, reply) => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const { hash, salt } = hashServerSecret(parsed.data.recoveryAuthHash);
    users.setRecovery(db, req.currentUser!.id, {
      encryptedUserKeyRecovery: parsed.data.encryptedUserKeyRecovery,
      recoveryAuthHash: hash,
      recoverySalt: salt,
    });
    return reply.code(201).send({ ok: true });
  });

  // Renvoie les blobs nécessaires pour tenter une récupération (chiffrés : sans valeur seuls).
  app.post("/api/auth/recovery-blob", async (req, reply) => {
    const parsed = blobSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = users.findByEmail(db, parsed.data.email);
    if (!user || !user.encrypted_user_key_recovery) {
      return reply.code(404).send({ error: "aucune récupération disponible" });
    }
    return reply.send({
      kdfParams: user.kdf_params,
      encryptedUserKeyRecovery: user.encrypted_user_key_recovery,
      encryptedPrivateKey: user.encrypted_private_key,
    });
  });

  // Réinitialise le mot de passe maître après preuve de possession de la clé de récupération.
  app.post("/api/auth/recover", async (req, reply) => {
    const parsed = recoverSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = users.findByEmail(db, parsed.data.email);
    if (
      !user ||
      !user.recovery_auth_hash ||
      !user.recovery_salt ||
      !verifyServerSecret(parsed.data.recoveryAuthHash, user.recovery_auth_hash, user.recovery_salt)
    ) {
      return reply.code(401).send({ error: "clé de récupération invalide" });
    }

    const { hash, salt } = hashServerSecret(parsed.data.newMasterPasswordHash);
    users.resetPassword(db, user.id, {
      serverPasswordHash: hash,
      passwordSalt: salt,
      encryptedUserKey: parsed.data.newEncryptedUserKey,
    });
    // Toutes les sessions existantes sont invalidées par sécurité.
    sessions.deleteByUser(db, user.id);
    return reply.send({ ok: true });
  });
}
