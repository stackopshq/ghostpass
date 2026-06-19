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

async function withUser(): Promise<{ app: ReturnType<typeof buildApp>; token: string }> {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return { app, token: res.json().token as string };
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

test("webauthn : options d'enregistrement exigent une session", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "POST", url: "/api/mfa/webauthn/register/options" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("webauthn : options valides + liste vide + suppression d'une clé inconnue", async () => {
  const { app, token } = await withUser();

  const opts = await app.inject({
    method: "POST",
    url: "/api/mfa/webauthn/register/options",
    headers: auth(token),
  });
  assert.equal(opts.statusCode, 200);
  const body = opts.json();
  assert.ok(typeof body.challenge === "string" && body.challenge.length > 0);
  assert.ok(body.rp && body.user);

  const list = await app.inject({
    method: "GET",
    url: "/api/mfa/webauthn/credentials",
    headers: auth(token),
  });
  assert.deepEqual(list.json().credentials, []);

  const del = await app.inject({
    method: "DELETE",
    url: "/api/mfa/webauthn/credentials/inconnue",
    headers: auth(token),
  });
  assert.equal(del.statusCode, 404);

  await app.close();
});
