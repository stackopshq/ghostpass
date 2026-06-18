import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { sends } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { newId } from "../services/security.js";

// Partage de lien éphémère ("Send") : le serveur ne voit que du chiffré AES-GCM.
// La clé est dans le fragment d'URL côté destinataire et n'atteint jamais le serveur (zero-knowledge).
const createSchema = z.object({
  ciphertext: z.string().min(1).max(200_000),
  iv: z.string().min(1).max(100),
  expiresInHours: z.number().int().min(1).max(720),
  maxViews: z.number().int().min(0).max(100),
});

export function registerSendRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  // Créer un lien (authentifié, rate-limité).
  app.post(
    "/api/send",
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const id = newId();
      sends.create(db, {
        id,
        ciphertext: parsed.data.ciphertext,
        iv: parsed.data.iv,
        expiresAt: Date.now() + parsed.data.expiresInHours * 3_600_000,
        maxViews: parsed.data.maxViews,
      });
      return reply.code(201).send({ id });
    },
  );

  // Récupérer un lien (public). Applique expiration + nombre de vues max, puis purge si épuisé.
  app.get<{ Params: { id: string } }>(
    "/api/send/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const row = sends.get(db, req.params.id);
      const gone = { error: "lien introuvable ou expiré" };
      if (!row) return reply.code(404).send(gone);
      if (row.expires_at < Date.now() || (row.max_views > 0 && row.views >= row.max_views)) {
        sends.remove(db, row.id);
        return reply.code(404).send(gone);
      }
      sends.incrementViews(db, row.id);
      if (row.max_views > 0 && row.views + 1 >= row.max_views) sends.remove(db, row.id);
      return { ciphertext: row.ciphertext, iv: row.iv };
    },
  );
}
