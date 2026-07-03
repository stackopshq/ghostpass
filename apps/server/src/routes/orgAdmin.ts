import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import type { OrgMemberRow } from "../types.js";
import {
  collections,
  groupCollectionAccess,
  orgGroupMembers,
  orgGroups,
  orgMembers,
  users,
} from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { recordAudit } from "../services/audit.js";
import { newId } from "../services/security.js";

// Console d'administration d'organisation (backend). Réservé aux **admins** d'org : groupes
// (membres + accès collections) et gestion des rôles. Pur contrôle d'accès — aucune crypto :
// la décryption reste via l'Org Key distribuée à tous les membres actifs.
export function registerOrgAdminRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  /// Renvoie le membre s'il est admin actif de l'org, sinon null (→ 403 par l'appelant).
  async function admin(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const m = await orgMembers.findByOrgAndUser(db, orgId, userId);
    return m && m.status === "active" && m.role === "admin" ? m : null;
  }

  const nameSchema = z.object({ name: z.string().min(1).max(64) });
  const userIdSchema = z.object({ userId: z.string().min(1) });
  const permSchema = z.object({ permission: z.enum(["read", "write", "manage"]) });
  const roleSchema = z.object({ role: z.enum(["admin", "member", "readonly"]) });

  // ─── Groupes ───

  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/groups",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const id = newId();
      await orgGroups.create(db, { id, orgId: req.params.id, name: parsed.data.name.trim() });
      await recordAudit(db, req, "org.group.create", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: parsed.data.name.trim(),
      });
      return reply.code(201).send({ id, name: parsed.data.name.trim() });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/groups",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const groups = await orgGroups.listByOrg(db, req.params.id);
      const withDetails = await Promise.all(
        groups.map(async (g) => ({
          id: g.id,
          name: g.name,
          members: (await orgGroupMembers.listByGroup(db, g.id)).map((m) => ({
            userId: m.user_id,
            email: m.email,
          })),
          collections: (await groupCollectionAccess.listByGroup(db, g.id)).map((a) => ({
            collectionId: a.collection_id,
            permission: a.permission,
          })),
        })),
      );
      return { groups: withDetails };
    },
  );

  app.delete<{ Params: { id: string; gid: string } }>(
    "/api/orgs/:id/groups/:gid",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const group = await orgGroups.findById(db, req.params.gid);
      if (!group || group.org_id !== req.params.id)
        return reply.code(404).send({ error: "groupe introuvable" });
      await orgGroups.remove(db, group.id);
      await recordAudit(db, req, "org.group.delete", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: group.name,
      });
      return reply.code(204).send();
    },
  );

  // ─── Membres d'un groupe ───

  app.post<{ Params: { id: string; gid: string } }>(
    "/api/orgs/:id/groups/:gid/members",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const parsed = userIdSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const group = await orgGroups.findById(db, req.params.gid);
      if (!group || group.org_id !== req.params.id)
        return reply.code(404).send({ error: "groupe introuvable" });
      const target = await orgMembers.findByOrgAndUser(db, req.params.id, parsed.data.userId);
      if (!target) return reply.code(400).send({ error: "cet utilisateur n'est pas membre de l'org" });
      await orgGroupMembers.add(db, { id: newId(), groupId: group.id, userId: parsed.data.userId });
      const u = await users.findById(db, parsed.data.userId);
      await recordAudit(db, req, "org.group.member.add", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: u?.email ?? parsed.data.userId,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; gid: string; userId: string } }>(
    "/api/orgs/:id/groups/:gid/members/:userId",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const group = await orgGroups.findById(db, req.params.gid);
      if (!group || group.org_id !== req.params.id)
        return reply.code(404).send({ error: "groupe introuvable" });
      const removed = await orgGroupMembers.remove(db, {
        groupId: group.id,
        userId: req.params.userId,
      });
      if (!removed) return reply.code(404).send({ error: "membre du groupe introuvable" });
      const u = await users.findById(db, req.params.userId);
      await recordAudit(db, req, "org.group.member.remove", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: u?.email ?? req.params.userId,
      });
      return reply.code(204).send();
    },
  );

  // ─── Accès d'un groupe à une collection ───

  app.post<{ Params: { id: string; gid: string; cid: string } }>(
    "/api/orgs/:id/groups/:gid/collections/:cid",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const parsed = permSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const group = await orgGroups.findById(db, req.params.gid);
      if (!group || group.org_id !== req.params.id)
        return reply.code(404).send({ error: "groupe introuvable" });
      const collection = await collections.findById(db, req.params.cid);
      if (!collection || collection.org_id !== req.params.id)
        return reply.code(404).send({ error: "collection introuvable" });
      await groupCollectionAccess.grant(db, {
        id: newId(),
        groupId: group.id,
        collectionId: collection.id,
        permission: parsed.data.permission,
      });
      await recordAudit(db, req, "org.group.access.grant", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: `${group.name}:${collection.name}:${parsed.data.permission}`,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; gid: string; cid: string } }>(
    "/api/orgs/:id/groups/:gid/collections/:cid",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const group = await orgGroups.findById(db, req.params.gid);
      if (!group || group.org_id !== req.params.id)
        return reply.code(404).send({ error: "groupe introuvable" });
      const revoked = await groupCollectionAccess.revoke(db, {
        groupId: group.id,
        collectionId: req.params.cid,
      });
      if (!revoked) return reply.code(404).send({ error: "accès introuvable" });
      await recordAudit(db, req, "org.group.access.revoke", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: `${group.name}:${req.params.cid}`,
      });
      return reply.code(204).send();
    },
  );

  // ─── Rôle d'un membre (sans rotation de clé ; la révocation reste le flux de rotation) ───

  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/orgs/:id/members/:userId",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!(await admin(req.params.id, req.currentUser!.id)))
        return reply.code(403).send({ error: "réservé à l'administrateur" });
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const target = await orgMembers.findByOrgAndUser(db, req.params.id, req.params.userId);
      if (!target) return reply.code(404).send({ error: "membre introuvable" });
      // Garde-fou : l'org doit garder au moins un admin actif.
      if (target.role === "admin" && parsed.data.role !== "admin") {
        const members = await orgMembers.listByOrg(db, req.params.id);
        const activeAdmins = members.filter((m) => m.status === "active" && m.role === "admin");
        if (activeAdmins.length <= 1)
          return reply.code(400).send({ error: "l'organisation doit garder au moins un admin" });
      }
      await orgMembers.setRole(db, { orgId: req.params.id, userId: req.params.userId, role: parsed.data.role });
      const u = await users.findById(db, req.params.userId);
      await recordAudit(db, req, "org.member.role", {
        userId: req.currentUser!.id,
        actorEmail: req.currentUser!.email,
        target: `${u?.email ?? req.params.userId}:${parsed.data.role}`,
      });
      return { ok: true };
    },
  );
}
