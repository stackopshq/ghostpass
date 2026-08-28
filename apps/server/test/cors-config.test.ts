import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

// Régression : `CORS_ORIGIN=""` faisait rendre 500 à TOUTES les requêtes.
//
// `.env.example` documente « vide = désactivé », mais le code lisait
// `process.env.CORS_ORIGIN ?? false` — et `??` ne se replie que sur
// `undefined`. Une chaîne vide, ce qu'écrit n'importe quel gabarit de
// configuration qui rend une valeur absente, arrivait donc jusqu'à
// @fastify/cors, qui la rejette à chaque requête et non au démarrage.
//
// Le mode de défaillance est vicieux : le serveur démarre, reste sain aux yeux
// de l'orchestrateur, et rend `{"error":"erreur interne"}` sur tout — y compris
// `/health`, qui ne touche pourtant ni la base ni CORS. Constaté en production
// le 2026-08-27, sur un déploiement où seul le journal du conteneur nommait la
// cause.
async function statutSanteAvec(valeur: string | undefined) {
  const avant = process.env.CORS_ORIGIN;
  if (valeur === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = valeur;
  try {
    const app = buildApp(openDatabase(":memory:"));
    const res = await app.inject({ method: "GET", url: "/health" });
    return res.statusCode;
  } finally {
    if (avant === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = avant;
  }
}

test("CORS_ORIGIN vide désactive le module au lieu de casser chaque requête", async () => {
  assert.equal(await statutSanteAvec(""), 200);
});

test("CORS_ORIGIN absent reste équivalent à vide", async () => {
  assert.equal(await statutSanteAvec(undefined), 200);
});

test("CORS_ORIGIN renseigné laisse le service répondre", async () => {
  assert.equal(await statutSanteAvec("https://ghostpass.stackops.ch"), 200);
});
