// Une couleur par organisation — le contrat partagé avec le client iOS.
//
// Ces vecteurs ne sont pas décoratifs : ils existent à l'identique dans
// `ContractTests.swift`. Si les deux clients dérivent différemment, la même
// organisation prend deux couleurs selon l'appareil, et personne ne saura
// laquelle est « la bonne » — il n'y en a pas, il n'y a que du désaccord.
//
// Le registre est partagé par trois clients. C'est donc au LECTEUR d'être
// robuste : une valeur qu'un seul d'entre eux comprend finira par y entrer,
// et elle ne doit pas se rendre en noir sur les autres.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  couleurAttribuee,
  couleurOrg,
  definirCouleur,
  effacerCouleur,
  estCouleurValide,
  lireRegistreCouleurs,
  ORG_COLORS_ITEM_NAME,
  PALETTE_ORG,
} from "../src/lib/couleursOrg";

// ─── Le nom réservé de l'entrée ───

test("le nom réservé du registre est celui du contrat, octet pour octet", () => {
  // Écrit ici en caractères explicites plutôt qu'en recopiant la constante :
  // un test qui compare une valeur à elle-même passe toujours. Le premier
  // octet est un NUL — c'est ce qui masque l'entrée dans la liste du coffre.
  assert.equal(ORG_COLORS_ITEM_NAME, String.fromCharCode(0) + "gp:orgcolors");
  assert.equal(ORG_COLORS_ITEM_NAME.charCodeAt(0), 0);
  assert.equal([...new TextEncoder().encode(ORG_COLORS_ITEM_NAME)].length, 13);
});

// ─── Couleur attribuée : les quatre vecteurs figés avec iOS ───

const VECTEURS: Array<[string, string]> = [
  ["org_stackops", "#7A8CFF"],
  ["org_1", "#4C8DFF"],
  ["org_2", "#B57BFF"],
  ["ORG-9f3c-4d2e", "#FFC53D"],
];

for (const [orgId, attendu] of VECTEURS) {
  test(`couleur attribuée : ${orgId} → ${attendu}`, () => {
    assert.equal(
      couleurAttribuee(orgId),
      attendu,
      `contrat rompu avec iOS pour « ${orgId} » — la même organisation prendrait deux couleurs`,
    );
  });
}

test("la palette est celle du contrat, dans cet ordre", () => {
  assert.deepEqual(
    [...PALETTE_ORG],
    ["#4C8DFF", "#B57BFF", "#00C2A8", "#FF8A3D", "#E75480", "#3FBF5F", "#FFC53D", "#7A8CFF"],
  );
});

// ─── Ce sont des OCTETS UTF-8, pas des points de code ───
//
// La distinction ne se voit sur aucun identifiant ASCII : les quatre vecteurs
// ci-dessus passent avec l'une comme avec l'autre implémentation. Elle ne se
// voit que sur un identifiant non-ASCII, et c'est exactement là qu'un client
// écrit à la va-vite (`charCodeAt`, comme `avatarColor` juste à côté dans
// `vault.ts`) diverge d'iOS sans que rien ne le signale.

test("un identifiant non-ASCII se hache sur ses octets UTF-8", () => {
  // "org_éclair" : « é » vaut 0xC3 0xA9 (195 + 169 = 364) en UTF-8, et 233 en
  // point de code. Somme des octets = 1310 → 1310 % 8 = 6 → palette[6].
  assert.equal(couleurAttribuee("org_éclair"), "#FFC53D");

  // Le même identifiant haché sur les points de code donnerait palette[3].
  // L'assertion existe pour que quiconque « simplifierait » en `charCodeAt`
  // voie le test rougir plutôt que de casser silencieusement iOS.
  let pointsDeCode = 0;
  for (const c of "org_éclair") pointsDeCode += c.codePointAt(0)!;
  assert.equal(PALETTE_ORG[pointsDeCode % 8], "#FF8A3D");
  assert.notEqual(couleurAttribuee("org_éclair"), PALETTE_ORG[pointsDeCode % 8]);
});

// ─── Validité d'une valeur ───

