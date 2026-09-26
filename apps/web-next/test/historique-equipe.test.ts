// L'historique des mots de passe d'un secret d'équipe — et sa disparition.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Même mécanisme que la troncature des adresses, sur un autre champ. Les deux
// écrans d'équipe construisent leur formulaire avec une forme LOCALE à eux —
// `CollectionPane.vide()` et `DetailOrg.formulaireVide()` — et la passent
// entière à `encryptOrgLogin`, qui écrit `password_history: login.passwordHistory ?? []`.
//
// Le champ n'étant pas dans cette forme, il valait `undefined`, et chaque
// modification réécrivait l'élément avec un historique VIDE.
//
// Ce qui rendait la chose invisible : le web n'affiche l'historique nulle part.
// iOS et Android le construisent ET l'affichent. On déplaçait donc un mot de
// passe personnel vers une équipe — `VaultScreen.deplacerVersEquipe` transmet
// bien l'historique — et la première modification faite dans l'équipe le jetait,
// au vu de personne, sur des données que le serveur ne sait pas relire.
//
// `folder` subissait exactement le même sort aux deux mêmes lignes.
//
// CE QUE CES TESTS SURVEILLENT
// -----------------------------
// La règle des vingt versions vivait EN DUR dans `VaultScreen`, recopiée nulle
// part ailleurs. Elle est maintenant dans `vault.ts`, et ces tests la tiennent
// à un seul endroit pour les trois écrans. Ils rougissent sur la mutation qui
// reviendra : retirer `passwordHistory` d'une des deux formes de formulaire
// d'équipe, ou rendre `historiqueApresModification` sans son plafond.
//
// Le tour chiffré passe par le vrai WebAssembly, parce que c'est la couche qui
// perdait la donnée.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import init, { Account } from "ghostpass-crypto-wasm";
import {
  createOrg,
  decryptOrgItem,
  encryptOrgLogin,
  type DecryptedItem,
} from "../src/lib/crypto";
import {
  historiqueApresModification,
  VERSIONS_DE_MOT_DE_PASSE_GARDEES,
} from "../src/lib/vault";
import {
  saisieDepuisElement,
  saisieEquipeVide,
} from "../src/lib/formulaireEquipe";

// Échouer FORT si le paquet manque, plutôt que de sauter : une suite qui se met
// en vert parce qu'elle n'a pas pu regarder est pire que rouge.
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

function compte(): Account {
  return Account.register("hunter2-correct-horse", "kevin@stackops.ch").account();
}

// ─── La règle, seule ───

test("un mot de passe remplacé rejoint l'historique, en tête", () => {
  assert.deepEqual(historiqueApresModification("ancien", "nouveau", []), ["ancien"]);
  assert.deepEqual(historiqueApresModification("b", "c", ["a"]), ["b", "a"]);
});

// Sans ce test, ouvrir une entrée et la réenregistrer sans y toucher empilerait
// la même valeur jusqu'à chasser le véritable historique.
test("un mot de passe inchangé n'ajoute rien", () => {
  assert.deepEqual(historiqueApresModification("pareil", "pareil", ["a"]), ["a"]);
});

test("une création — pas d'ancien — n'invente pas d'historique", () => {
  assert.deepEqual(historiqueApresModification(undefined, "neuf", undefined), []);
  assert.deepEqual(historiqueApresModification("", "neuf", ["a"]), ["a"]);
});

// Sans plafond, l'entrée chiffrée grossit sans fin.
test("l'historique est plafonné, et c'est le plus ancien qui tombe", () => {
  let h: string[] = [];
  for (let i = 0; i <= VERSIONS_DE_MOT_DE_PASSE_GARDEES + 4; i++) {
    h = historiqueApresModification(`mdp-${i}`, `mdp-${i + 1}`, h);
  }
  assert.equal(h.length, VERSIONS_DE_MOT_DE_PASSE_GARDEES);
  assert.equal(h[0], `mdp-${VERSIONS_DE_MOT_DE_PASSE_GARDEES + 4}`);
  assert.equal(h.at(-1), `mdp-${5}`);
});

// ─── Le tour chiffré : ce que la modification d'équipe écrivait vraiment ───

test("un secret d'équipe garde son historique au tour chiffré", () => {
  const { org } = createOrg(compte());
  const enc = encryptOrgLogin(org, {
    name: "Ulys",
    username: "kevin",
    password: "troisieme",
    passwordHistory: ["deuxieme", "premier"],
  });
  const relu = decryptOrgItem(org, enc.encryptedKey, enc.encryptedData);
  assert.deepEqual(relu.passwordHistory, ["deuxieme", "premier"]);
});

