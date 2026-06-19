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
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

test("passkey : enrôlement exige une session, login-options inconnu → 404, liste vide", async () => {
  const app = buildApp(openDatabase(":memory:"));

  // Options d'enrôlement sans session.
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/passkey/register/options" })).statusCode,
    401,
  );

  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const token = reg.json().token as string;

  // Options d'enrôlement valides.
  const opts = await app.inject({
    method: "POST",
    url: "/api/passkey/register/options",
    headers: auth(token),
  });
  assert.equal(opts.statusCode, 200);
  assert.ok(typeof opts.json().challenge === "string");

  // Liste vide + suppression inconnue.
  assert.deepEqual(
    (await app.inject({ method: "GET", url: "/api/passkey/credentials", headers: auth(token) })).json()
      .credentials,
    [],
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/passkey/credentials/x", headers: auth(token) }))
      .statusCode,
    404,
  );

  // Login passwordless : aucune passkey → 404 (et email inconnu → 404).
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/auth/passkey/options", payload: { email: REG.email } }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/auth/passkey/options", payload: { email: "nobody@x.ch" } }))
      .statusCode,
    404,
  );

  await app.close();
});
