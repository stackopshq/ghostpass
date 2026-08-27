import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { DB } from "./db/database.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerEmergencyRoutes } from "./routes/emergency.js";
import { registerIconRoutes } from "./routes/icons.js";
import { registerMfaRoutes } from "./routes/mfa.js";
import { registerPasskeyRoutes } from "./routes/passkey.js";
import { registerOrgAdminRoutes } from "./routes/orgAdmin.js";
import { registerOrgRoutes } from "./routes/orgs.js";
import { registerOrgVaultRoutes } from "./routes/orgVault.js";
import { registerRecoveryRoutes } from "./routes/recovery.js";
import { registerSendRoutes } from "./routes/send.js";
import { registerSsoRoutes } from "./routes/sso.js";
import { registerVaultRoutes } from "./routes/vault.js";
import { registerWebAuthnRoutes } from "./routes/webauthn.js";
import { getAllowedOrigins } from "./services/webauthn.js";

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
  // `||` et non `??` : `.env.example` documente « vide = désactivé », et `??`
  // ne se replie que sur `undefined`. Une chaîne vide — ce qu'écrit n'importe
  // quel gabarit de configuration qui rend une valeur absente — passait donc
  // jusqu'à @fastify/cors, qui la rejette À CHAQUE REQUÊTE et non au
  // démarrage. Le serveur démarrait, restait sain aux yeux de systemd, et
  // rendait 500 sur tout, y compris /health. Le gestionnaire d'erreurs
  // ci-dessous masque la cause à l'appelant, à raison — mais elle devient
  // alors introuvable sans le journal du conteneur.
  app.register(cors, { origin: process.env.CORS_ORIGIN || false });
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

  // WebAuthn Related Origin Requests : permet à des origines liées (ex. l'extension navigateur,
  // `chrome-extension://…`, non same-site avec le rpID) de faire des cérémonies WebAuthn contre ce
  // RP. Renseigner WEBAUTHN_EXTRA_ORIGINS pour les lister ici. https://w3c.github.io/webauthn/#sctn-related-origins
  app.get("/.well-known/webauthn", async () => ({ origins: getAllowedOrigins() }));

  registerAuthRoutes(app, db);
  registerAuditRoutes(app, db);
  registerSsoRoutes(app, db);
  registerMfaRoutes(app, db);
  registerRecoveryRoutes(app, db);
  registerVaultRoutes(app, db);
  registerOrgRoutes(app, db);
  registerOrgVaultRoutes(app, db);
  registerOrgAdminRoutes(app, db);
  registerIconRoutes(app);
  registerSendRoutes(app, db);
  registerWebAuthnRoutes(app, db);
  registerPasskeyRoutes(app, db);
  registerEmergencyRoutes(app, db);

  return app;
}
