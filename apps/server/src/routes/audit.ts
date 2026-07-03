import type { FastifyInstance } from "fastify";
import type { DB } from "../db/database.js";
import { audit } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";

/// Journal d'audit en self-service : l'utilisateur consulte SES propres événements de sécurité.
/// (La vue admin d'une organisation viendra avec la console d'administration.)
export function registerAuditRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  app.get(
    "/api/account/audit",
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const events = await audit.listByUser(db, req.currentUser!.id);
      return {
        events: events.map((e) => ({
          action: e.action,
          target: e.target,
          ip: e.ip,
          createdAt: e.created_at,
        })),
      };
    },
  );
}
