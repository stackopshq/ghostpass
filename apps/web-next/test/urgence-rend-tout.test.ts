// Ce qu'un contact d'urgence LIT, comparé à ce que le propriétaire lit.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// La promesse est publiée : « un proche peut ouvrir votre coffre après un délai que vous
// fixez » (page produit GhostPass). Mais il y avait DEUX projections pour un seul format
// chiffré — celle du compte, complète, et celle de l'urgence, recopiée en plus courte :
//
//     name, username, password, urls
//
// Conséquences, toutes silencieuses, sur des données déjà déchiffrées dans le navigateur du
// contact puis jetées à la projection :
//
//     note sécurisée    VIDE — son contenu vit dans `data.data.content`
//     note d'un login   VIDE — elle vit sur `item.notes`, pas dans `data.data`
//     second facteur    ABSENT — un compte à 2FA restait inaccessible
//     carte             RIEN que son nom : aucun de ses champs ne passe par username
//
// C'est la note qui coûtait le plus cher : elle est souvent la seule chose qu'on laisse
// vraiment à quelqu'un.
//
// CE QUE CES TESTS SURVEILLENT
// ----------------------------
// Un tour complet et RÉEL : le grantor chiffre, scelle sa clé pour le contact, le contact
// ouvre et relit. Aucun faux déchiffreur — le cœur WASM est celui de production. Chaque test
// compare la lecture du contact à celle du propriétaire sur le MÊME item chiffré : c'est
// l'égalité des deux lectures qui est la propriété, et non une liste de champs à jour.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import init, { Account } from "ghostpass-crypto-wasm";
import {
  FOLDERS_ITEM_NAME,
  decryptEmergencyItem,
  decryptVaultItem,
  encryptItem,
  openEmergency,
  sealUserKeyFor,
} from "../src/lib/crypto";

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

/// Le grantor, le contact, et la poignée que le second obtient du premier.
function scene(): {
  grantor: Account;
  poignee: ReturnType<typeof openEmergency>;
} {
  const grantor = Account.register(
    "mot-de-passe-du-grantor-42",
    "alice@stackops.ch",
  ).account();
  const contact = Account.register(
    "mot-de-passe-du-contact-42",
    "bob@stackops.ch",
  ).account();
  const scelle = sealUserKeyFor(grantor, contact.public_key);
  return {
    grantor,
    poignee: openEmergency(contact, grantor.public_key, scelle),
  };
}

/// Ce que le PROPRIÉTAIRE lit du même item chiffré — la référence.
function luParLeProprietaire(
  grantor: Account,
  enc: { encryptedKey: string; encryptedData: string },
) {
  const r = decryptVaultItem(grantor, enc.encryptedKey, enc.encryptedData);
  assert.equal(r.kind, "item");
  return r.kind === "item" ? r.item : null;
}

test("une note sécurisée arrive entière au contact d'urgence", () => {
  const { grantor, poignee } = scene();
  const CONTENU =
    "Le testament est chez Maître Roux, 12 rue du Port.\nLe coffre : 4-8-15.";
  const enc = encryptItem(grantor, {
    kind: "note",
    name: "À lire si je ne suis plus là",
    note: CONTENU,
  });

  const contact = decryptEmergencyItem(
    poignee,
    enc.encryptedKey,
    enc.encryptedData,
  );
  assert.ok(
    contact,
    "une note n'est pas un item de service : elle doit être rendue",
  );
  assert.equal(
    contact.note,
    CONTENU,
    "la note arrivait VIDE — c'est le défaut que ce test garde",
  );
  assert.deepEqual(contact, luParLeProprietaire(grantor, enc));
});

test("un identifiant arrive avec sa note et son second facteur", () => {
  const { grantor, poignee } = scene();
  const enc = encryptItem(grantor, {
    kind: "login",
    name: "Banque",
    username: "alice",
    password: "s3cr3t",
    urls: ["banque.ch", "m.banque.ch"],
    totp: "JBSWY3DPEHPK3PXP",
    note: "Le conseiller s'appelle Marc.",
  });

  const contact = decryptEmergencyItem(
    poignee,
    enc.encryptedKey,
    enc.encryptedData,
  );
  assert.ok(contact);
  assert.equal(
    contact.totp,
    "JBSWY3DPEHPK3PXP",
    "sans le secret, un compte à 2FA reste fermé",
  );
  assert.equal(contact.note, "Le conseiller s'appelle Marc.");
  assert.deepEqual(contact.urls, ["banque.ch", "m.banque.ch"]);
  assert.deepEqual(contact, luParLeProprietaire(grantor, enc));
});

test("une carte arrive avec ses quatre champs, et pas seulement son nom", () => {
  const { grantor, poignee } = scene();
  const enc = encryptItem(grantor, {
    kind: "card",
    name: "Visa",
    cardholder: "Alice Allioli",
    cardNumber: "4111111111111111",
    cardExp: "04/2030",
    cardCode: "123",
  });

  const contact = decryptEmergencyItem(
    poignee,
    enc.encryptedKey,
    enc.encryptedData,
  );
  assert.ok(contact);
  assert.equal(
    contact.cardNumber,
    "4111111111111111",
    "la carte n'affichait que son nom",
  );
  assert.equal(contact.cardholder, "Alice Allioli");
  assert.deepEqual(contact, luParLeProprietaire(grantor, enc));
});

test("les items de SERVICE ne sont pas rendus comme des entrées", () => {
  const { grantor, poignee } = scene();
  // Le registre de dossiers : une note à nom réservé, pas un secret. Le nom vient de la
  // CONSTANTE et non d'une chaîne recopiée — il commence par un caractère nul, précisément
  // pour qu'aucun nom saisi par un humain ne puisse le contrefaire.
  const enc = encryptItem(grantor, {
    kind: "note",
    name: FOLDERS_ITEM_NAME,
    note: '["Banque"]',
  });
  assert.equal(
    decryptEmergencyItem(poignee, enc.encryptedKey, enc.encryptedData),
    null,
    "le registre s'affichait comme une entrée vide dans la liste du contact",
  );
});
