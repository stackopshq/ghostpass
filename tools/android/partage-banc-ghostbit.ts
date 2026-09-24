// Un banc d'essai pour le §4 : le vrai serveur GhostPass **à relais**, et un ghostbit
// simulé qui rend une adresse sur un **autre domaine**.
//
// Pourquoi il faut le simuler : le serveur de la branche de travail ne rend qu'un
// identifiant, si bien que le lien retombe toujours sur l'hôte que l'utilisateur a saisi —
// de confiance par construction. La question du §4 ne s'y pose donc **jamais**, et la règle
// la plus importante du produit resterait sans témoin.
//
//   node --import tsx partage-banc-ghostbit.ts [--hote ghostbit.example.com]
//
// Il imprime, puis attend sur l'entrée standard :
//   SERVEUR http://127.0.0.1:<port>
//   GHOSTBIT http://127.0.0.1:<port>
//   REVOCATIONS <chemin d'un fichier où chaque révocation reçue est écrite>
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

function argument(nom: string, defaut: string): string {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

// Le domaine que ghostbit annoncera. Par défaut un **autre** que celui du serveur : c'est
// le cas qui doit déclencher la confirmation.
const hoteAnnonce = argument("hote", "ghostbit.example.com");
const journalDesRevocations = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "ghostbit-")), "revocations.txt");
fs.writeFileSync(journalDesRevocations, "");

const jetons = new Map<string, string>();
let compteur = 0;

const ghostbit = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "POST" && url.startsWith("/api/v1/pastes")) {
    let corps = "";
    req.on("data", (c) => (corps += c));
    req.on("end", () => {
      const id = `paste-${++compteur}`;
      const jeton = `jeton-${compteur}`;
      jetons.set(id, jeton);
      res.setHeader("content-type", "application/json");
      // **L'adresse vient d'ici**, et c'est tout le problème que le §4 traite : elle est
      // choisie par le serveur, pas par l'utilisateur.
      res.end(JSON.stringify({
        id,
        url: `https://${hoteAnnonce}/p/${id}`,
        delete_token: jeton,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
      }));
    });
    return;
  }
  if (req.method === "DELETE" && url.startsWith("/api/v1/pastes/")) {
    const id = decodeURIComponent(url.slice("/api/v1/pastes/".length));
    const presente = req.headers["x-delete-token"];
    // On enregistre la révocation reçue : c'est ce que le témoin lira pour vérifier qu'un
    // refus **révoque vraiment**, plutôt que de se contenter d'oublier le lien.
    fs.appendFileSync(journalDesRevocations, `${id} ${presente ?? ""}\n`);
    res.statusCode = jetons.get(id) === presente ? 204 : 403;
    res.end();
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((r) => ghostbit.listen(0, "127.0.0.1", r));
const portGhostbit = (ghostbit.address() as { port: number }).port;

process.env.GHOSTBIT_URL = `http://127.0.0.1:${portGhostbit}`;

const db = openDatabase(":memory:");
const app = buildApp(db);
await app.listen({ port: 0, host: "0.0.0.0" });
const port = (app.server.address() as { port: number }).port;

console.log(`SERVEUR http://127.0.0.1:${port}`);
console.log(`GHOSTBIT ${process.env.GHOSTBIT_URL}`);
console.log(`REVOCATIONS ${journalDesRevocations}`);

process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
