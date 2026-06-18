import type { FastifyInstance } from "fastify";
import { normalizeDomain, resolveFavicon } from "../services/icons.js";

// Proxy de favicons : GET /api/icons?domain=github.com → octets de l'icône (ou 404).
// Public mais strictement rate-limité ; ne révèle aucune donnée utilisateur (juste un favicon public).
export function registerIconRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { domain?: string } }>(
    "/api/icons",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const domain = normalizeDomain(req.query.domain ?? "");
      if (!domain) return reply.code(400).send({ error: "domaine invalide" });

      const icon = await resolveFavicon(domain);
      if (!icon) return reply.code(404).send({ error: "favicon introuvable" });

      return reply
        .header("content-type", icon.contentType)
        .header("cache-control", "public, max-age=86400")
        .send(icon.data);
    },
  );
}
