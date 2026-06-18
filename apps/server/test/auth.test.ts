import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

function makeApp() {
  return buildApp(openDatabase(":memory:"));
}

const REG = {
  email: "kevin@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

test("register crée un compte et ouvre une session", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.token, "token attendu");
  assert.ok(body.userId, "userId attendu");
  await app.close();
});

test("register refuse un email déjà utilisé", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test("register valide les entrées (email invalide → 400)", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { ...REG, email: "pas-un-email" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("prelogin renvoie les paramètres KDF du compte", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/prelogin",
    payload: { email: REG.email },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().kdfParams, REG.kdfParams);
  await app.close();
});

test("prelogin sur email inconnu renvoie des paramètres par défaut (anti-énumération)", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/prelogin",
    payload: { email: "inconnu@stackops.ch" },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().kdfParams, "des paramètres par défaut sont renvoyés");
  await app.close();
});

test("login réussit avec le bon hash et renvoie les blobs", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.token);
  assert.equal(body.encryptedUserKey, REG.encryptedUserKey);
  assert.equal(body.encryptedPrivateKey, REG.encryptedPrivateKey);
  await app.close();
});

test("login échoue avec un mauvais hash", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: "mauvais" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});
