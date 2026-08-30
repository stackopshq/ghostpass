import { buildApp } from "./app.js";
import { createDb } from "./db/database.js";
import { ensureDefaultCollections } from "./services/defaultCollection.js";
import { programmerLaPurge } from "./services/retention.js";

const PORT = Number(process.env.PORT ?? 3000);

// Sélection SQLite (dev) / PostgreSQL (prod via DATABASE_URL) + création du schéma : asynchrone.
try {
  const db = await createDb();
  // Rattrapage des organisations antérieures à la collection par défaut. Idempotent : sans effet
  // dès le deuxième démarrage, puisqu'elles ont alors une collection.
  const backfilled = await ensureDefaultCollections(db);
  const app = buildApp(db);
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
