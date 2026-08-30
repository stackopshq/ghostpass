// L'effacement et l'export : les deux droits que l'API ne savait pas honorer.
//
// Chaque test répond à une question qu'un contrôle poserait, et pas à
// « le code fait-il ce qu'il dit ». Le plus important est le dernier : un
// effacement qui laisse l'adresse de la personne dans le journal d'audit
// n'efface pas, et c'est le mode d'échec le plus discret des trois.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const INSCRIPTION = {
  email: "clara@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

async function compte(app: ReturnType<typeof buildApp>, email = INSCRIPTION.email) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { ...INSCRIPTION, email },
  });
  assert.ok(r.statusCode === 200 || r.statusCode === 201, `inscription refusée : ${r.statusCode} ${r.body}`);
  return r.json().token as string;
}

test("l'export rend ce que le serveur détient, et le rend chiffré", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const res = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const d = res.json();

  assert.equal(d.formatVersion, 1, "un export sans version n'est pas comparable au suivant");
  assert.equal(d.account.email, INSCRIPTION.email);
  assert.equal(d.account.encryptedUserKey, INSCRIPTION.encryptedUserKey);
  assert.ok(Array.isArray(d.vaultItems));
  assert.ok(Array.isArray(d.loginEvents));
  assert.ok(Array.isArray(d.auditLog));

  // Ce que l'export ne doit JAMAIS contenir : la preuve d'authentification
  // du serveur. L'exporter livrerait de quoi se faire passer pour la personne
  // à quiconque met la main sur le fichier.
  const brut = JSON.stringify(d);
  assert.ok(!brut.includes("server_password_hash"), "l'export porte le hachage serveur");
  assert.ok(!brut.includes("password_salt"), "l'export porte le sel du mot de passe");
  assert.ok(!brut.includes("mfa_secret"), "l'export porte le secret du second facteur");

  await app.close();
});

test("l'export exige une session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "GET", url: "/api/account/export" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("supprimer un compte exige le mot de passe, pas seulement la session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const sans = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(sans.statusCode, 400, "une suppression sans preuve doit être refusée");

  const faux = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: "ce-n-est-pas-le-bon" },
  });
  assert.equal(faux.statusCode, 401, "un mauvais mot de passe doit être refusé");

  // Le compte est toujours là.
  const encore = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(encore.statusCode, 200);

  await app.close();
});

test("la suppression efface le compte et invalide la session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await compte(app);

  const res = await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });
  assert.equal(res.statusCode, 204, `suppression refusée : ${res.body}`);

  // La session tombe avec le compte — `sessions.user_id` est en cascade.
  const apres = await app.inject({
    method: "GET",
    url: "/api/account/export",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(apres.statusCode, 401, "la session survit à la suppression du compte");

  // Et l'adresse est réutilisable : rien ne subsiste qui la retienne.
  const rouvert = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: INSCRIPTION,
  });
  assert.ok(
    rouvert.statusCode === 200 || rouvert.statusCode === 201,
    "l'adresse reste prise après suppression",
  );

  await app.close();
});

test("le journal d'audit survit à la personne, mais pas son adresse ni son IP", async () => {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  const token = await compte(app);

  // Une connexion, pour garantir qu'il existe des lignes d'audit portant
  // l'adresse — sans quoi le test passerait en ne mesurant rien.
  await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: INSCRIPTION.email, masterPasswordHash: INSCRIPTION.masterPasswordHash },
  });

  const avant = await db.selectFrom("audit_log").selectAll().execute();
  assert.ok(
    avant.some((l) => l.actor_email === INSCRIPTION.email),
    "aucune ligne d'audit ne portait l'adresse : le test ne mesure rien",
  );

  await app.inject({
    method: "DELETE",
    url: "/api/account",
    headers: { authorization: `Bearer ${token}` },
    payload: { serverPassword: INSCRIPTION.masterPasswordHash },
  });

  const apres = await db.selectFrom("audit_log").selectAll().execute();
  assert.ok(apres.length > 0, "le journal a été vidé : un journal effaçable ne prouve plus rien");
  assert.ok(
    apres.every((l) => l.actor_email !== INSCRIPTION.email),
    "l'adresse de la personne supprimée est encore au journal",
  );
  assert.ok(
    apres.every((l) => l.ip === "" || l.user_id !== null),
    "une ligne orpheline garde encore une adresse IP",
  );

  await app.close();
});
