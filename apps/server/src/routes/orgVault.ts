import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import type { CollectionRow, OrgItemRow, OrgMemberRow } from "../types.js";
import { collections, orgItems, orgMembers } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { newId } from "../services/security.js";

const collectionSchema = z.object({ name: z.string().min(1) });
const itemSchema = z.object({
  encryptedKey: z.string().min(1),
  encryptedData: z.string().min(1),
});

function activeMember(db: DB, orgId: string, userId: string): OrgMemberRow | null {
  const m = orgMembers.findByOrgAndUser(db, orgId, userId);
  return m && m.status === "active" ? m : null;
}

function canWrite(member: OrgMemberRow): boolean {
  return member.role !== "readonly";
}

/// Renvoie la collection si elle appartient bien à l'org (empêche tout accès cross-org).
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

  // Créer une collection (membre actif, hors lecture seule).
  app.post<{ Params: { id: string } }>(
    "/api/orgs/:id/collections",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = collectionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!canWrite(member)) return reply.code(403).send({ error: "accès en lecture seule" });
      const id = newId();
      collections.create(db, { id, orgId: req.params.id, name: parsed.data.name });
      return reply.code(201).send({ id, name: parsed.data.name });
    },
  );

  // Lister les collections (tout membre actif).
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/collections",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!activeMember(db, req.params.id, req.currentUser!.id)) {
        return reply.code(403).send({ error: "non membre de l'organisation" });
      }
      const list = collections.listByOrg(db, req.params.id).map((c) => ({ id: c.id, name: c.name }));
      return { collections: list };
    },
  );

  // Lister TOUS les items partagés de l'org (membre actif) — utile pour la rotation d'Org Key.
  app.get<{ Params: { id: string } }>(
    "/api/orgs/:id/items",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!activeMember(db, req.params.id, req.currentUser!.id)) {
        return reply.code(403).send({ error: "non membre de l'organisation" });
      }
      return { items: orgItems.listByOrg(db, req.params.id).map(itemDto) };
    },
  );

  // Lister les items d'une collection (lecture : tout membre actif).
  app.get<{ Params: { id: string; cid: string } }>(
    "/api/orgs/:id/collections/:cid/items",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!activeMember(db, req.params.id, req.currentUser!.id)) {
        return reply.code(403).send({ error: "non membre de l'organisation" });
      }
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      return { items: orgItems.listByCollection(db, req.params.cid).map(itemDto) };
    },
  );

  // Créer un item partagé (écriture).
  app.post<{ Params: { id: string; cid: string } }>(
    "/api/orgs/:id/collections/:cid/items",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = itemSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!canWrite(member)) return reply.code(403).send({ error: "accès en lecture seule" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
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

  // Mettre à jour un item partagé (écriture).
  app.put<{ Params: { id: string; cid: string; itemId: string } }>(
    "/api/orgs/:id/collections/:cid/items/:itemId",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = itemSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!canWrite(member)) return reply.code(403).send({ error: "accès en lecture seule" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
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

  // Supprimer un item partagé (écriture).
  app.delete<{ Params: { id: string; cid: string; itemId: string } }>(
    "/api/orgs/:id/collections/:cid/items/:itemId",
    { preHandler: authenticate },
    async (req, reply) => {
      const member = activeMember(db, req.params.id, req.currentUser!.id);
      if (!member) return reply.code(403).send({ error: "non membre de l'organisation" });
      if (!canWrite(member)) return reply.code(403).send({ error: "accès en lecture seule" });
      if (!collectionInOrg(db, req.params.id, req.params.cid)) {
        return reply.code(404).send({ error: "collection introuvable" });
      }
      if (!orgItems.remove(db, { id: req.params.itemId, collectionId: req.params.cid })) {
        return reply.code(404).send({ error: "item introuvable" });
      }
      return reply.code(204).send();
    },
  );
}
