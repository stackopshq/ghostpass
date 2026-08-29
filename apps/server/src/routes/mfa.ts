import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { verifyAndConsumeTotp } from "../services/mfa.js";
import { verifyServerSecret } from "../services/security.js";
import { generateSecret, otpauthUri, verifyTOTP } from "../services/totp.js";

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const setupSchema = z.object({ masterPasswordHash: z.string().min(1) });
const disableSchema = z.object({
  masterPasswordHash: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export function registerMfaRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // État de la 2FA. Sans lui, un client ne peut pas distinguer « activer » de
  // « désactiver » — et proposer « activer » à quelqu'un qui l'a déjà remettrait son
  // secret à zéro sans prévenir, puisque c'est ce que fait `/setup`. La question paraît
  // anodine ; c'est elle qui empêche de détruire une configuration en place.
  app.get("/api/mfa", { preHandler: authenticate }, async (req) => {
    const user = req.currentUser!;
    return { enabled: user.mfa_enabled === 1 };
  });

  // Démarre la configuration : re-authentification par mot de passe exigée (opération
  // sensible — elle remet la 2FA à zéro), puis génère un secret + l'URI otpauth.
  app.post("/api/mfa/setup", { preHandler: authenticate }, async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = req.currentUser!;
    if (!verifyServerSecret(parsed.data.masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "mot de passe invalide" });
    }
    const secret = generateSecret();
    await users.setMfaSecret(db, user.id, secret);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  });

  // Active la 2FA après vérification (et consommation) d'un premier code.
  app.post("/api/mfa/activate", { preHandler: authenticate }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "code invalide" });
    const user = req.currentUser!;
    const secret = user.mfa_secret;
    if (!secret) {
      return reply.code(400).send({ error: "aucune configuration 2FA en cours" });
    }
    // À l'activation, on vérifie sans consommer le compteur (session déjà exigée) afin que le
    // tout premier login juste après reste possible avec un code de la même fenêtre.
    if (!verifyTOTP(secret, parsed.data.code)) {
      return reply.code(401).send({ error: "code 2FA invalide" });
    }
    await users.setMfaEnabled(db, user.id, true);
    await recordAudit(db, req, "mfa.enable", { userId: user.id, actorEmail: user.email });
    return { enabled: true };
  });

  // Désactive la 2FA : exige le mot de passe ET un code TOTP valide (non rejoué).
  app.post("/api/mfa/disable", { preHandler: authenticate }, async (req, reply) => {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = req.currentUser!;
    if (!verifyServerSecret(parsed.data.masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "mot de passe invalide" });
    }
    if (!user.mfa_enabled || !await verifyAndConsumeTotp(db, user, parsed.data.code)) {
      return reply.code(401).send({ error: "code 2FA invalide" });
    }
    await users.setMfaEnabled(db, user.id, false);
    await recordAudit(db, req, "mfa.disable", { userId: user.id, actorEmail: user.email });
    return { enabled: false };
  });
}
