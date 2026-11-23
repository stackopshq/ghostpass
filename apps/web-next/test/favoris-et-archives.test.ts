// Favoris et archives : deux registres du coffre, et ce qu'ils font à la liste.
//
// Les favoris existaient sur iOS et Android, pas sur le web : leur registre
// s'affichait ici comme une note au nom illisible. Les archives sont nouvelles
// et passent par le contrat de ghostsuite. Ces tests tiennent les deux bouts :
// les noms octet pour octet face au fichier de contrat, et ce que chaque vue
// montre ET ce qu'elle cache.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import init, { Account } from "ghostpass-crypto-wasm";
import { decryptVaultItem, encryptIdList, encryptItem } from "../src/lib/crypto";
import {
  aEcrire,
  ARCHIVED_ITEM_NAME,
  basculer,
  FAVORITES_ITEM_NAME,
  lireListeDIdentifiants,
  REGISTRY_PREFIX,
} from "../src/lib/registres";
import { filtrerVisibles, TOUS, type VaultEntry } from "../src/lib/vault";

// Même chargement que `adresses-multiples.test.ts` : les octets du vrai paquet,
// et un échec franc s'il manque plutôt qu'une suite qui saute ses tests.
const CHEMIN_WASM = new URL(
  "../../../crates/ghostpass-crypto-wasm/pkg/ghostpass_crypto_wasm_bg.wasm",
  import.meta.url,
);
let octets: Buffer;
try {
  octets = readFileSync(CHEMIN_WASM);
} catch {
  throw new Error(
    `Paquet WASM absent (${CHEMIN_WASM.pathname}). ` +
      "Construire d'abord : (cd crates/ghostpass-crypto-wasm && wasm-pack build --target web).",
  );
}
await init({ module_or_path: octets });

const contrat = JSON.parse(
  readFileSync(new URL("../../../assets/vecteurs/contrat.json", import.meta.url), "utf-8"),
);

function compte(): Account {
  return Account.register("hunter2-correct-horse", "test@ghostpass.test").account();
}

// ─── Les noms : ceux du contrat, octet pour octet ───

test("les noms des registres sont ceux du fichier de contrat", () => {
  const r = contrat.registries;
  assert.equal(REGISTRY_PREFIX, r.prefix);
  assert.equal(FAVORITES_ITEM_NAME, r.names.favorites);
  assert.equal(ARCHIVED_ITEM_NAME, r.names.archived);
  // Le premier octet est un NUL, pas une espace : c'est lui qui masque l'entrée.
  assert.equal(ARCHIVED_ITEM_NAME.charCodeAt(0), 0);
});

// ─── Le tour chiffré ───

test("un registre de favoris écrit ici se relit comme registre, pas comme note", () => {
  const account = compte();
  const enc = encryptIdList(account, FAVORITES_ITEM_NAME, ["b", "a"]);
  const r = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.deepEqual(r, { kind: "favorites", ids: ["b", "a"] });
});

test("un registre d'archives se relit comme tel", () => {
  const account = compte();
  const enc = encryptIdList(account, ARCHIVED_ITEM_NAME, ["x"]);
  const r = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.deepEqual(r, { kind: "archived", ids: ["x"] });
});

test("un registre inconnu, écrit par un autre client, est masqué et non montré en note", () => {
  const account = compte();
  const enc = encryptItem(account, {
    kind: "note",
    name: `${REGISTRY_PREFIX}un-registre-de-demain`,
    folder: "",
    note: "[]",
  });
  const r = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.equal(r.kind, "registreInconnu");
});

test("une note ordinaire reste une note : le masquage ne porte que sur le préfixe", () => {
  const account = compte();
  // « gp:favorites » sans le NUL : un nom qu'une personne peut taper.
  const enc = encryptItem(account, { kind: "note", name: "gp:favorites", folder: "", note: "x" });
  const r = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.equal(r.kind, "item");
});

