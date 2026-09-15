// Le secret du second facteur, chiffré en base.
//
// C'est l'unique secret que le serveur DOIT pouvoir lire : vérifier un code à
// six chiffres suppose de connaître la graine. Il était stocké en clair, et
// `SECURITY.md` le reconnaissait — quiconque lisait la base, une sauvegarde
// égarée, un accès d'exploitation, pouvait générer les codes 2FA de tout le
// monde.
//
// Les deux tests qui comptent ici ne vérifient pas que le chiffrement marche —
// ça, c'est de la bibliothèque standard. Ils vérifient les deux chemins par
// lesquels ce correctif pourrait mettre des gens dehors : une base d'avant, et
// une instance sans clé.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chargerLaCle,
  chiffrerAuRepos,
  dechiffrerAuRepos,
  definirLaCle,
  dejaChiffre,
  laCleEstPosee,
} from "../src/services/secretAtRest.js";

const SECRET = "JBSWY3DPEHPK3PXP";

test("avec une clé, la valeur en base ne contient plus le secret", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  const stocke = chiffrerAuRepos(SECRET);
  assert.ok(!stocke.includes(SECRET), "le secret est encore lisible dans la valeur stockée");
  assert.ok(dejaChiffre(stocke));
  assert.equal(dechiffrerAuRepos(stocke), SECRET);
});

test("deux chiffrements du même secret diffèrent", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  // Sinon deux comptes partageant le même secret seraient reconnaissables dans
  // un vidage de base, et une valeur volée serait rejouable telle quelle.
  assert.notEqual(chiffrerAuRepos(SECRET), chiffrerAuRepos(SECRET));
});

test("une valeur d'AVANT le chiffrement reste lisible", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  // Le cas qui met les gens dehors : au déploiement, toutes les lignes en base
  // sont en clair et sans préfixe. Les refuser couperait le second facteur de
  // tous les comptes existants.
  assert.equal(dechiffrerAuRepos(SECRET), SECRET);
  assert.equal(dejaChiffre(SECRET), false);
});

test("sans clé, le serveur fonctionne comme avant", () => {
  definirLaCle(null);
  // L'autre cas qui met les gens dehors : une instance auto-hébergée qui monte
  // de version sans poser MFA_SECRET_KEY. Elle doit continuer de tourner —
  // l'avertissement au démarrage est le rappel, pas un refus de démarrer.
  assert.equal(laCleEstPosee(), false);
  assert.equal(chiffrerAuRepos(SECRET), SECRET);
  assert.equal(dechiffrerAuRepos(SECRET), SECRET);
});

test("une valeur chiffrée lue sans clé lève, plutôt que de rendre du charabia", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  const stocke = chiffrerAuRepos(SECRET);
  definirLaCle(null);
  // Clé perdue ou changée : mieux vaut une erreur explicite qu'un secret
  // illisible traité comme une graine TOTP, qui rendrait « code invalide » à
  // chaque tentative sans jamais dire pourquoi.
  assert.throws(() => dechiffrerAuRepos(stocke), /MFA_SECRET_KEY/);
});

test("une valeur altérée est rejetée, pas déchiffrée de travers", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  const stocke = chiffrerAuRepos(SECRET);
  const altere = stocke.slice(0, -2) + (stocke.slice(-2) === "AA" ? "BB" : "AA");
  assert.throws(() => dechiffrerAuRepos(altere));
});

test("une phrase quelconque fait une clé, un hexadécimal de 64 en fait une autre", () => {
  const a = chargerLaCle("ma phrase de passe");
  const b = chargerLaCle("a".repeat(64));
  assert.equal(a?.length, 32);
  assert.equal(b?.length, 32);
  assert.notDeepEqual(a, b);
  assert.equal(chargerLaCle(undefined), null);
  assert.equal(chargerLaCle(""), null);
});

// ─── Le test qui traverse ───
//
// Les précédents éprouvent le module. Celui-ci éprouve le BRANCHEMENT : un
// module juste, appelé nulle part, aurait passé tout ce qui précède. C'est
// exactement le défaut qui a coûté trois heures ce matin sur les appels
// d'API — corrects en apparence, jamais exercés de bout en bout.

import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { generateTOTP } from "../src/services/totp.js";

const INSCRIPTION = {
  email: "clara@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

test("de bout en bout : le secret est chiffré en base, et la 2FA marche quand même", async () => {
  definirLaCle(chargerLaCle("b".repeat(64)));
  const db = openDatabase(":memory:");
  const app = buildApp(db);

  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: INSCRIPTION });
  const token = reg.json().token as string;

  const setup = await app.inject({
    method: "POST",
    url: "/api/mfa/setup",
    headers: { authorization: `Bearer ${token}` },
    payload: { masterPasswordHash: INSCRIPTION.masterPasswordHash },
  });
  assert.equal(setup.statusCode, 200, `setup refusé : ${setup.body}`);
  const secret = setup.json().secret as string;

  // Ce que la base détient : du chiffré, et le secret n'y apparaît pas.
  const ligne = await db
    .selectFrom("users")
    .select("mfa_secret")
    .where("email", "=", INSCRIPTION.email)
    .executeTakeFirst();
  assert.ok(ligne?.mfa_secret, "aucun secret enregistré — le test ne mesure rien");
  assert.ok(
    !ligne.mfa_secret.includes(secret),
    "le secret TOTP est lisible en clair dans la base",
  );
  assert.ok(dejaChiffre(ligne.mfa_secret), "la valeur stockée n'est pas chiffrée");

  // Et malgré ça, un code produit à partir du secret rendu au client est accepté.
  const activation = await app.inject({
    method: "POST",
    url: "/api/mfa/activate",
    headers: { authorization: `Bearer ${token}` },
    payload: { code: generateTOTP(secret) },
  });
  assert.equal(activation.statusCode, 200, `activation refusée : ${activation.body}`);

  // Puis une connexion complète, qui passe par le chemin de vérification.
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: INSCRIPTION.email,
      masterPasswordHash: INSCRIPTION.masterPasswordHash,
      totpCode: generateTOTP(secret),
    },
  });
  assert.equal(login.statusCode, 200, `connexion 2FA refusée : ${login.body}`);

  await app.close();
});

test("une étiquette d'authentification tronquée est refusée", () => {
  definirLaCle(chargerLaCle("a".repeat(64)));
  const stocke = chiffrerAuRepos(SECRET);
  const [prefixe, iv, tag, ct] = [
    stocke.slice(0, 3),
    ...stocke.slice(3).split(":"),
  ] as [string, string, string, string];
  // Sans `authTagLength` explicite, Node accepterait cette étiquette de quatre
  // octets à la place de seize — et forger devient exponentiellement plus
  // facile à chaque octet retiré. Relevé par Semgrep, pas par relecture.
  const tronque = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
  assert.throws(() => dechiffrerAuRepos(`${prefixe}${iv}:${tronque}:${ct}`));
});
