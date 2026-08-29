// Le journal écrit-il un secret qui voyage dans le chemin ?
//
// Éprouvé par un vrai passage de requête, pas par lecture du sérialiseur : c'est
// la sortie qui compte, et c'est elle qu'un exploitant lira.
//
// L'interception est posée AVANT `buildApp`, et l'ordre n'est pas cosmétique :
// pino se lie à son flux de sortie à la construction. Remplacer `stdout.write`
// après coup ne capture rien, et le test passait alors à vide — c'est
// l'assertion « aucune ligne capturée » qui l'a dit, sans quoi il aurait été vert
// en ne mesurant rien.

import assert from "node:assert/strict";
import { test } from "node:test";

const SECRET = "jeton-temoin-qui-ne-doit-pas-etre-journalise";

test("le journal retient le gabarit de route, jamais le jeton du chemin", async () => {
  const lignes: string[] = [];
  const origine = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (s: string) => boolean) = (s: string) => {
    lignes.push(String(s));
    return true;
  };

  let journal = "";
  try {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      await app.inject({ method: "GET", url: `/api/send/${SECRET}` });
    } finally {
      await app.close();
    }
  } finally {
    (process.stdout.write as unknown as typeof origine) = origine;
    journal = lignes.join("");
  }

  assert.ok(journal.length > 0, "aucune ligne de journal capturée — le test ne mesure rien");
  assert.ok(!journal.includes(SECRET), "le jeton du chemin s'est retrouvé dans le journal");
  assert.ok(
    journal.includes("/api/send/:id"),
    "le gabarit de route devrait être journalisé à la place",
  );
});
