import Fastify, { type FastifyInstance } from "fastify";
import type { DB } from "./db/database.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMfaRoutes } from "./routes/mfa.js";
import { registerRecoveryRoutes } from "./routes/recovery.js";
import { registerVaultRoutes } from "./routes/vault.js";

/// Construit l'instance Fastify autour d'une base donnée.
/// Séparé de `index.ts` pour permettre les tests via `app.inject()` sur une DB en mémoire.
export function buildApp(db: DB): FastifyInstance {
  const app = Fastify({ logger: false });

  // Valeur par défaut de la propriété attachée à la requête par le preHandler d'auth.
  app.decorateRequest("currentUser", null);

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, db);
  registerMfaRoutes(app, db);
  registerRecoveryRoutes(app, db);
  registerVaultRoutes(app, db);

  return app;
}
