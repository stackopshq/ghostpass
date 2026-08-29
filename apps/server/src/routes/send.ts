import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { sends } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { newId } from "../services/security.js";
import { creerPartage, ghostbitConfigured, revoquerPartage } from "../services/ghostbit.js";

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
  //
  // Depuis le 2026-08-29, la création est DÉLÉGUÉE à ghostbit, le service de
  // paste chiffré de la suite. Le partage vivait ici en double, et en moins
  // bien : pas de révocation, une expiration figée à 24 h, aucune protection
  // par mot de passe — là où ghostbit fait les trois. Les enveloppes étaient
  // déjà compatibles (AES-256-GCM, nonce de 12 octets, base64), seuls les noms
  // de champs différaient.
  //
  // Le corps de la requête ne change pas : le client envoie le même chiffré. La
  // réponse gagne `url` et surtout `deleteToken`, que le client range dans son
  // registre chiffré — ce serveur ne le garde pas, sinon il détiendrait un
  // pouvoir de révocation sur des partages qu'il ne peut pas lire.
  //
  // `GHOSTBIT_URL` absente : on refuse au lieu de retomber sur le stockage
  // local. Un repli silencieux créerait des liens sans révocation possible, et
  // personne ne s'en apercevrait avant d'en avoir besoin.
  app.post(
    "/api/send",
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      if (!ghostbitConfigured()) {
        return reply.code(503).send({ error: "partage indisponible : GHOSTBIT_URL non configurée" });
      }
      try {
        const partage = await creerPartage({
          ciphertext: parsed.data.ciphertext,
          nonce: parsed.data.iv,
          expiresInSeconds: parsed.data.expiresInHours * 3600,
          maxViews: parsed.data.maxViews,
        });
        return reply.code(201).send(partage);
      } catch (err) {
        req.log.error({ err }, "création de partage refusée par ghostbit");
        return reply.code(502).send({ error: "le service de partage n'a pas répondu" });
      }
    },
  );

  // Révoquer un partage : le client présente le jeton qu'il a gardé.
  //
  // Ce serveur ne le connaît pas et ne peut donc pas révoquer à la place de
  // quelqu'un. Il ne fait que transmettre — c'est ce qui rend la révocation
  // capacitaire plutôt qu'une permission qu'il faudrait lui confier.
  app.delete<{ Params: { id: string }; Headers: { "x-delete-token"?: string } }>(
    "/api/send/:id",
    { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const jeton = req.headers["x-delete-token"];
      if (!jeton) return reply.code(400).send({ error: "jeton de suppression manquant" });
      if (!ghostbitConfigured()) {
        return reply.code(503).send({ error: "partage indisponible : GHOSTBIT_URL non configurée" });
      }
      // 204 sans distinguer : ghostbit rend 403 pour un jeton faux comme pour
      // un paste absent ou expiré, exprès, afin qu'on ne puisse pas énumérer.
      // Relayer la nuance ici la rendrait à l'appelant et annulerait la garde.
      await revoquerPartage(req.params.id, jeton);
      return reply.code(204).send();
    },
  );

  // Récupérer un lien (public). Applique expiration + nombre de vues max, puis purge si épuisé.
  app.get<{ Params: { id: string } }>(
    "/api/send/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const row = await sends.get(db, req.params.id);
      const gone = { error: "lien introuvable ou expiré" };
      if (!row) return reply.code(404).send(gone);
      if (row.expires_at < Date.now() || (row.max_views > 0 && row.views >= row.max_views)) {
        await sends.remove(db, row.id);
        return reply.code(404).send(gone);
      }
      await sends.incrementViews(db, row.id);
      if (row.max_views > 0 && row.views + 1 >= row.max_views) await sends.remove(db, row.id);
      return { ciphertext: row.ciphertext, iv: row.iv };
    },
  );
}
