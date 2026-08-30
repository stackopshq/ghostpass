import { test } from "node:test";
import assert from "node:assert/strict";
import { examinerLienDePartage } from "../src/lib/lienDePartage.js";

const APP = "https://ghostpass.stackops.ch";
const CLE = "cle-de-dechiffrement";

test("le domaine de l'application est accepté sans rien demander", () => {
  const v = examinerLienDePartage(`${APP}/s/abc`, CLE, APP, []);
  assert.equal(v.statut, "accepte");
});

test("un domaine déjà approuvé est accepté", () => {
  const v = examinerLienDePartage("https://ghostbit.dev/p/abc", CLE, APP, ["ghostbit.dev"]);
  assert.equal(v.statut, "accepte");
});

test("un domaine inconnu déclenche une question, jamais une acceptation", () => {
  const v = examinerLienDePartage("https://ghostbit.dev/p/abc", CLE, APP, []);
  assert.equal(v.statut, "demander");
  assert.equal(v.statut === "demander" && v.hote, "ghostbit.dev");
});

// L'attaque telle qu'elle a été décrite : le serveur choisit le domaine qui
// recevra la clé. Sans ce garde, la clé partait dans le fragment d'une page
// contrôlée par l'attaquant, qui détient déjà le chiffré.
test("un relais hostile ne peut pas obtenir la clé en silence", () => {
  const v = examinerLienDePartage("https://relais.attaquant.example/p/abc", CLE, APP, []);
  assert.equal(v.statut, "demander");
});

// Le piège classique : un domaine qui CONTIENT celui de confiance.
test("un suffixe trompeur n'est pas confondu avec le domaine de confiance", () => {
  const v = examinerLienDePartage(
    "https://ghostpass.stackops.ch.attaquant.example/p/abc",
    CLE,
    APP,
    [],
  );
  assert.equal(v.statut, "demander");
  assert.equal(v.statut === "demander" && v.hote, "ghostpass.stackops.ch.attaquant.example");
});

// `hostname` seul laisserait passer un port différent, donc un autre service.
test("un port différent est un autre hôte", () => {
  const v = examinerLienDePartage("https://ghostpass.stackops.ch:8443/s/a", CLE, APP, []);
  assert.equal(v.statut, "demander");
});

test("http est refusé quand l'application est servie en https", () => {
  const v = examinerLienDePartage("http://ghostbit.dev/p/abc", CLE, APP, ["ghostbit.dev"]);
  assert.equal(v.statut, "refuse");
  assert.equal(v.statut === "refuse" && v.raison, "schema-non-chiffre");
});

// En développement local l'application elle-même est en clair : exiger https
// rendrait le partage inutilisable sans rien protéger de plus.
test("http est toléré quand l'application elle-même est en clair", () => {
  const v = examinerLienDePartage(
    "http://localhost:8000/p/abc",
    CLE,
    "http://localhost:3000",
    ["localhost:8000"],
  );
  assert.equal(v.statut, "accepte");
});

test("un schéma exotique est refusé", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"]) {
    const v = examinerLienDePartage(url, CLE, APP, []);
    assert.equal(v.statut, "refuse", url);
  }
});

test("une URL illisible est refusée, jamais acceptée par défaut", () => {
  const v = examinerLienDePartage("pas une url", CLE, APP, []);
  assert.equal(v.statut, "refuse");
  assert.equal(v.statut === "refuse" && v.raison, "url-illisible");
});
