import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { verifierLeSecondFacteur } from "../services/mfa.js";
import type { ResultatSecondFacteur } from "../services/mfa.js";
import {
  compterLesCodesRestants,
  genererLesCodes,
  remplacerLesCodes,
  retirerLesCodes,
} from "../services/recoveryCodes.js";
import { dechiffrerAuRepos } from "../services/secretAtRest.js";
import { verifyServerSecret } from "../services/security.js";
import { generateSecret, otpauthUri, verifyTOTP } from "../services/totp.js";

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const setupSchema = z.object({ masterPasswordHash: z.string().min(1) });
/// Le code peut être un TOTP à six chiffres OU un code de récupération : qui a
/// perdu son téléphone doit pouvoir retirer le second facteur, sans quoi le
/// filet ne servirait qu'à se connecter et jamais à sortir de la situation.
const disableSchema = z.object({
  masterPasswordHash: z.string().min(1),
  code: z.string().min(1).max(32),
});

/// Réponse commune à un second facteur refusé. Le blocage rend 429 et non 401 :
/// « trop d'essais » n'est pas « mauvais code », et les confondre fait tourner
/// un client légitime en boucle sur une saisie qui ne peut plus aboutir.
function refus(reply: FastifyReply, verdict: Exclude<ResultatSecondFacteur, { ok: true }>) {
  if (verdict.raison === "bloque") {
    return reply
      .code(429)
      .send({ error: "trop d'essais sur le second facteur", lockedUntil: verdict.jusqua });
  }
  return reply.code(401).send({ error: "code 2FA invalide" });
}

export function registerMfaRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // État de la 2FA. Sans lui, un client ne peut pas distinguer « activer » de
  // « désactiver » — et proposer « activer » à quelqu'un qui l'a déjà remettrait son
  // secret à zéro sans prévenir, puisque c'est ce que fait `/setup`. La question paraît
  // anodine ; c'est elle qui empêche de détruire une configuration en place.
  //
  // `recoveryCodesRemaining` s'y ajoute pour que l'interface puisse prévenir
  // AVANT que la réserve soit vide — le moment où l'utilisateur se croit
  // protégé et n'a plus de porte de sortie.
  app.get("/api/mfa", { preHandler: authenticate }, async (req) => {
    const user = req.currentUser!;
    return {
      enabled: user.mfa_enabled === 1,
      recoveryCodesRemaining: await compterLesCodesRestants(db, user.id),
    };
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
    // Les codes de l'ancien secret ne doivent pas survivre au nouveau : ils
    // ouvriraient une porte que leur propriétaire croit refermée.
    await retirerLesCodes(db, user.id);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  });

  // Active la 2FA après vérification (et consommation) d'un premier code.
  app.post("/api/mfa/activate", { preHandler: authenticate }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "code invalide" });
    const user = req.currentUser!;
    const secret = user.mfa_secret ? dechiffrerAuRepos(user.mfa_secret) : null;
    if (!secret) {
      return reply.code(400).send({ error: "aucune configuration 2FA en cours" });
    }
    // À l'activation, on vérifie sans consommer le compteur (session déjà exigée) afin que le
    // tout premier login juste après reste possible avec un code de la même fenêtre.
    if (!verifyTOTP(secret, parsed.data.code)) {
      return reply.code(401).send({ error: "code 2FA invalide" });
    }
    await users.setMfaEnabled(db, user.id, true);

    // Les codes de récupération sont rendus ICI et nulle part ailleurs : seules
    // leurs empreintes sont gardées, donc ni le support ni nous ne pourrons les
    // réafficher. C'est le prix de ne pas les détenir.
    const codes = genererLesCodes();
    await remplacerLesCodes(db, user.id, codes);

    await recordAudit(db, req, "mfa.enable", { userId: user.id, actorEmail: user.email });
    return { enabled: true, recoveryCodes: codes };
  });

  // Désactive la 2FA : exige le mot de passe ET un code valide (non rejoué).
  app.post("/api/mfa/disable", { preHandler: authenticate }, async (req, reply) => {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = req.currentUser!;
    if (!verifyServerSecret(parsed.data.masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "mot de passe invalide" });
    }
    if (!user.mfa_enabled) return reply.code(401).send({ error: "code 2FA invalide" });
    const verdict = await verifierLeSecondFacteur(db, user, parsed.data.code);
    if (!verdict.ok) return refus(reply, verdict);

    await users.setMfaEnabled(db, user.id, false);
    // La réserve part avec la porte : la laisser derrière ferait qu'un
    // réenrôlement plus tard hériterait de codes que l'utilisateur croit périmés.
    await retirerLesCodes(db, user.id);
    await recordAudit(db, req, "mfa.disable", { userId: user.id, actorEmail: user.email });
    return { enabled: false };
  });

  // Refait la réserve de codes de récupération. Les anciens cessent de valoir
  // à cet instant.
  //
  // Nécessaire, et pas un confort : les codes ne sont montrés qu'une fois. Qui
  // perd sa feuille, ou qui en a consommé la moitié, n'a aucun autre moyen de
  // retrouver un filet plein sans désactiver puis réactiver tout le second
  // facteur — c'est-à-dire sans passer par un moment où le compte n'est plus
  // protégé du tout.
  app.post("/api/mfa/recovery-codes", { preHandler: authenticate }, async (req, reply) => {
    const parsed = disableSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const user = req.currentUser!;
    if (!verifyServerSecret(parsed.data.masterPasswordHash, user.server_password_hash, user.password_salt)) {
      return reply.code(401).send({ error: "mot de passe invalide" });
    }
    if (!user.mfa_enabled) return reply.code(409).send({ error: "2FA non activée" });
    const verdict = await verifierLeSecondFacteur(db, user, parsed.data.code);
    if (!verdict.ok) return refus(reply, verdict);

    const codes = genererLesCodes();
    await remplacerLesCodes(db, user.id, codes);
    await recordAudit(db, req, "mfa.recovery.regenerate", {
      userId: user.id,
      actorEmail: user.email,
    });
    return { recoveryCodes: codes };
  });
}