// ─── La lecture robuste ───

test("un registre illisible vaut vide, pas panne", () => {
  assert.deepEqual(lireListeDIdentifiants("pas du JSON"), []);
  assert.deepEqual(lireListeDIdentifiants('{"a":1}'), []);
  assert.deepEqual(lireListeDIdentifiants(undefined), []);
});

test("les valeurs qui ne sont pas des identifiants sont écartées, les autres gardées", () => {
  assert.deepEqual(lireListeDIdentifiants('["a", 3, null, "", "b", "a"]'), ["a", "b"]);
});

// ─── La bascule et l'élagage ───

test("basculer ajoute ce qui manque et retire ce qui y est", () => {
  assert.deepEqual([...basculer(new Set(["a"]), "b")].sort(), ["a", "b"]);
  assert.deepEqual([...basculer(new Set(["a", "b"]), "a")], ["b"]);
});

test("après une lecture complète, un identifiant mort est élagué et les vivants restent", () => {
  assert.deepEqual(aEcrire(new Set(["mort", "b", "a"]), new Set(["a", "b"]), true), ["a", "b"]);
});

test("après une lecture incomplète, rien n'est élagué", () => {
  // Une collection d'équipe a échoué : son élément est absent de la liste, pas
  // supprimé. L'élaguer effacerait un choix encore valable.
  assert.deepEqual(aEcrire(new Set(["equipe", "a"]), new Set(["a"]), false), ["a", "equipe"]);
});

// ─── Ce que chaque vue montre, et ce qu'elle cache ───

function e(id: string, extra: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id,
    updatedAt: 0,
    kind: "login",
    name: id,
    folder: "",
    username: "",
    password: "",
    urls: [],
    totp: "",
    passwordHistory: [],
    note: "",
    cardholder: "",
    cardNumber: "",
    cardExp: "",
    cardCode: "",
    ...extra,
  };
}

const partage = {
  orgId: "org1",
  orgName: "Équipe",
  collectionId: "c1",
  collectionName: "Serveurs",
  permission: "write",
};

const ITEMS = [
  e("perso"),
  e("favori"),
  e("archive"),
  e("equipe", { shared: partage }),
  e("range", { folder: "Travail" }),
];
const FAVORIS = new Set(["favori", "archive"]);
const ARCHIVES = new Set(["archive"]);
const ids = (l: VaultEntry[]) => l.map((i) => i.id).sort();

test("« Tous les éléments » montre tout sauf les archivés", () => {
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", TOUS, FAVORIS, ARCHIVES)), [
    "equipe",
    "favori",
    "perso",
    "range",
  ]);
});

test("les archives ne montrent que les archivés", () => {
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", { type: "archives" }, FAVORIS, ARCHIVES)), ["archive"]);
});

test("un favori archivé quitte les favoris", () => {
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", { type: "favoris" }, FAVORIS, ARCHIVES)), ["favori"]);
});

test("la recherche traverse les dossiers mais pas les archives", () => {
  const vue = { type: "dossier", chemin: "Ailleurs" } as const;
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "a", vue, FAVORIS, ARCHIVES)), ["favori", "range"]);
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "a", { type: "archives" }, FAVORIS, ARCHIVES)), ["archive"]);
});

test("le coffre personnel et celui d'une équipe se partagent la liste sans recouvrement", () => {
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", { type: "personnel" }, FAVORIS, ARCHIVES)), [
    "favori",
    "perso",
    "range",
  ]);
  const org = { type: "organisation", orgId: "org1", nom: "Équipe" } as const;
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", org, FAVORIS, ARCHIVES)), ["equipe"]);
});

test("un dossier ne montre que ce qui y est rangé", () => {
  const vue = { type: "dossier", chemin: "Travail" } as const;
  assert.deepEqual(ids(filtrerVisibles(ITEMS, "", vue, FAVORIS, ARCHIVES)), ["range"]);
});
