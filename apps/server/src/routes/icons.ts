import type { FastifyInstance } from "fastify";
import type { DB } from "../db/database.js";
import {
  ICONS_ACTIVES,
  creerJetonIcone,
  lireJetonIcone,
  normalizeDomain,
  resolveFavicon,
} from "../services/icons.js";
import { makeAuthenticate } from "../plugins/auth.js";

// Proxy de favicons : GET /api/icons?domain=github.com&t=<jeton> → octets de l'icône (ou 404).
//
// Le commentaire de cette route disait « ne révèle aucune donnée utilisateur
// (juste un favicon public) ». C'était faux, et c'est le genre de phrase qui
// décourage de rouvrir la question : la route était publique et le cache indexé
// sur le seul domaine, si bien que le TEMPS DE RÉPONSE disait si quelqu'un
// avait ce domaine dans son coffre. Le contenu servi était bien public ;
// l'information fuitée ne l'était pas.
export function registerIconRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  /// Le jeton que la balise `<img>` accrochera à l'URL. Demandé une fois par
  /// session : une image ne peut pas porter d'en-tête d'autorisation.
  app.get("/api/icons/token", { preHandler: authenticate }, async (req) =>
    creerJetonIcone(req.currentUser!.id),
  );

  app.get<{ Querystring: { domain?: string; t?: string } }>(
    "/api/icons",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!ICONS_ACTIVES) return reply.code(404).send({ error: "proxy de favicons désactivé" });

      const userId = lireJetonIcone(req.query.t ?? "");
      if (!userId) return reply.code(401).send({ error: "jeton d'icône absent ou expiré" });

      const domain = normalizeDomain(req.query.domain ?? "");
      if (!domain) return reply.code(400).send({ error: "domaine invalide" });

      const icon = await resolveFavicon(userId, domain);
      if (!icon) return reply.code(404).send({ error: "favicon introuvable" });

      return reply
        .header("content-type", icon.contentType)
        // `private` et non `public` : un cache partagé en amont réintroduirait
        // exactement l'oracle que le cloisonnement vient de fermer.
        .header("cache-control", "private, max-age=86400")
        .send(icon.data);
    },
  );
}
