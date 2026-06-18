import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { generateTOTP } from "../src/services/totp.js";

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

/// App + compte inscrit avec la 2FA déjà activée. Renvoie le token et le secret TOTP.
async function appWithMfa() {
  const app = buildApp(openDatabase(":memory:"));
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const token = reg.json().token as string;

  const setup = await app.inject({
    method: "POST",
    url: "/api/mfa/setup",
    headers: auth(token),
  });
  const secret = setup.json().secret as string;

  const activate = await app.inject({
    method: "POST",
    url: "/api/mfa/activate",
    headers: auth(token),
    payload: { code: generateTOTP(secret) },
  });
  assert.equal(activate.statusCode, 200);
  return { app, token, secret };
}

test("setup renvoie un secret et une URI otpauth", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const res = await app.inject({
    method: "POST",
    url: "/api/mfa/setup",
    headers: auth(reg.json().token),
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().secret, /^[A-Z2-7]+$/);
  assert.match(res.json().otpauthUri, /^otpauth:\/\/totp\//);
  await app.close();
});

test("activate échoue avec un mauvais code", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  await app.inject({ method: "POST", url: "/api/mfa/setup", headers: auth(reg.json().token) });
  const res = await app.inject({
    method: "POST",
    url: "/api/mfa/activate",
    headers: auth(reg.json().token),
    payload: { code: "000000" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("une fois la 2FA activée, login sans code est refusé (mfaRequired)", async () => {
  const { app } = await appWithMfa();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().mfaRequired, true);
  await app.close();
});

test("login réussit avec le bon code TOTP", async () => {
  const { app, secret } = await appWithMfa();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: REG.email,
      masterPasswordHash: REG.masterPasswordHash,
      totpCode: generateTOTP(secret),
    },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().token);
  await app.close();
});

test("login échoue avec un mauvais code TOTP", async () => {
  const { app } = await appWithMfa();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: REG.email,
      masterPasswordHash: REG.masterPasswordHash,
      totpCode: "000000",
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("désactiver la 2FA rétablit le login sans code", async () => {
  const { app, token, secret } = await appWithMfa();
  const disable = await app.inject({
    method: "POST",
    url: "/api/mfa/disable",
    headers: auth(token),
    payload: { code: generateTOTP(secret) },
  });
  assert.equal(disable.statusCode, 200);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal(login.statusCode, 200);
  await app.close();
});
