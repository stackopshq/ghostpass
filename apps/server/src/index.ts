import { buildApp } from "./app.js";
import { openDatabase } from "./db/database.js";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "ghostpass.db";

const db = openDatabase(DB_PATH);
const app = buildApp(db);

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then((address) => {
    app.log.info(`GhostPass server à l'écoute sur ${address}`);
    // eslint-disable-next-line no-console
    console.log(`GhostPass server à l'écoute sur ${address}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
