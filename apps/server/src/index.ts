import { buildApp } from "./app.js";
import { createDb } from "./db/database.js";
import { ensureDefaultCollections } from "./services/defaultCollection.js";
import { programmerLaPurge } from "./services/retention.js";
import { chargerLaCle, definirLaCle } from "./services/secretAtRest.js";

const PORT = Number(process.env.PORT ?? 3000);

// Sélection SQLite (dev) / PostgreSQL (prod via DATABASE_URL) + création du schéma : asynchrone.
try {
  // La clé de chiffrement au repos, AVANT toute lecture de la base : sans elle,
  // un secret TOTP déjà chiffré serait illisible et la 2FA échouerait sans
  // raison apparente.
  //
  // ELLE EST FACULTATIVE, ET C'EST DÉLIBÉRÉ. Faire échouer le démarrage sans
  // clé casserait toute instance auto-hébergée qui monte de version — un
  // correctif de sécurité qui met les gens dehors n'en est pas un. Sans clé, le
  // serveur tourne comme avant : les secrets restent en clair, les anciens
  // restent lisibles.
  //
  // Mais il le DIT, à chaque démarrage et non une fois. Le mode de défaillance
  // qu'on cherche à éviter n'est pas l'absence de clé, c'est de croire que le
  // chiffrement s'applique alors qu'il ne s'applique pas.
  const cle = chargerLaCle(process.env.MFA_SECRET_KEY);
  definirLaCle(cle);

  const db = await createDb();
  // Rattrapage des organisations antérieures à la collection par défaut. Idempotent : sans effet
  // dès le deuxième démarrage, puisqu'elles ont alors une collection.
  const backfilled = await ensureDefaultCollections(db);
  const app = buildApp(db);
  if (!cle) {
    app.log.warn(
      "MFA_SECRET_KEY absente : le secret du second facteur est stocké EN CLAIR. " +
        "Quiconque lit la base peut générer les codes 2FA de tous les comptes. " +
        "Poser une clé : openssl rand -hex 32",
    );
  }
  if (backfilled > 0) {
    app.log.info(`Collection par défaut créée pour ${backfilled} organisation(s) sans collection`);
  }
  // Purge des traces : au démarrage puis toutes les six heures. Rien ne la
  // déclenchait auparavant, et `login_events` gardait une IP par connexion
  // sans borne de temps.
  programmerLaPurge(db, (r) => {
    if (r.loginEvents > 0 || r.auditLog > 0)
      app.log.info(
        `Rétention : ${r.loginEvents} connexion(s) et ${r.auditLog} entrée(s) d'audit purgées`,
      );
  });

  const address = await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`GhostPass server à l'écoute sur ${address}`);
  // eslint-disable-next-line no-console
  console.log(`GhostPass server à l'écoute sur ${address}`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
}
