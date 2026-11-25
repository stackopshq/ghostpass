// La vérification des fuites : ce qui part vers Have I Been Pwned, et surtout
// ce qui ne part pas. Et le réglage « à la saisie », désactivé tant qu'on ne
// l'a pas choisi.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CHOIX_FUITES_A_LA_SAISIE, FUITES_A_LA_SAISIE_PAR_DEFAUT, pwnedCount } from "../src/lib/breach";
import { lireReglage } from "../src/lib/verrouillage";

const MOT = "correct horse battery staple";
const EMPREINTE = createHash("sha1").update(MOT).digest("hex").toUpperCase();

/// Remplace `fetch` le temps d'un test et rend ce qui a été demandé.
async function avecReponse(corps: string, agir: () => Promise<unknown>) {
  const demandes: { url: string; init?: RequestInit }[] = [];
  const avant = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    demandes.push({ url: String(url), init });
    return new Response(corps, { status: 200 });
  }) as typeof fetch;
  try {
    return { resultat: await agir(), demandes };
  } finally {
    globalThis.fetch = avant;
  }
}

test("seuls les 5 premiers caractères de l'empreinte partent, jamais le mot de passe", async () => {
  const { demandes } = await avecReponse("", () => pwnedCount(MOT));
  assert.equal(demandes.length, 1);
  const url = demandes[0].url;
  assert.equal(url, `https://api.pwnedpasswords.com/range/${EMPREINTE.slice(0, 5)}`);
  assert.ok(!url.includes(EMPREINTE.slice(5)), "la suite de l'empreinte reste sur l'appareil");
  assert.ok(!url.includes(encodeURIComponent(MOT)) && !url.includes(MOT), "le mot de passe ne part pas");
  assert.equal(JSON.stringify(demandes[0].init).includes(EMPREINTE.slice(5)), false);
});

test("la correspondance se fait sur l'appareil : trouvé, ou pas", async () => {
  const suffixe = EMPREINTE.slice(5);
  const trouve = await avecReponse(`0000000000000000000000000000000000A:3\r\n${suffixe}:4217\r\n`, () => pwnedCount(MOT));
  assert.equal(trouve.resultat, 4217);
  // Les entrées de bourrage (compte 0) et les autres suffixes ne comptent pas.
  const absent = await avecReponse(`${"F".repeat(35)}:12\r\n${suffixe.slice(0, -1)}0:0\r\n`, () => pwnedCount(MOT));
  assert.equal(absent.resultat, 0);
});

test("un mot de passe vide ne part pas du tout", async () => {
  const { demandes, resultat } = await avecReponse("", () => pwnedCount(""));
  assert.equal(resultat, 0);
  assert.equal(demandes.length, 0);
});

test("la vérification à la saisie est désactivée tant qu'on ne l'a pas choisie", () => {
  const lu = (brut: string | null) => lireReglage(brut, CHOIX_FUITES_A_LA_SAISIE, FUITES_A_LA_SAISIE_PAR_DEFAUT);
  assert.equal(FUITES_A_LA_SAISIE_PAR_DEFAUT, 0);
  assert.equal(lu("1"), 1);
  assert.equal(lu("0"), 0);
  for (const brut of [null, "", "2", "oui", "true", "01x"]) assert.equal(lu(brut), 0, String(brut));
});
