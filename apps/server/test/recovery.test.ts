import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const REG = {
  email: "kevin@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registered() {
  const app = buildApp(openDatabase(":memory:"));
  const r = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return { app, token: r.json().token as string };
}

async function enroll(app: ReturnType<typeof buildApp>, token: string) {
  return app.inject({
    method: "POST",
    url: "/api/account/recovery",
    headers: auth(token),
    payload: { recoveryAuthHash: "bonne-preuve", encryptedUserKeyRecovery: "2.rec.blob" },
  });
}

test("recovery-blob répond de façon uniforme même sans récupération (anti-énumération)", async () => {
  const { app } = await registered();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/recovery-blob",
    payload: { email: REG.email },
  });
  // Réponse 200 avec des blobs leurres : indistinguable d'un compte ayant la récupération.
  assert.equal(res.statusCode, 200);
  assert.match(res.json().encryptedUserKeyRecovery, /^2\./);
  await app.close();
});

test("après enrôlement, recovery-blob renvoie les blobs chiffrés", async () => {
  const { app, token } = await registered();
  await enroll(app, token);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/recovery-blob",
    payload: { email: REG.email },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().encryptedUserKeyRecovery, "2.rec.blob");
  assert.equal(res.json().encryptedPrivateKey, REG.encryptedPrivateKey);
  await app.close();
});

test("recover échoue avec une mauvaise preuve", async () => {
  const { app, token } = await registered();
  await enroll(app, token);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/recover",
    payload: {
      email: REG.email,
      recoveryAuthHash: "mauvaise-preuve",
      newMasterPasswordHash: "nouveau-hash",
      newEncryptedUserKey: "2.new.key",
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("recover avec la bonne preuve réinitialise et invalide les sessions", async () => {
  const { app, token } = await registered();
  await enroll(app, token);

  const res = await app.inject({
    method: "POST",
    url: "/api/auth/recover",
    payload: {
      email: REG.email,
      recoveryAuthHash: "bonne-preuve",
      newMasterPasswordHash: "nouveau-hash",
      newEncryptedUserKey: "2.new.key",
    },
  });
  assert.equal(res.statusCode, 200);

  // L'ancienne session est invalidée.
  const items = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(items.statusCode, 401);

  // Le nouveau hash permet de se connecter et renvoie la nouvelle USK enveloppée.
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: "nouveau-hash" },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().encryptedUserKey, "2.new.key");
  await app.close();
});
