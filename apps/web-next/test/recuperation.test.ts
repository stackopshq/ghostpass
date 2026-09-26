import { test } from "node:test";
import assert from "node:assert/strict";
import { EchecDeRecuperation, recupererLeCoffre } from "../src/lib/recuperation.js";
import type { DependancesDeRecuperation } from "../src/lib/recuperation.js";

const BLOBS = { kdfParams: "{}", encryptedUserKeyRecovery: "2.a.b", encryptedPrivateKey: "2.c.d" };
const SAISIE = { email: "a@b.ch", cleDeRecuperation: "KIT-1234", nouveauMotDePasse: "unNouveauMdpSolide" };
const RESET = { masterPasswordHash: "mph", recoveryAuthHash: "rah", encryptedUserKey: "euk" };

function deps(sur: Partial<DependancesDeRecuperation> = {}): DependancesDeRecuperation {
  return {
    lireLesBlobs: async () => BLOBS,
    rouvrir: () => RESET,
    reinitialiser: async () => ({ ok: true }),
    ...sur,
  };
}

async function motif(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "aucun";
  } catch (e) {
    assert.ok(e instanceof EchecDeRecuperation, `attendu EchecDeRecuperation, reçu ${e}`);
    return e.motif;
  }
}

test("le parcours complet transmet au serveur ce que la cryptographie a produit", async () => {
  const vus: unknown[] = [];
  await recupererLeCoffre(deps({ reinitialiser: async (c) => void vus.push(c) }), SAISIE);
  assert.deepEqual(vus, [
    {
      email: "a@b.ch",
      recoveryAuthHash: "rah",
      newMasterPasswordHash: "mph",
      newEncryptedUserKey: "euk",
    },
  ]);
});

test("l'adresse et la clé sont nettoyées avant d'être utilisées", async () => {
  let vue = "";
  await recupererLeCoffre(
    deps({ lireLesBlobs: async (e) => { vue = e; return BLOBS; } }),
    { ...SAISIE, email: "  a@b.ch  " },
  );
  assert.equal(vue, "a@b.ch");
});

test("un champ vide ne part pas sur le réseau", async () => {
  const jamais = () => assert.fail("le réseau ne devrait pas être touché");
  for (const creux of [
    { ...SAISIE, email: "   " },
    { ...SAISIE, cleDeRecuperation: "" },
    { ...SAISIE, nouveauMotDePasse: "" },
  ]) {
    assert.equal(await motif(recupererLeCoffre(deps({ lireLesBlobs: jamais as never }), creux)), "champ-vide");
  }
});

// Le serveur sert un LEURRE indistinguable pour un compte inexistant ou sans kit : c'est ce
// qui l'empêche de dire qui a un compte. Si l'interface distinguait « mauvaise clé » de
// « compte inconnu », elle rendrait par la fenêtre ce que le serveur ferme à la porte.
test("une mauvaise clé et un leurre donnent le MÊME motif", async () => {
  const echoueAuDechiffrement = () => { throw new Error("mac invalide"); };
  assert.equal(await motif(recupererLeCoffre(deps({ rouvrir: echoueAuDechiffrement }), SAISIE)), "cle-refusee");

  const refuseParLeServeur = async () => { throw Object.assign(new Error("401"), { status: 401 }); };
  assert.equal(await motif(recupererLeCoffre(deps({ reinitialiser: refuseParLeServeur }), SAISIE)), "cle-refusee");
});

test("une panne de réseau ne se déguise pas en mauvaise clé", async () => {
  const coupe = async () => { throw new Error("Failed to fetch"); };
  assert.equal(await motif(recupererLeCoffre(deps({ lireLesBlobs: coupe as never }), SAISIE)), "reseau");
  assert.equal(await motif(recupererLeCoffre(deps({ reinitialiser: coupe }), SAISIE)), "reseau");
});

test("le nouveau mot de passe ne part jamais tel quel au serveur", async () => {
  let corps: Record<string, unknown> = {};
  await recupererLeCoffre(deps({ reinitialiser: async (c) => void (corps = c as never) }), SAISIE);
  const envoye = JSON.stringify(corps);
  assert.ok(!envoye.includes(SAISIE.nouveauMotDePasse), "le mot de passe maître est parti en clair");
});