// LE test de ce fichier. Il refait le geste exact qui effaçait : on ouvre un
// élément d'équipe qui a un historique, on change le mot de passe, on
// réenregistre. Avant la correction, `relu2.passwordHistory` valait [].
test("modifier un secret d'équipe conserve l'historique et y ajoute l'ancien", () => {
  const { org } = createOrg(compte());

  const premier = encryptOrgLogin(org, {
    name: "Ulys",
    username: "kevin",
    password: "deuxieme",
    passwordHistory: ["premier"],
    folder: "Fournisseurs",
  });
  const enCours = decryptOrgItem(org, premier.encryptedKey, premier.encryptedData);

  // Ce que l'écran d'équipe pré-remplit, puis ce qu'il renvoie.
  const saisie = {
    name: enCours.name,
    username: enCours.username,
    password: "troisieme",
    urls: enCours.urls,
    notes: enCours.note,
    totp: enCours.totp,
    passwordHistory: enCours.passwordHistory,
    folder: enCours.folder,
  };
  const second = encryptOrgLogin(org, {
    ...saisie,
    passwordHistory: historiqueApresModification(
      enCours.password,
      saisie.password,
      saisie.passwordHistory,
    ),
  });
  const relu = decryptOrgItem(org, second.encryptedKey, second.encryptedData);

  assert.deepEqual(relu.passwordHistory, ["deuxieme", "premier"]);
  assert.equal(relu.password, "troisieme");
  // `folder` tombait aux deux mêmes lignes, pour la même raison.
  assert.equal(relu.folder, "Fournisseurs");
});

// Trois modifications d'affilée : c'est la répétition qui rendait la perte
// définitive, un test à un seul tour ne l'aurait pas montrée.
test("trois modifications d'affilée empilent, elles n'écrasent pas", () => {
  const { org } = createOrg(compte());
  let courant = { mdp: "v1", historique: [] as string[] };

  for (const suivant of ["v2", "v3", "v4"]) {
    const h = historiqueApresModification(courant.mdp, suivant, courant.historique);
    const enc = encryptOrgLogin(org, {
      name: "Ulys",
      username: "kevin",
      password: suivant,
      passwordHistory: h,
    });
    const relu = decryptOrgItem(org, enc.encryptedKey, enc.encryptedData);
    courant = { mdp: relu.password, historique: relu.passwordHistory };
  }

  assert.deepEqual(courant.historique, ["v3", "v2", "v1"]);
});

// ─── La forme du formulaire : c'est elle qui décide de ce qui est écrit ───
//
// Ces deux tests-ci sont ceux qui rougissent sur LA mutation qui reviendra :
// retirer un champ de la saisie d'équipe. Les tests du tour chiffré, eux,
// resteraient verts — ils appellent `encryptOrgLogin` directement et ne
// passent pas par le formulaire.

test("la saisie d'équipe porte les champs qu'aucune case ne montre", () => {
  const vierge = saisieEquipeVide();
  assert.deepEqual(vierge.passwordHistory, []);
  assert.equal(vierge.folder, "");
});

test("ouvrir un élément d'équipe pré-remplit son historique et son dossier", () => {
  // `emptyItem` n'est pas exporté, et l'exporter pour un test élargirait
  // l'interface de `crypto.ts` sans raison de production.
  const item: DecryptedItem = {
    kind: "login",
    name: "Ulys",
    folder: "Fournisseurs",
    username: "kevin",
    password: "troisieme",
    urls: ["connect.ulys.com", "user.ulys.com"],
    totp: "",
    passwordHistory: ["deuxieme", "premier"],
    note: "",
    cardholder: "",
    cardNumber: "",
    cardExp: "",
    cardCode: "",
  };
  const saisie = saisieDepuisElement(item);
  assert.deepEqual(saisie.passwordHistory, ["deuxieme", "premier"]);
  assert.equal(saisie.folder, "Fournisseurs");
  assert.deepEqual(saisie.urls, ["connect.ulys.com", "user.ulys.com"]);
});

// Deux formulaires vierges ne doivent pas partager leurs tableaux : sans la
// recopie, la frappe dans l'un apparaîtrait dans le suivant.
test("deux saisies vierges ne partagent ni adresses ni historique", () => {
  const a = saisieEquipeVide();
  const b = saisieEquipeVide();
  a.urls.push("exemple.ch");
  a.passwordHistory.push("fuite");
  assert.deepEqual(b.urls, [""]);
  assert.deepEqual(b.passwordHistory, []);
});
