import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import type { CollectionPermission, CollectionRow, OrgItemRow, OrgMemberRow } from "../types.js";
import { collectionAccess, collections, orgItems, orgMembers } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { newId } from "../services/security.js";

const collectionSchema = z.object({ name: z.string().min(1) });
const itemSchema = z.object({
  encryptedKey: z.string().min(1),
  encryptedData: z.string().min(1),
});
const accessSchema = z.object({
  userId: z.string().min(1),
  permission: z.enum(["read", "write", "manage"]),
});

function activeMember(db: DB, orgId: string, userId: string): OrgMemberRow | null {
  const m = orgMembers.findByOrgAndUser(db, orgId, userId);
  return m && m.status === "active" ? m : null;
}

/// Permission effective d'un membre sur une collection : l'admin d'org a `manage` implicite
/// sur toutes les collections ; les autres dépendent de `collection_access`.
function permissionFor(
  db: DB,
  collectionId: string,
  member: OrgMemberRow,
): CollectionPermission | null {
  if (member.role === "admin") return "manage";
  return collectionAccess.findFor(db, collectionId, member.user_id)?.permission ?? null;
}

function canWrite(p: CollectionPermission | null): boolean {
  return p === "write" || p === "manage";
}

function collectionInOrg(db: DB, orgId: string, collectionId: string): CollectionRow | null {
  const c = collections.findById(db, collectionId);
  return c && c.org_id === orgId ? c : null;
}

function itemDto(row: OrgItemRow) {
  return {
    id: row.id,
    encryptedKey: row.encrypted_key,
    encryptedData: row.encrypted_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerOrgVaultRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Créer une collection (membre actif hors lecture seule). Le créateur non-admin reçoit `manage`.
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/collections",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = collectionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (member.role === "readonly") return reply.code(403).send({ error: "accès en lecture seule" });
      const id = newId();
      collections.create(db, { id, orgId: req.params.id, name: parsed.data.name });
      if (member.role !== "admin") {
        collectionAccess.grant(db, {
          id: newId(),
          collectionId: id,
          userId: member.user_id,
          permission: "manage",
        });
      }
      return reply.code(201).send({ id, name: parsed.data.name });
    },
  );

  // Lister les collections accessibles (admin : toutes ; sinon : celles avec un accès).
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/collections",
    { preHandler: authenticate },
    async (req, reply) => {
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      const rows =
        member.role === "admin"
          ? collections.listByOrg(db, req.params.id)
          : collectionAccess.listCollectionsForUser(db, req.params.id, member.user_id);
      return { collections: rows.map((c) => ({ id: c.id, name: c.name })) };
    },
  );

  // Tous les items de l'org (admin uniquement) — pour la rotation d'Org Key.
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member || member.role !== "admin") {
        return reply.code(403).send({ error: "réservé à l'administrateur de l'organisation" });
      }
      return { items: orgItems.listByOrg(db, req.params.id).map(itemDto) };
    },
  );

  // Lister les items d'une collection (permission lecture requise).
  app.get<{ Params: { id: string; cid: string } }>(
    "/api/orgs/:id/collections/:cid/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (permissionFor(db, req.params.cid, member) === null) {
        return reply.code(403).send({ error: "accès refusé à cette collection" });
      }
      return { items: orgItems.listByCollection(db, req.params.cid).map(itemDto) };
    },
  );

  // Créer un item partagé (permission écriture).
  app.post<{ Params: { id: string; cid: string } }>(
    "/api/orgs/:id/collections/:cid/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = itemSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (!canWrite(permissionFor(db, req.params.cid, member))) {
        return reply.code(403).send({ error: "accès en écriture refusé" });
      }
      const row = orgItems.create(db, {
        id: newId(),
        collectionId: req.params.cid,
        encryptedKey: parsed.data.encryptedKey,
        encryptedData: parsed.data.encryptedData,
      });
      return reply.code(201).send(itemDto(row));
    },
  );

  // Mettre à jour un item partagé (permission écriture).
  app.put<{ Params: { id: string; cid: string; itemId: string } }>(
    "/api/orgs/:id/collections/:cid/items/:itemId",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = itemSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (!canWrite(permissionFor(db, req.params.cid, member))) {
        return reply.code(403).send({ error: "accès en écriture refusé" });
      }
      const row = orgItems.update(db, {
        id: req.params.itemId,
        collectionId: req.params.cid,
        encryptedKey: parsed.data.encryptedKey,
        encryptedData: parsed.data.encryptedData,
      });
      if (!row) return reply.code(404).send({ error: "item introuvable" });
      return itemDto(row);
    },
  );

  // Supprimer un item partagé (permission écriture).
  app.delete<{ Params: { id: string; cid: string; itemId: string } }>(
    "/api/orgs/:id/collections/:cid/items/:itemId",
    { preHandler: authenticate },
    async (req, reply) => {
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (!canWrite(permissionFor(db, req.params.cid, member))) {
        return reply.code(403).send({ error: "accès en écriture refusé" });
      }
      if (!orgItems.remove(db, { id: req.params.itemId, collectionId: req.params.cid })) {
        return reply.code(404).send({ error: "item introuvable" });
      }
      return reply.code(204).send();
    },
  );

  // Accorder/modifier la permission d'un membre sur une collection (permission `manage`).
  app.post<{ Params: { id: string; cid: string } }>(
    "/api/orgs/:id/collections/:cid/access",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = accessSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (permissionFor(db, req.params.cid, member) !== "manage") {
        return reply.code(403).send({ error: "gestion de la collection requise" });
      }
      // Le bénéficiaire doit être membre de l'org (l'accès peut être pré-accordé avant acceptation).
      if (!orgMembers.findByOrgAndUser(db, req.params.id, parsed.data.userId)) {
        return reply.code(404).send({ error: "membre introuvable dans l'organisation" });
      }
      collectionAccess.grant(db, {
        id: newId(),
        collectionId: req.params.cid,
        userId: parsed.data.userId,
        permission: parsed.data.permission,
      });
      return reply.code(201).send({ ok: true });
    },
  );
}
