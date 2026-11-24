// Le verrouillage automatique et ses réglages : quand il ferme, quand il ne
// ferme pas, et ce qu'une valeur bricolée dans le stockage devient.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DELAIS_PRESSE_PAPIERS,
  DELAIS_VERROU,
  doitVerrouiller,
  lireReglage,
  PRESSE_PAPIERS_PAR_DEFAUT,
  VERROU_PAR_DEFAUT,
} from "../src/lib/verrouillage";

const MINUTE = 60_000;

test("le délai atteint verrouille, une seconde avant ne verrouille pas", () => {
  assert.equal(doitVerrouiller(15 * MINUTE, 0, 15), true);
  assert.equal(doitVerrouiller(15 * MINUTE - 1000, 0, 15), false);
});

test("« jamais » ne verrouille pas, même après des jours", () => {
  assert.equal(doitVerrouiller(30 * 24 * 60 * MINUTE, 0, 0), false);
});

test("une absence plus longue que le délai verrouille au retour", () => {
  // Le cas de la mise en veille : aucun tic entre les deux, une seule mesure.
  assert.equal(doitVerrouiller(8 * 60 * MINUTE, 0, 60), true);
});

test("un réglage absent vaut le défaut, qui verrouille", () => {
  assert.equal(lireReglage(null, DELAIS_VERROU, VERROU_PAR_DEFAUT), 15);
  assert.equal(lireReglage(null, DELAIS_PRESSE_PAPIERS, PRESSE_PAPIERS_PAR_DEFAUT), 90);
});

test("chaque valeur proposée est relue telle quelle", () => {
  for (const v of DELAIS_VERROU) assert.equal(lireReglage(String(v), DELAIS_VERROU, VERROU_PAR_DEFAUT), v);
  for (const v of DELAIS_PRESSE_PAPIERS)
    assert.equal(lireReglage(String(v), DELAIS_PRESSE_PAPIERS, PRESSE_PAPIERS_PAR_DEFAUT), v);
});

test("une valeur bricolée retombe sur le défaut, ni boucle ni verrou coupé", () => {
  // « 0.001 » verrouillerait en boucle ; « -1 » et « abc » ne doivent pas
  // valoir « jamais » en passant par un calcul qui les tolérerait.
  for (const brut of ["0.001", "-1", "abc", "", "1e9", "16"]) {
    assert.equal(lireReglage(brut, DELAIS_VERROU, VERROU_PAR_DEFAUT), VERROU_PAR_DEFAUT, brut);
  }
});
