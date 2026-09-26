// Plusieurs adresses pour un même identifiant — et surtout : elles reviennent.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Ce n'était pas une fonction manquante, c'était une PERTE. Le format chiffré
// porte `uris` au pluriel depuis l'origine (`crates/ghostpass-crypto/src/vault.rs`,
// `pub uris: Vec<String>`), et les trois clients le rabotaient à l'entrée comme
// à la sortie :
//
//     web, crypto.ts   écriture   uris: login.url ? [login.url] : []
//     web, crypto.ts   lecture    url: item.data.data.uris?.[0] ?? ""
//
// Un élément importé avec `connect.ulys.com`, `user.ulys.com` et `ulys.com`
// s'ouvrait donc avec une seule adresse, et la PREMIÈRE MODIFICATION réécrivait
// l'élément avec cette seule adresse. Les deux autres disparaissaient sans un
// message, sur des données que le serveur ne sait pas relire pour nous.
//
// CE QUE CES TESTS SURVEILLENT, ET COMMENT ILS ÉCHOUENT
// -----------------------------------------------------
// Chaque test ci-dessous affirme qu'une LISTE ENTIÈRE survit à un tour complet,
// avec le vrai WebAssembly — pas une maquette du chiffrement, parce que c'est
// la couche qui perdait la donnée. Ils sont écrits pour rougir sur la mutation
// exacte qui reviendra : remettre `uris[0]` à la lecture, ou `[url]` à
// l'écriture, dans n'importe laquelle des quatre paires du fichier `crypto.ts`.
//
// Le tour du FORMULAIRE (`cycleDEdition`) est le plus important des cinq : il
// refait ce que fait l'écran quand on modifie un mot de passe sans toucher aux
// adresses. C'est le geste qui entérinait la perte, et aucun test du modèle
// seul ne l'aurait attrapé.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import init, { Account } from "ghostpass-crypto-wasm";
import {
  createOrg,
  decryptItem,
  decryptOrgItem,
  decryptVaultItem,
  encryptItem,
  encryptLogin,
  encryptOrgLogin,
  type DecryptedItem,
} from "../src/lib/crypto";
import { depuisEntree } from "../src/components/FormulaireEntree";
import { parseCsvDetaille } from "../src/lib/csv";
import { depuisLigneCsv, versCsv } from "../src/lib/export";
import { analyser } from "../src/lib/importNavigateur";
import type { VaultEntry } from "../src/lib/vault";

// Le vrai module WASM, chargé depuis le paquet construit par `wasm-pack`.
//
// `ensureCryptoReady()` n'est pas utilisable ici : il donne à `init` le CHEMIN
// `/ghostpass_crypto_wasm_bg.wasm`, servi par Next depuis `public/`. Sous Node
// il n'y a pas de serveur pour le rendre. On passe donc les octets directement,
// ce que `init` accepte aussi.
//
// Et on échoue FORT si le paquet manque, plutôt que de sauter les tests : une
// suite qui se met en vert parce qu'elle n'a pas pu regarder est pire que rouge.
// La CI construit le WASM avant `npm test` (`.gitea/workflows/ci.yml`), et
// `npm run build` ne passe pas non plus sans lui.
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

const MOT_DE_PASSE = "hunter2-correct-horse";
const COURRIEL = "kevin@stackops.ch";

/// Les trois adresses du cas de Kevin : un même compte, trois portes d'entrée.
const ULYS = ["connect.ulys.com", "user.ulys.com", "https://ulys.com/login"];

function compte(): Account {
  return Account.register(MOT_DE_PASSE, COURRIEL).account();
}

/// L'entrée telle que la liste du coffre la porte : l'élément déchiffré, plus
/// ce que le serveur garde en clair.
function entree(item: DecryptedItem): VaultEntry {
  return { ...item, id: "abc", updatedAt: 0 };
}

// ─── Le modèle : la liste survit à l'aller-retour ───

test("un identifiant personnel garde TOUTES ses adresses au tour chiffré", () => {
  const account = compte();
  const enc = encryptItem(account, {
    kind: "login",
    name: "Ulys",
    username: "kevin",
    password: "s3cr3t",
    urls: ULYS,
  });
  const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.equal(relu.kind, "item");
  assert.deepEqual(relu.kind === "item" ? relu.item.urls : null, ULYS);
});