test("seul un #RRGGBB à six chiffres est une couleur", () => {
  for (const bon of ["#4C8DFF", "#000000", "#ffffff", "#AbCdEf"]) {
    assert.equal(estCouleurValide(bon), true, `${bon} devrait être accepté`);
  }
  for (const mauvais of [
    "#ABC", // forme courte : comprise par CSS, pas par le contrat
    "#4C8DFFF",
    "4C8DFF", // sans dièse
    "#GGGGGG",
    "rgb(1,2,3)",
    "",
    "   ",
    null,
    undefined,
    42,
    {},
    ["#4C8DFF"],
  ]) {
    assert.equal(estCouleurValide(mauvais), false, `${JSON.stringify(mauvais)} devrait être refusé`);
  }
});

// ─── Lecture du registre : plat, tolérant, jamais en panne ───

test("le registre est un objet plat de #RRGGBB", () => {
  assert.deepEqual(lireRegistreCouleurs({ org_1: "#FF8A3D", org_2: "#00C2A8" }), {
    org_1: "#FF8A3D",
    org_2: "#00C2A8",
  });
});

test("une valeur invalide est écartée, pas rendue en noir", () => {
  const registre = lireRegistreCouleurs({
    bonne: "#E75480",
    courte: "#ABC",
    vide: "",
    nulle: null,
    nombre: 16711680,
    objet: { r: 1, g: 2, b: 3 },
    nommee: "rebeccapurple",
  });
  assert.deepEqual(registre, { bonne: "#E75480" });

  // Et la conséquence qui compte à l'écran : une entrée écartée retombe sur la
  // couleur attribuée, jamais sur du noir ni sur une chaîne vide.
  for (const orgId of ["courte", "vide", "nulle", "nombre", "objet", "nommee"]) {
    assert.equal(couleurOrg(registre, orgId), couleurAttribuee(orgId));
  }
});

test("la casse est ramenée à une seule écriture", () => {
  // `#4c8dff` et `#4C8DFF` sont la même couleur. Garder les deux orthographes
  // obligerait chaque client à le savoir pour cocher la bonne pastille.
  assert.deepEqual(lireRegistreCouleurs({ a: "#4c8dff" }), { a: "#4C8DFF" });
});

test("un registre qui n'est pas un objet plat vaut registre vide", () => {
  for (const brut of [null, undefined, 42, "texte", [], [{ org_1: "#4C8DFF" }]]) {
    assert.deepEqual(lireRegistreCouleurs(brut), {}, `${JSON.stringify(brut)} devrait valoir vide`);
  }
});

test("pas d'enveloppe ni de champ de version : la forme imbriquée est refusée", () => {
  // Un lecteur qui accepterait `{ version: 1, colors: {...} }` accepterait une
  // forme qu'iOS n'écrit pas et ne lit pas.
  assert.deepEqual(lireRegistreCouleurs({ version: 1, colors: { org_1: "#4C8DFF" } }), {});
});

// ─── Couleur effective ───

test("une couleur choisie l'emporte sur la couleur attribuée", () => {
  const registre = lireRegistreCouleurs({ org_1: "#3FBF5F" });
  assert.equal(couleurOrg(registre, "org_1"), "#3FBF5F");
  assert.notEqual(couleurOrg(registre, "org_1"), couleurAttribuee("org_1"));
});

test("clé absente = aucune couleur choisie", () => {
  assert.equal(couleurOrg({}, "org_stackops"), "#7A8CFF");
});

// ─── Écriture ───

test("choisir puis effacer ramène à la couleur attribuée", () => {
  const avec = definirCouleur({}, "org_1", "#e75480");
  assert.deepEqual(avec, { org_1: "#E75480" });
  assert.deepEqual(effacerCouleur(avec, "org_1"), {});
  assert.equal(couleurOrg(effacerCouleur(avec, "org_1"), "org_1"), "#4C8DFF");
});

test("écrire une valeur invalide n'entre pas dans le registre", () => {
  // L'écrivain n'a pas à être parfait, mais il n'a aucune raison d'ajouter
  // sciemment ce que les autres clients devront écarter.
  assert.deepEqual(definirCouleur({ org_2: "#00C2A8" }, "org_1", "#ABC"), { org_2: "#00C2A8" });
});

test("définir ne modifie pas le registre reçu", () => {
  const avant = { org_1: "#4C8DFF" };
  definirCouleur(avant, "org_2", "#B57BFF");
  effacerCouleur(avant, "org_1");
  assert.deepEqual(avant, { org_1: "#4C8DFF" });
});
