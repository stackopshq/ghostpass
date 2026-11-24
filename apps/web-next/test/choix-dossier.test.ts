// La liste du choix de dossier : rangée comme l'arbre, parents compris.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cheminsDeLArbre } from "../src/components/ChoixDossier";

test("un parent sans élément direct est quand même proposé", () => {
  assert.deepEqual(cheminsDeLArbre(["Travail/Dev"]), ["Travail", "Travail/Dev"]);
});

test("l'ordre est celui de l'arbre, pas celui des chaînes", () => {
  // Trié comme des chaînes, « Travail perso » se glisserait entre « Travail »
  // et ses sous-dossiers.
  assert.deepEqual(cheminsDeLArbre(["Travail perso", "Travail/Dev", "Banques"]), [
    "Banques",
    "Travail",
    "Travail/Dev",
    "Travail perso",
  ]);
});

test("les doublons et les segments vides disparaissent", () => {
  assert.deepEqual(cheminsDeLArbre(["A//B", "A/B", ""]), ["A", "A/B"]);
});
