import { test } from "node:test";
import assert from "node:assert/strict";
import { derivezRpId } from "../src/services/webauthn.js";

// Ce fichier existe à cause d'une panne mesurée en production le 2026-09-26 : le serveur
// annonçait `rpID: "localhost"` à une page servie depuis un vrai domaine, et Chrome refusait
// chaque cérémonie WebAuthn avec « The RP ID "localhost" is invalid for this domain ».
//
// La cause n'était pas la valeur par défaut, qui est juste en développement. C'était qu'il
// fallait poser DEUX variables d'accord entre elles — WEBAUTHN_ORIGIN et WEBAUTHN_RP_ID — et
// qu'en poser une seule échouait en silence jusqu'au clic d'un utilisateur.

test("le rpID est le domaine de l'origine, sans qu'on ait à le répéter", () => {
  assert.equal(derivezRpId("https://pass.stackops.ch"), "pass.stackops.ch");
  assert.equal(derivezRpId("https://pass.stackops.ch:8443/coffre"), "pass.stackops.ch");
  assert.equal(derivezRpId("http://localhost:5173"), "localhost");
});

test("une origine de production ne peut plus produire un rpID de développement", () => {
  // La régression exacte : c'est ce couple-là qui était servi.
  assert.notEqual(derivezRpId("https://pass.stackops.ch"), "localhost");
});

test("le remplacement explicite sert le domaine parent, son seul cas légitime", () => {
  // Une passkey enrôlée sur `stackops.ch` vaut pour tous ses sous-domaines.
  assert.equal(derivezRpId("https://pass.stackops.ch", "stackops.ch"), "stackops.ch");
  // Une valeur vide ou blanche n'est pas un choix : on retombe sur la dérivation.
  assert.equal(derivezRpId("https://pass.stackops.ch", "   "), "pass.stackops.ch");
  assert.equal(derivezRpId("https://pass.stackops.ch", undefined), "pass.stackops.ch");
});

test("une origine illisible lève, au lieu de retomber sur localhost en silence", () => {
  // Retomber sur « localhost » ici recréerait exactement la panne qu'on corrige.
  assert.throws(() => derivezRpId("pass.stackops.ch"), /WEBAUTHN_ORIGIN/);
  assert.throws(() => derivezRpId(""), /WEBAUTHN_ORIGIN/);
});