// L'ORDRE compte autant que le nombre. La première adresse est celle qui décide
// du favicon et de la vignette de liste : la voir changer d'un chargement à
// l'autre ferait clignoter la liste sans raison visible.
test("l'ordre des adresses est celui de la saisie, pas un ordre de hasard", () => {
  const account = compte();
  const enc = encryptItem(account, { kind: "login", name: "Ulys", urls: [...ULYS].reverse() });
  const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.deepEqual(relu.kind === "item" ? relu.item.urls : null, [...ULYS].reverse());
});

test("un secret d'équipe garde TOUTES ses adresses, par les deux lectures", () => {
  const account = compte();
  const { org } = createOrg(account);
  const enc = encryptOrgLogin(org, {
    name: "Ulys",
    username: "kevin",
    password: "s3cr3t",
    urls: ULYS,
  });
  assert.deepEqual(decryptOrgItem(org, enc.encryptedKey, enc.encryptedData).urls, ULYS);

  // `decryptItem` est l'AUTRE lecture d'un item — celle du coffre personnel par
  // la clé de compte. Les deux rabotaient à `uris[0]`, et corriger l'une sans
  // l'autre laisserait la moitié du produit tronquer encore.
  const perso = encryptLogin(account, {
    name: "Ulys",
    username: "kevin",
    password: "s3cr3t",
    urls: ULYS,
  });
  assert.deepEqual(decryptItem(account, perso.encryptedKey, perso.encryptedData).urls, ULYS);
});

// ─── Le formulaire : modifier sans toucher aux adresses ne les perd pas ───

/// Le geste réel de l'écran d'édition : ouvrir l'entrée, la porter dans le
/// formulaire, changer une chose, réenregistrer.
function cycleDEdition(account: Account, item: DecryptedItem, motDePasse: string): DecryptedItem {
  const saisie = depuisEntree(entree(item));
  const enc = encryptItem(account, { ...saisie, password: motDePasse });
  const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.equal(relu.kind, "item");
  return (relu as { kind: "item"; item: DecryptedItem }).item;
}

// LE test du lot. C'est ce chemin-là qui perdait les adresses : la donnée
// partait entière, revenait tronquée, et la sauvegarde suivante entérinait la
// perte. Trois passages plutôt qu'un : une troncature qui ne mordrait qu'à
// partir du deuxième enregistrement passerait sous un aller-retour unique.
test("modifier un identifiant ne rabote pas ses adresses, même trois fois de suite", () => {
  const account = compte();
  const enc = encryptItem(account, { kind: "login", name: "Ulys", urls: ULYS });
  const ouvert = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.equal(ouvert.kind, "item");
  let item = (ouvert as { kind: "item"; item: DecryptedItem }).item;

  for (const nouveau of ["premier", "deuxieme", "troisieme"]) {
    item = cycleDEdition(account, item, nouveau);
    assert.deepEqual(item.urls, ULYS, `les adresses ont bougé au passage « ${nouveau} »`);
  }
});

// Le formulaire montre toujours au moins une case, même pour une entrée sans
// adresse. Cette case vide ne doit pas devenir une adresse vide dans le coffre.
test("une case d'adresse laissée vide n'entre pas dans la charge chiffrée", () => {
  const account = compte();
  const sansAdresse = { ...entree({} as DecryptedItem), kind: "login" as const, urls: [] };
  const saisie = depuisEntree(sansAdresse as VaultEntry);
  assert.deepEqual(saisie.urls, [""], "le formulaire doit offrir une case, vide");

  const enc = encryptItem(account, { kind: "login", name: "x", urls: ["  ", "", " ulys.com "] });
  const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  assert.deepEqual(relu.kind === "item" ? relu.item.urls : null, ["ulys.com"]);
});

// ─── Le rapprochement de site : ce que la liste rend possible ───

