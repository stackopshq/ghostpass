import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { organizations, orgItems, orgMembers, users } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { newId, normalizeEmail } from "../services/security.js";

const createOrgSchema = z.object({
  name: z.string().min(1),
  encryptedOrgKey: z.string().min(1), // Org Key scellée par le créateur pour lui-même
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "readonly"]),
  encryptedOrgKey: z.string().min(1), // Org Key scellée par l'admin pour ce membre
});

const rotateSchema = z.object({
  revokeUserId: z.string().optional(),
  members: z.array(z.object({ userId: z.string(), encryptedOrgKey: z.string().min(1) })),
  items: z.array(z.object({ id: z.string(), encryptedKey: z.string().min(1) })),
});

export function registerOrgRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Clé publique d'un utilisateur, pour qu'un admin lui scelle l'Org Key (partage).
  app.get<{ Querystring: { email?: string } }>(
    "/api/users/lookup",
    // Rate-limit dédié strict : limite l'énumération d'emails / récolte de clés publiques.
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const email = req.query.email ? normalizeEmail(req.query.email) : "";
      if (!email) return reply.code(400).send({ error: "email requis" });
      const user = await users.findByEmail(db, email);
      if (!user) return reply.code(404).send({ error: "utilisateur introuvable" });
      return { userId: user.id, publicKey: user.public_key };
    },
  );

  // Crée une organisation ; le créateur en devient l'admin (membre actif).
  app.post("/api/orgs", { preHandler: authenticate }, async (req, reply) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
    const me = req.currentUser!;
    const orgId = newId();
    await organizations.create(db, { id: orgId, name: parsed.data.name });
    await orgMembers.create(db, {
      id: newId(),
      orgId,
      userId: me.id,
      role: "admin",
      status: "active",
      encryptedOrgKey: parsed.data.encryptedOrgKey,
      sealedByUserId: me.id,
    });
    return reply.code(201).send({ orgId });
  });

  // Mes organisations (toutes, avec mon rôle et mon statut).
  app.get("/api/orgs", { preHandler: authenticate }, async (req) => {
    const rows = await orgMembers.listForUser(db, req.currentUser!.id);
    return {
      organizations: rows.map((r) => ({
        orgId: r.org_id,
        name: r.name,
        role: r.role,
        status: r.status,
      })),
    };
  });

  // Ajoute un membre (admin uniquement) ; l'admin a déjà scellé l'Org Key pour lui (via WASM).
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/members",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = addMemberSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const me = await orgMembers.findByOrgAndUser(db, req.params.id, req.currentUser!.id);
      if (!me || me.status !== "active" || me.role !== "admin") {
        return reply.code(403).send({ error: "réservé à l'administrateur de l'organisation" });
      }
      const invitee = await users.findByEmail(db, normalizeEmail(parsed.data.email));
      if (!invitee) return reply.code(404).send({ error: "utilisateur introuvable" });
      if (await orgMembers.findByOrgAndUser(db, req.params.id, invitee.id)) {
        return reply.code(409).send({ error: "déjà membre" });
      }
      await orgMembers.create(db, {
        id: newId(),
        orgId: req.params.id,
        userId: invitee.id,
        role: parsed.data.role,
        status: "invited",
        encryptedOrgKey: parsed.data.encryptedOrgKey,
        sealedByUserId: req.currentUser!.id,
      });
      await recordAudit(db, req, "org.member.add", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: invitee.email,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // Accepter une invitation : le membre courant passe « actif ».
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/accept",
    { preHandler: authenticate },
    async (req, reply) => {
      const m = await orgMembers.findByOrgAndUser(db, req.params.id, req.currentUser!.id);
      if (!m) return reply.code(404).send({ error: "aucune invitation" });
      if (m.status !== "invited") return reply.code(409).send({ error: "déjà membre" });
      await orgMembers.setActive(db, m.id);
      return { status: "active" };
    },
  );

  // Mon adhésion : ma clé d'org scellée + la clé publique de l'admin émetteur (pour `open_org`).
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/membership",
    { preHandler: authenticate },
    async (req, reply) => {
      const m = await orgMembers.findByOrgAndUser(db, req.params.id, req.currentUser!.id);
      if (!m) return reply.code(404).send({ error: "non membre" });
      const sealedBy = m.sealed_by_user_id ? await users.findById(db, m.sealed_by_user_id) : undefined;
      return {
        role: m.role,
        status: m.status,
        encryptedOrgKey: m.encrypted_org_key,
        sealedByPublicKey: sealedBy ? sealedBy.public_key : null,
      };
    },
  );

  // Liste des membres (admin uniquement).
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/members",
    { preHandler: authenticate },
    async (req, reply) => {
      const me = await orgMembers.findByOrgAndUser(db, req.params.id, req.currentUser!.id);
      if (!me || me.status !== "active" || me.role !== "admin") {
        return reply.code(403).send({ error: "réservé à l'administrateur de l'organisation" });
      }
      const rows = await orgMembers.listByOrg(db, req.params.id);
      const members = await Promise.all(
        rows.map(async (m) => {
          const u = await users.findById(db, m.user_id);
          return {
            userId: m.user_id,
            email: u?.email ?? null,
            publicKey: u?.public_key ?? null,
            role: m.role,
            status: m.status,
          };
        }),
      );
      return { members };
    },
  );

  // Rotation d'Org Key (révocation effective d'un membre). L'admin a régénéré la clé côté
  // client, l'a re-scellée pour les membres restants et a ré-enveloppé les items ; le serveur
  // applique le tout atomiquement.
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/rotate",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = rotateSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const me = await orgMembers.findByOrgAndUser(db, req.params.id, req.currentUser!.id);
      if (!me || me.status !== "active" || me.role !== "admin") {
        return reply.code(403).send({ error: "réservé à l'administrateur de l'organisation" });
      }
      const { revokeUserId, members, items } = parsed.data;
      if (revokeUserId === req.currentUser!.id) {
        return reply.code(400).send({ error: "impossible de se révoquer soi-même" });
      }
      const adminId = req.currentUser!.id;
      const validItemIds = new Set(
        (await orgItems.listByOrg(db, req.params.id)).map((i) => i.id),
      );

      await db.transaction().execute(async (trx) => {
        if (revokeUserId)
          await orgMembers.remove(trx, { orgId: req.params.id, userId: revokeUserId });
        for (const m of members) {
          await orgMembers.setKey(trx, {
            orgId: req.params.id,
            userId: m.userId,
            encryptedOrgKey: m.encryptedOrgKey,
            sealedByUserId: adminId,
          });
        }
        for (const it of items) {
          if (validItemIds.has(it.id)) {
            await orgItems.setEncryptedKey(trx, { id: it.id, encryptedKey: it.encryptedKey });
          }
        }
      });

      await recordAudit(db, req, "org.key.rotate", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: revokeUserId || req.params.id,
      });
      return { ok: true };
    },
  );
}
