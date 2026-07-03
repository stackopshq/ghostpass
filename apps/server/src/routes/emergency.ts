import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import type { EmergencyAccessRow, VaultItemRow } from "../types.js";
import { emergencyAccess, sessions, users, vaultItems } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { hashServerSecret, newId, normalizeEmail } from "../services/security.js";

// Accès d'urgence. Le serveur ne lit jamais l'USK (scellée pour le contact) ; il applique le
// DÉLAI : `/access` et `/takeover` ne libèrent quoi que ce soit qu'une fois l'accès accordé
// (approbation du grantor) ou le délai écoulé sans refus.
function accessAllowed(row: EmergencyAccessRow): boolean {
  if (row.status === "granted") return true;
  if (row.status === "requested" && row.requested_at != null) {
    return Date.now() >= row.requested_at + row.wait_days * 86_400_000;
  }
  return false;
}

function itemDto(row: VaultItemRow) {
  return { id: row.id, encryptedKey: row.encrypted_key, encryptedData: row.encrypted_data };
}

export function registerEmergencyRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Charge l'entrée et vérifie que l'appelant est bien le rôle attendu (anti-IDOR).
  const loadFor = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    who: "grantor" | "grantee",
  ): Promise<EmergencyAccessRow | null> => {
    const row = await emergencyAccess.findById(db, req.params.id);
    if (!row) {
      reply.code(404).send({ error: "introuvable" });
      return null;
    }
    const me = req.currentUser!.id;
    if ((who === "grantee" && row.grantee_id !== me) || (who === "grantor" && row.grantor_id !== me)) {
      reply.code(403).send({ error: "interdit" });
      return null;
    }
    return row;
  };

  // ─── Grantor : inviter un contact ───
  const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(["view", "takeover"]),
    waitDays: z.number().int().min(1).max(90),
    sealedUserKey: z.string().min(1),
  });
  app.post("/api/emergency", { preHandler: authenticate }, async (req, reply) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const me = req.currentUser!;
    const grantee = await users.findByEmail(db, normalizeEmail(parsed.data.email));
    if (!grantee) return reply.code(404).send({ error: "utilisateur introuvable" });
    if (grantee.id === me.id) return reply.code(400).send({ error: "impossible de s'inviter soi-même" });
    try {
      await emergencyAccess.create(db, {
        id: newId(),
        grantorId: me.id,
        granteeId: grantee.id,
        role: parsed.data.role,
        waitDays: parsed.data.waitDays,
        sealedUserKey: parsed.data.sealedUserKey,
      });
    } catch {
      return reply.code(409).send({ error: "contact déjà invité" });
    }
    await recordAudit(db, req, "emergency.grant", {
      userId: me.id,
      actorEmail: me.email,
      target: grantee.email,
    });
    return reply.code(201).send({ ok: true });
  });

  // ─── Liste (les deux directions) ───
  app.get("/api/emergency", { preHandler: authenticate }, async (req) => {
    const me = req.currentUser!.id;
    return {
      asGrantor: (await emergencyAccess.listAsGrantor(db, me)).map((r) => ({
        id: r.id,
        contactEmail: r.grantee_email,
        role: r.role,
        waitDays: r.wait_days,
        status: r.status,
        requestedAt: r.requested_at,
      })),
      asGrantee: (await emergencyAccess.listAsGrantee(db, me)).map((r) => ({
        id: r.id,
        contactEmail: r.grantor_email,
        role: r.role,
        waitDays: r.wait_days,
        status: r.status,
        requestedAt: r.requested_at,
        available: accessAllowed(r),
      })),
    };
  });

  // ─── Grantee : accepter / demander l'accès ───
  app.post<{ Params: { id: string } }>(
    "/api/emergency/:id/accept",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantee");
      if (!row) return;
      if (row.status !== "invited") return reply.code(409).send({ error: "déjà accepté" });
      await emergencyAccess.setStatus(db, row.id, "accepted");
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/emergency/:id/request",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantee");
      if (!row) return;
      if (row.status !== "accepted") return reply.code(409).send({ error: "état invalide" });
      await emergencyAccess.setRequested(db, row.id);
      await recordAudit(db, req, "emergency.request", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: row.id,
      });
      return { ok: true };
    },
  );

  // ─── Grantor : approuver / refuser une demande ───
  app.post<{ Params: { id: string } }>(
    "/api/emergency/:id/approve",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantor");
      if (!row) return;
      if (row.status !== "requested") return reply.code(409).send({ error: "aucune demande" });
      await emergencyAccess.setStatus(db, row.id, "granted");
      await recordAudit(db, req, "emergency.approve", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: row.id,
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/emergency/:id/reject",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantor");
      if (!row) return;
      if (row.status !== "requested") return reply.code(409).send({ error: "aucune demande" });
      await emergencyAccess.clearRequest(db, row.id);
      return { ok: true };
    },
  );

  // ─── Supprimer (grantor ou grantee) ───
  app.delete<{ Params: { id: string } }>(
    "/api/emergency/:id",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await emergencyAccess.findById(db, req.params.id);
      if (!row) return reply.code(404).send({ error: "introuvable" });
      const me = req.currentUser!.id;
      if (row.grantor_id !== me && row.grantee_id !== me) {
        return reply.code(403).send({ error: "interdit" });
      }
      await emergencyAccess.remove(db, row.id);
      return reply.code(204).send();
    },
  );

  // ─── Grantee : récupérer l'accès (USK scellée + coffre du grantor) si le délai est satisfait ───
  app.get<{ Params: { id: string } }>(
    "/api/emergency/:id/access",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantee");
      if (!row) return;
      if (!accessAllowed(row)) {
        return reply.code(403).send({ error: "accès non disponible (délai en cours ou non demandé)" });
      }
      const grantor = await users.findById(db, row.grantor_id);
      if (!grantor) return reply.code(404).send({ error: "grantor introuvable" });
      return {
        role: row.role,
        sealedUserKey: row.sealed_user_key,
        grantorPublicKey: grantor.public_key,
        grantorEmail: grantor.email,
        grantorKdfParams: grantor.kdf_params,
        items: (await vaultItems.listByUser(db, grantor.id)).map(itemDto),
      };
    },
  );

  // ─── Grantee (rôle takeover) : réinitialise le mot de passe maître du grantor ───
  const takeoverSchema = z.object({
    newMasterPasswordHash: z.string().min(1),
    newEncryptedUserKey: z.string().min(1),
  });
  app.post<{ Params: { id: string } }>(
    "/api/emergency/:id/takeover",
    { preHandler: authenticate },
    async (req, reply) => {
      const row = await loadFor(req, reply, "grantee");
      if (!row) return;
      if (row.role !== "takeover") return reply.code(403).send({ error: "takeover non autorisé" });
      if (!accessAllowed(row)) return reply.code(403).send({ error: "accès non disponible" });
      const parsed = takeoverSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const { hash, salt } = hashServerSecret(parsed.data.newMasterPasswordHash);
      await users.resetPassword(db, row.grantor_id, {
        serverPasswordHash: hash,
        passwordSalt: salt,
        encryptedUserKey: parsed.data.newEncryptedUserKey,
      });
      await sessions.deleteByUser(db, row.grantor_id); // révoque les sessions du grantor
      return { ok: true };
    },
  );
}
