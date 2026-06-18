import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { generateSecret, otpauthUri, verifyTOTP } from "../services/totp.js";

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export function registerMfaRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Démarre la configuration : génère un secret (non activé) + l'URI otpauth à scanner.
  app.post("/api/mfa/setup", { preHandler: authenticate }, async (req) => {
    const user = req.currentUser!;
    const secret = generateSecret();
    users.setMfaSecret(db, user.id, secret);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  });

  // Active la 2FA après vérification d'un premier code.
  app.post("/api/mfa/activate", { preHandler: authenticate }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "code invalide" });
    const user = req.currentUser!;
    if (!user.mfa_secret) {
      return reply.code(400).send({ error: "aucune configuration 2FA en cours" });
    }
    if (!verifyTOTP(user.mfa_secret, parsed.data.code)) {
      return reply.code(401).send({ error: "code 2FA invalide" });
    }
    users.setMfaEnabled(db, user.id, true);
    return { enabled: true };
  });

  // Désactive la 2FA (exige un code valide).
  app.post("/api/mfa/disable", { preHandler: authenticate }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "code invalide" });
    const user = req.currentUser!;
    if (!user.mfa_enabled || !user.mfa_secret || !verifyTOTP(user.mfa_secret, parsed.data.code)) {
      return reply.code(401).send({ error: "code 2FA invalide" });
    }
    users.setMfaEnabled(db, user.id, false);
    return { enabled: false };
  });
}
