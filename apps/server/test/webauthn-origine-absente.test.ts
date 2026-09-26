import { test } from "node:test";
import assert from "node:assert/strict";

// Le cas que le correctif du rpID ne couvrait PAS, et que j'avais annoncé comme couvert.
//
// « Poser WEBAUTHN_ORIGIN, sinon le serveur ne démarre pas » était faux : le refus de démarrer
// ne vise qu'une valeur ILLISIBLE. La variable simplement ABSENTE retombe sur le repli de
// développement, le serveur monte sans un mot, et `rpID` vaut « localhost ». Mesuré de
// l'extérieur le 2026-09-26 sur l'instance publique :
//
//     $ curl -s https://pass.ghostsuite.cloud/.well-known/webauthn
//     {"origins":["http://localhost:5173"]}
//
// C'est-à-dire la panne intacte, sur un serveur en parfaite santé apparente.

async function chargerAvec(valeur: string | undefined, cas: string) {
  const avant = process.env.WEBAUTHN_ORIGIN;
  if (valeur === undefined) delete process.env.WEBAUTHN_ORIGIN;
  else process.env.WEBAUTHN_ORIGIN = valeur;
  try {
    // La chaîne de requête force un module neuf : les constantes lisent l'environnement à
    // l'import, une seule fois.
    return await import(`../src/services/webauthn.js?cas=${cas}`);
  } finally {
    if (avant === undefined) delete process.env.WEBAUTHN_ORIGIN;
    else process.env.WEBAUTHN_ORIGIN = avant;
  }
}

test("absente, l'origine se replie sur le développement ET le dit", async () => {
  const m = await chargerAvec(undefined, "absente");
  assert.equal(m.ORIGIN, m.ORIGINE_DE_DEVELOPPEMENT);
  assert.equal(m.RP_ID, "localhost");
  const avis = m.avertissementDOrigine();
  assert.ok(avis, "l'oubli doit produire un avertissement, pas le silence");
  assert.match(avis, /WEBAUTHN_ORIGIN/);
  // L'avertissement doit porter le message que l'utilisateur verra, sinon personne ne fera le
  // lien entre une ligne de journal au démarrage et un clic qui échoue trois jours plus tard.
  assert.match(avis, /invalid for this domain/);
});

test("posée, elle est prise telle quelle et rien n'est signalé", async () => {
  const m = await chargerAvec("https://pass.ghostsuite.cloud", "posee");
  assert.equal(m.ORIGIN, "https://pass.ghostsuite.cloud");
  assert.equal(m.RP_ID, "pass.ghostsuite.cloud");
  assert.equal(m.avertissementDOrigine(), null);
});

test("posée mais vide, c'est un oubli et non un choix", async () => {
  // Le cas que l'IaC produit toute seule : une variable déclarée sans valeur. `!== undefined`
  // la prendrait pour une configuration, l'avertissement disparaîtrait, et WebAuthn resterait
  // cassé sans que rien ne le dise.
  const m = await chargerAvec("   ", "vide");
  assert.equal(m.ORIGIN, m.ORIGINE_DE_DEVELOPPEMENT);
  assert.ok(
    m.avertissementDOrigine(),
    "une valeur blanche doit compter comme absente",
  );
});

test("le démarrage APPELLE cet avertissement, et ne se contente pas de l'exporter", async () => {
  // Le défaut le plus fréquent de cette suite : la chose existe, et rien ne la lit. Les trois
  // tests ci-dessus prouvent que la fonction dit juste ; aucun ne prouve qu'on l'écoute. Un
  // avertissement jamais appelé est exactement l'état d'avant, avec du code en plus.
  //
  // Ce contrôle lit la source parce que l'appel vit dans le point d'entrée, qui se met à écouter
  // sur un port. Il est grossier, et il attrape la seule chose qu'aucun autre n'attrape ici.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /avertissementDOrigine\s*\(/,
    "index.ts n'appelle pas avertissementDOrigine",
  );
  assert.match(
    source,
    /log\.warn\(/,
    "index.ts ne journalise pas l'avertissement",
  );
});
