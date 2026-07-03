import { buildApp } from "./app.js";
import { createDb } from "./db/database.js";

const PORT = Number(process.env.PORT ?? 3000);

// Sélection SQLite (dev) / PostgreSQL (prod via DATABASE_URL) + création du schéma : asynchrone.
try {
  const db = await createDb();
  const app = buildApp(db);
  const address = await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`GhostPass server à l'écoute sur ${address}`);
  // eslint-disable-next-line no-console
  console.log(`GhostPass server à l'écoute sur ${address}`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
}
