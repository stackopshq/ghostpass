import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import type { VaultItemRow } from "../types.js";
import { vaultItems } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { newId } from "../services/security.js";

const itemBodySchema = z.object({
  encryptedKey: z.string().min(1),
  encryptedData: z.string().min(1),
});

function toDto(row: VaultItemRow) {
  return {
    id: row.id,
    encryptedKey: row.encrypted_key,
    encryptedData: row.encrypted_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerVaultRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Toutes les routes du coffre exigent une session valide.
  app.get("/api/vault/items", { preHandler: authenticate }, async (req) => {
    const items = vaultItems.listByUser(db, req.currentUser!.id);
    return { items: items.map(toDto) };
  });

  app.post("/api/vault/items", { preHandler: authenticate }, async (req, reply) => {
    const parsed = itemBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "requête invalide" });
    }
    const row = vaultItems.create(db, {
      id: newId(),
      userId: req.currentUser!.id,
      encryptedKey: parsed.data.encryptedKey,
      encryptedData: parsed.data.encryptedData,
    });
    return reply.code(201).send(toDto(row));
  });

  app.put<{ Params: { id: string } }>(
    "/api/vault/items/:id",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = itemBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "requête invalide" });
      }
      const row = vaultItems.update(db, {
        id: req.params.id,
        userId: req.currentUser!.id,
        encryptedKey: parsed.data.encryptedKey,
        encryptedData: parsed.data.encryptedData,
      });
      if (!row) return reply.code(404).send({ error: "item introuvable" });
      return toDto(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/vault/items/:id",
    { preHandler: authenticate },
    async (req, reply) => {
      const removed = vaultItems.remove(db, { id: req.params.id, userId: req.currentUser!.id });
      if (!removed) return reply.code(404).send({ error: "item introuvable" });
      return reply.code(204).send();
    },
  );
}