// C'est la raison d'être de la fonction : `connect.ulys.com` et `user.ulys.com`
// doivent proposer la même entrée. Le rapprochement lui-même vit sur les
// mobiles (`SiteMatching.swift`, `RapprochementDeSite.kt`) — l'application web
// n'a AUCUN équivalent, faute de remplissage automatique à alimenter. Ce qu'on
// peut donc éprouver ici est la condition nécessaire, et elle n'est pas rien :
// les deux hôtes sont encore là après le tour complet. Tant qu'ils n'y étaient
// pas, aucune règle de rapprochement, si juste soit-elle, ne pouvait aboutir.
test("les deux hôtes d'un même service survivent, de quoi les rapprocher tous deux", () => {
  const account = compte();
  const enc = encryptItem(account, {
    kind: "login",
    name: "Ulys",
    urls: ["connect.ulys.com", "user.ulys.com"],
  });
  const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
  const urls = relu.kind === "item" ? relu.item.urls : [];
  assert.ok(urls.includes("connect.ulys.com"));
  assert.ok(urls.includes("user.ulys.com"));
});

// ─── La sortie et l'entrée : l'export ne doit pas recréer la perte ───

test("l'export CSV écrit toutes les adresses, et l'import les relit toutes", () => {
  const item: DecryptedItem = {
    kind: "login",
    name: "Ulys",
    folder: "Perso",
    username: "kevin",
    password: "s3cr3t",
    urls: ULYS,
    totp: "JBSWY3DPEHPK3PXP",
    passwordHistory: [],
    note: "",
    cardholder: "",
    cardNumber: "",
    cardExp: "",
    cardCode: "",
  };
  const csv = versCsv([entree(item)]);
  for (const adresse of ULYS) {
    assert.ok(csv.includes(adresse), `« ${adresse} » manque au fichier exporté`);
  }

  // Le tour complet, et pas seulement la présence des chaînes : un fichier qui
  // contient les trois adresses mais qu'on relit en une seule recréerait la
  // perte au réimport, c'est-à-dire exactement à la migration.
  const { lignes } = parseCsvDetaille(csv);
  assert.equal(lignes.length, 1);
  assert.deepEqual(depuisLigneCsv(lignes[0]!.champs, "(sans nom)").urls, ULYS);
});

test("un CSV dont la cellule d'adresses tient sur plusieurs lignes entre entier", () => {
  const a = analyser(
    'name,url,username,password,note\nUlys,"connect.ulys.com\nuser.ulys.com",kevin,s3cr3t,\n',
    [],
    "(sans nom)",
  );
  assert.equal(a.aImporter.length, 1);
  assert.deepEqual(a.aImporter[0]!.urls, ["connect.ulys.com", "user.ulys.com"]);
});

// Le dédoublonnage regarde TOUTES les adresses. S'il ne regardait que la
// première, une entrée qui en porte une de plus passerait pour un doublon et
// serait rejetée — et l'adresse supplémentaire serait perdue à l'import même,
// c'est-à-dire au moment précis où l'on migre depuis un autre gestionnaire.
test("une entrée qui porte une adresse de plus n'est pas un doublon", () => {
  const a = analyser(
    "name,url,username,password,note\n" +
      "Ulys,connect.ulys.com,kevin,s3cr3t,\n" +
      'Ulys,"connect.ulys.com\nuser.ulys.com",kevin,s3cr3t,\n',
    [],
    "(sans nom)",
  );
  assert.equal(a.aImporter.length, 2);
  assert.deepEqual(a.ignorees, []);
});

// ─── Un appelant qui ne parle pas d'adresses ───

// Toutes les entrées n'en ont pas, et tous les appelants n'en fournissent pas.
// Le champ étant OPTIONNEL à l'écriture, l'omettre doit produire une liste
// vide, jamais une erreur de sérialisation : le cœur Rust déclare
// `uris: Vec<String>` SANS `#[serde(default)]`, donc un `uris` absent de la
// charge fait échouer le chiffrement — et ferait échouer l'enregistrement de
// toute note, de toute carte, et de tout identifiant sans site.
test("un appelant qui ne donne aucune adresse écrit une liste vide, pas une panne", () => {
  const account = compte();
  for (const urls of [undefined, []]) {
    const enc = encryptItem(account, { kind: "login", name: "Code du portail", urls });
    const relu = decryptVaultItem(account, enc.encryptedKey, enc.encryptedData);
    assert.deepEqual(relu.kind === "item" ? relu.item.urls : null, []);
  }

  const note = encryptItem(account, { kind: "note", name: "Wifi", note: "abc" });
  const relue = decryptVaultItem(account, note.encryptedKey, note.encryptedData);
  assert.deepEqual(relue.kind === "item" ? relue.item.urls : null, []);
});
