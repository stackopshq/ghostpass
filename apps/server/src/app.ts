import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { DB } from "./db/database.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerIconRoutes } from "./routes/icons.js";
import { registerMfaRoutes } from "./routes/mfa.js";
import { registerOrgRoutes } from "./routes/orgs.js";
import { registerOrgVaultRoutes } from "./routes/orgVault.js";
import { registerRecoveryRoutes } from "./routes/recovery.js";
import { registerVaultRoutes } from "./routes/vault.js";

/// Construit l'instance Fastify autour d'une base donnée.
/// Séparé de `index.ts` pour permettre les tests via `app.inject()` sur une DB en mémoire.
export function buildApp(db: DB): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "warn" },
    // Borne la taille des corps : les blobs chiffrés sont petits, on coupe court au DoS mémoire.
    bodyLimit: 256 * 1024,
  });

  // Plugins de durcissement (chargés au ready()/inject()).
  app.register(helmet);
  app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });
  // Rate-limiting global par IP (anti brute-force / DoS). Durcissable par route ensuite.
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  // Valeur par défaut de la propriété attachée à la requête par le preHandler d'auth.
  app.decorateRequest("currentUser", null);

  // Erreurs génériques (ne divulgue pas les détails internes / stack).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: status < 500 ? error.message : "erreur interne" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, db);
  registerMfaRoutes(app, db);
  registerRecoveryRoutes(app, db);
  registerVaultRoutes(app, db);
  registerOrgRoutes(app, db);
  registerOrgVaultRoutes(app, db);
  registerIconRoutes(app);

  return app;
}
