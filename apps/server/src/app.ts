import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { DB } from "./db/database.js";
import { registerAccountRoutes } from "./routes/account.js";
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
/// Ce que le journal retient d'une requête : la méthode et le CHEMIN, jamais la
/// chaîne de requête.
///
/// `req.url` en Fastify inclut le `?…`, et `/api/icons?domain=…` y transporte le
/// domaine d'une entrée du coffre — déchiffré au navigateur, extrait par
/// `faviconUrl()`, demandé au rendu de CHAQUE ligne. Ouvrir son coffre écrivait
/// donc la liste de ses domaines dans ce journal, une ligne par entrée.
///
/// C'est exactement ce que le sérialiseur refuse par ailleurs pour l'adresse IP,
/// avec une valeur plus parlante encore : savoir qu'une personne a un compte
/// chez tel prestataire en dit plus que savoir d'où elle se connecte.
///
/// Exportée pour être testable. Un sérialiseur atteint par un symbole interne de
/// pino ne se teste pas — il se devine.
/// Ce que le journal retient d'une requête : la méthode et le GABARIT de route.
///
/// `req.url` écrit le chemin tel qu'il est arrivé — donc tout secret qui y
/// voyage, dans le chemin comme dans la chaîne de requête. Deux fuites l'ont
/// montré le même jour :
///
///   - `/api/icons?domain=…` transportait le domaine d'une entrée du coffre,
///     demandé au rendu de CHAQUE ligne. Retirer la chaîne de requête suffisait
///     pour celle-là.
///   - `/api/send/<jeton>` porte son identifiant DANS le chemin. Aucune
///     suppression de chaîne de requête ne l'atteint.
///
/// Le gabarit ferme les deux : `req.routeOptions.url` rend `/api/send/:id`, et
/// la route la plus bavarde de demain sera couverte sans que personne ait à y
/// penser. Un journal ne s'oublie pas.
///
/// C'est la solution de ghostcal, qui journalise `route_template()`.
///
/// Exportée pour être testable. Un sérialiseur atteint par un symbole interne
/// de pino ne se teste pas — il se devine.
export function serialiserLaRequete(req: {
  method: string;
  url: string;
  routeOptions?: { url?: string };
}): { method: string; route: string } {
  // Repli sur le chemin nu quand aucune route ne correspond : un 404 doit
  // rester visible sans révéler en entier ce qui a été tenté. On coupe à
  // l'indice plutôt que par `split("?")[0]`, que `noUncheckedIndexedAccess`
  // type `string | undefined` — vrai pour le vérificateur, jamais à l'exécution.
  const separateur = req.url.indexOf("?");
  const chemin = separateur === -1 ? req.url : req.url.slice(0, separateur);
  return { method: req.method, route: req.routeOptions?.url ?? chemin };
}

export function buildApp(db: DB): FastifyInstance {
  const app = Fastify({
    // `info` et non `warn` : à `warn`, Fastify ne journalise NI les requêtes
    // servies NI les 4xx. Le 2026-08-27, un bouton qui ne faisait rien était
    // indiagnosticable — le conteneur n'avait produit que ses quatre lignes de
    // démarrage depuis son lancement. Une requête refusée doit laisser une trace.
    //
    // Les sérialiseurs sont restreints à la méthode, au chemin et au statut.
    // Le sérialiseur par défaut de Fastify journalise `remoteAddress` : sur un
    // coffre zero-knowledge, consigner l'adresse IP de chaque porteur à chaque
    // requête reprendrait d'une main ce que le chiffrement donne de l'autre.
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: {
        req: serialiserLaRequete,
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
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
  //
  // Les routes sont déclarées DANS cet enregistrement, après l'`await`, et non
  // à côté. Ce n'est pas un rangement : un hook Fastify ne s'applique qu'aux
  // routes ajoutées APRÈS lui, et `register` est différé jusqu'à `ready()`.
  // Déclarées au niveau du dessus, toutes les routes étaient donc en place
  // AVANT que le hook du limiteur n'existe — et **aucune n'était limitée**, ni
  // par le plafond global, ni par les `config.rateLimit` posés route par route
  // sur /api/auth/login, /api/auth/prelogin et /api/auth/recover.
  //
  // Le symptôme était invisible : tout répondait 200, ce qu'on attend d'un
  // serveur qui va bien. Mesuré le 2026-09-25 — 130 requêtes de suite sur
  // /health (plafond 100) sans un seul 429.
  app.register(async (instance) => {
    await instance.register(rateLimit, { max: 100, timeWindow: "1 minute" });
    registerAllRoutes(instance, db);
  });

  // Valeur par défaut de la propriété attachée à la requête par le preHandler d'auth.
  app.decorateRequest("currentUser", null);

  // Erreurs génériques (ne divulgue pas les détails internes / stack).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: status < 500 ? error.message : "erreur interne" });
  });

  return app;
}

/// Toutes les routes, dans le contexte où le limiteur est déjà posé.
function registerAllRoutes(app: FastifyInstance, db: DB): void {
  app.get("/health", async () => ({ status: "ok" }));

  // WebAuthn Related Origin Requests : permet à des origines liées (ex. l'extension navigateur,
  // `chrome-extension://…`, non same-site avec le rpID) de faire des cérémonies WebAuthn contre ce
  // RP. Renseigner WEBAUTHN_EXTRA_ORIGINS pour les lister ici. https://w3c.github.io/webauthn/#sctn-related-origins
  app.get("/.well-known/webauthn", async () => ({ origins: getAllowedOrigins() }));

  registerAuthRoutes(app, db);
  registerAccountRoutes(app, db);
  registerAuditRoutes(app, db);
  registerSsoRoutes(app, db);
  registerMfaRoutes(app, db);
  registerRecoveryRoutes(app, db);
  registerVaultRoutes(app, db);
  registerOrgRoutes(app, db);
  registerOrgVaultRoutes(app, db);
  registerOrgAdminRoutes(app, db);
  registerIconRoutes(app, db);
  registerSendRoutes(app, db);
  registerWebAuthnRoutes(app, db);
  registerPasskeyRoutes(app, db);
  registerEmergencyRoutes(app, db);
}
