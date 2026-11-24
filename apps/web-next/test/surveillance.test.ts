// La surveillance du coffre : ce que chaque carte retient, et ce qu'elle laisse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  appreciation,
  constater,
  dansLAnnuaire,
  estNonSecurisee,
  etatExpiration,
  hoteDe,
  lireExpiration,
  score,
  type Annuaire,
} from "../src/lib/surveillance";
import type { VaultEntry } from "../src/lib/vault";

function e(id: string, extra: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id,
    updatedAt: 0,
    kind: "login",
    name: id,
    folder: "",
    username: "",
    password: "Un-Mot-De-Passe-Tres-Long-42!",
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

const ANNUAIRE: Annuaire = {
  genere: "2026-11-23",
  sources: [],
  tfa: { "github.com": ["totp", "u2f"], "banque.test": ["sms"] },
  cles: { "google.com": ["passwordless"] },
  documentation: { "github.com": "https://docs.github.com/2fa" },
};

const ids = (l: VaultEntry[]) => l.map((i) => i.id).sort();

// ─── Les adresses ───

test("l'hôte se lit avec ou sans schéma, sans www", () => {
  assert.equal(hoteDe("github.com/login"), "github.com");
  assert.equal(hoteDe("https://www.GitHub.com/"), "github.com");
  assert.equal(hoteDe("http://nas.lan:5000"), "nas.lan");
  assert.equal(hoteDe(""), null);
  assert.equal(hoteDe("pas une adresse"), null);
});

test("un sous-domaine trouve son site dans l'annuaire, un faux voisin non", () => {
  assert.deepEqual(dansLAnnuaire(ANNUAIRE.tfa, "gist.github.com"), ["totp", "u2f"]);
  // `notgithub.com` finit par « github.com » sans en être un sous-domaine.
  assert.equal(dansLAnnuaire(ANNUAIRE.tfa, "notgithub.com"), undefined);
});

test("http est signalé, sauf vers une adresse de la maison", () => {
  assert.equal(estNonSecurisee("http://exemple.test/login"), true);
  assert.equal(estNonSecurisee("https://exemple.test"), false);
  assert.equal(estNonSecurisee("exemple.test"), false);
  assert.equal(estNonSecurisee("http://192.168.1.1"), false);
  assert.equal(estNonSecurisee("http://nas.local"), false);
});

// ─── Les cartes ───

test("un mot de passe partagé marque les deux éléments, un unique aucun", () => {
  const c = constater([e("a", { password: "pareil-Pareil-12345!" }), e("b", { password: "pareil-Pareil-12345!" }), e("c")], null);
  assert.deepEqual(ids(c.reutilises), ["a", "b"]);
});

test("les notes et les cartes ne sont pas examinées", () => {
  const c = constater([e("note", { kind: "note", password: "" }), e("carte", { kind: "card", password: "" })], null);
  assert.equal(c.examines, 0);
  assert.equal(score(c), null);
});

test("un faible est retenu, un fort non", () => {
  const c = constater([e("faible", { password: "abc" }), e("fort")], null);
  assert.deepEqual(ids(c.faibles), ["faible"]);
});

test("la 2FA disponible ne vise que les sites à code ET les éléments sans code", () => {
  const c = constater(
    [
      e("sans", { urls: ["github.com"] }),
      e("avec", { urls: ["github.com"], totp: "JBSWY3DPEHPK3PXP" }),
      // La banque ne propose que des SMS : rien à configurer dans GhostPass.
      e("sms", { urls: ["banque.test"] }),
    ],
    ANNUAIRE,
  );
  assert.deepEqual(ids(c.totpDisponible), ["sans"]);
});

test("les clés d'accès disponibles suivent l'annuaire, et rien sans annuaire", () => {
  const items = [e("g", { urls: ["https://accounts.google.com"] }), e("autre", { urls: ["autre.test"] })];
  assert.deepEqual(ids(constater(items, ANNUAIRE).clesDisponibles), ["g"]);
  assert.deepEqual(constater(items, null).clesDisponibles, []);
});

// ─── Le score ───

test("un coffre sans défaut vaut 100, un coffre tout faible vaut 0", () => {
  assert.equal(score(constater([e("a"), e("b", { password: "Autre-Mot-De-Passe-Long-7?" })], null)), 100);
  assert.equal(score(constater([e("a", { password: "abc" })], null)), 0);
});

test("la 2FA absente pèse un demi-défaut, et une fuite un défaut entier", () => {
  const c = constater([e("a", { urls: ["github.com"] }), e("b", { password: "Autre-Mot-De-Passe-Long-7?" })], ANNUAIRE);
  assert.equal(score(c), 75);
  assert.equal(score(c, new Set(["b"])), 25);
});

test("l'appréciation suit le score", () => {
  assert.equal(appreciation(95), "excellent");
  assert.equal(appreciation(80), "bon");
  assert.equal(appreciation(60), "moyen");
  assert.equal(appreciation(10), "faible");
});

// ─── La copie de l'annuaire servie avec l'interface ───

test("l'annuaire embarqué a la forme attendue et cite ses licences", () => {
  const a: Annuaire = JSON.parse(
    readFileSync(new URL("../public/annuaire-2fa.json", import.meta.url), "utf-8"),
  );
  assert.ok(Object.keys(a.tfa).length > 1000);
  assert.ok(Object.keys(a.cles).length > 100);
  assert.deepEqual(a.sources.map((s) => s.licence).sort(), ["CC BY 4.0", "MIT"]);
  assert.ok(a.tfa["github.com"]?.includes("totp"));
});

// Le 24 novembre 2026 à midi, heure locale : la date de ces tests.
const AUJOURDHUI = new Date(2026, 10, 24, 12).getTime();

test("la date d'une carte se lit en MM/AA comme en MM/AAAA, sinon pas du tout", () => {
  assert.deepEqual(lireExpiration("12/30"), { annee: 2030, mois: 12 });
  assert.deepEqual(lireExpiration("3/2027"), { annee: 2027, mois: 3 });
  assert.deepEqual(lireExpiration(" 03 / 27 "), { annee: 2027, mois: 3 });
  for (const brut of [undefined, "", "13/27", "00/27", "12", "décembre 2027", "12/2", "12/27/01"]) {
    assert.equal(lireExpiration(brut), null, String(brut));
  }
});

test("une carte vaut jusqu'au dernier jour de son mois", () => {
  // Novembre 2026 : encore valable le 24, et jusqu'au 30 à minuit.
  assert.equal(etatExpiration("11/26", AUJOURDHUI), "bientot");
  assert.equal(etatExpiration("11/26", new Date(2026, 10, 30, 23, 59).getTime()), "bientot");
  assert.equal(etatExpiration("11/26", new Date(2026, 11, 1).getTime()), "expiree");
  assert.equal(etatExpiration("10/26", AUJOURDHUI), "expiree");
});

test("le préavis : signalée dans les deux mois, pas au-delà", () => {
  assert.equal(etatExpiration("12/26", AUJOURDHUI), "bientot");
  // Fin janvier 2027 : 68 jours, hors du préavis.
  assert.equal(etatExpiration("01/27", AUJOURDHUI), null);
  assert.equal(etatExpiration("12/30", AUJOURDHUI), null);
  // Une date illisible ne fait jamais une carte expirée.
  assert.equal(etatExpiration("bientôt", AUJOURDHUI), null);
});

test("les cartes à renouveler : expirées d'abord, sans peser sur le score", () => {
  const carte = (id: string, cardExp: string) => e(id, { kind: "card", password: "", cardExp });
  const c = constater(
    [carte("valide", "12/30"), carte("bientot", "12/26"), carte("expiree", "01/25"), carte("illisible", "?"), e("login")],
    null,
    AUJOURDHUI,
  );
  assert.equal(c.aDesCartes, true);
  assert.deepEqual(c.cartes.map((x) => [x.item.id, x.etat]), [["expiree", "expiree"], ["bientot", "bientot"]]);
  // Seul l'identifiant est noté, et il est sans défaut.
  assert.equal(c.examines, 1);
  assert.equal(score(c), 100);
});

test("sans carte au coffre, la surveillance n'en parle pas", () => {
  const c = constater([e("login"), e("note", { kind: "note", password: "" })], null, AUJOURDHUI);
  assert.equal(c.aDesCartes, false);
  assert.deepEqual(c.cartes, []);
});
