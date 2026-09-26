import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionsDuContact,
  actionsDuProprietaire,
  disponibleLe,
  joursRestants,
  type EntreeDUrgence,
} from "../src/lib/urgence.js";

const JOUR = 86_400_000;
const base = (sur: Partial<EntreeDUrgence> = {}): EntreeDUrgence => ({
  id: "e1",
  contactEmail: "proche@stackops.ch",
  role: "view",
  waitDays: 7,
  status: "invited",
  requestedAt: null,
  ...sur,
});

test("le propriétaire ne tranche que pendant qu'une demande est en cours", () => {
  for (const status of ["invited", "accepted", "granted"]) {
    assert.deepEqual(actionsDuProprietaire(base({ status })), ["retirer"], `état ${status}`);
  }
  assert.deepEqual(actionsDuProprietaire(base({ status: "requested" })), [
    "approuver",
    "refuser",
    "retirer",
  ]);
});

test("retirer reste possible même sur un accès DÉJÀ accordé", () => {
  // C'est la seule façon de révoquer. Sans elle, changer d'avis sur un proche demanderait de
  // supprimer son compte.
  assert.ok(actionsDuProprietaire(base({ status: "granted" })).includes("retirer"));
});

test("le contact suit la machine à états, une action à la fois", () => {
  assert.deepEqual(actionsDuContact(base({ status: "invited" })), ["accepter", "retirer"]);
  assert.deepEqual(actionsDuContact(base({ status: "accepted" })), ["demander", "retirer"]);
  // Demande en cours mais délai non écoulé : rien à faire qu'attendre.
  assert.deepEqual(
    actionsDuContact(base({ status: "requested", available: false })),
    ["retirer"],
  );
});

test("« ouvrir » suit le serveur, jamais l'horloge du navigateur", () => {
  // Le défaut que ce test garde : recalculer la disponibilité ici. Une horloge locale en avance
  // afficherait « ouvrir » sur un accès que le serveur refuse par un 403.
  const echu = base({
    status: "requested",
    requestedAt: Date.now() - 30 * JOUR,
    waitDays: 7,
    available: false, // le serveur, lui, dit non
  });
  assert.ok(!actionsDuContact(echu).includes("ouvrir"), "l'horloge locale a pris le dessus");

  const permis = base({ status: "requested", requestedAt: Date.now(), available: true });
  assert.ok(actionsDuContact(permis).includes("ouvrir"));
});

test("la reprise n'est offerte qu'au rôle qui la porte", () => {
  const dispo = { status: "granted", available: true } as const;
  assert.ok(!actionsDuContact(base({ ...dispo, role: "view" })).includes("reprendre"));
  assert.ok(actionsDuContact(base({ ...dispo, role: "takeover" })).includes("reprendre"));
});

test("l'échéance reprend l'arithmétique du serveur", () => {
  const t0 = 1_700_000_000_000;
  assert.equal(disponibleLe(base({ status: "requested", requestedAt: t0, waitDays: 7 })), t0 + 7 * JOUR);
  // Pas de demande en cours : pas d'échéance. Un « disponible le… » affiché sur une entrée
  // simplement acceptée annoncerait un compte à rebours qui n'a pas commencé.
  assert.equal(disponibleLe(base({ status: "accepted", requestedAt: t0 })), null);
  assert.equal(disponibleLe(base({ status: "requested", requestedAt: null })), null);
});

test("les jours restants s'arrondissent au SUPÉRIEUR", () => {
  const t0 = 1_700_000_000_000;
  const e = base({ status: "requested", requestedAt: t0, waitDays: 7 });
  // Vingt-trois heures avant l'échéance, il reste « 1 jour » et non « 0 ».
  assert.equal(joursRestants(e, t0 + 7 * JOUR - 23 * 3_600_000), 1);
  assert.equal(joursRestants(e, t0), 7);
  assert.equal(joursRestants(e, t0 + 7 * JOUR), 0);
  assert.equal(joursRestants(e, t0 + 30 * JOUR), 0, "jamais négatif");
});
