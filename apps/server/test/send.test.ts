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

async function tokenOf(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return res.json().token as string;
}

test("send : création authentifiée, récupération publique, épuisement one-time", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const token = await tokenOf(app);

  // Création authentifiée.
  const create = await app.inject({
    method: "POST",
    url: "/api/send",
    headers: { authorization: `Bearer ${token}` },
    payload: { ciphertext: "Y2lwaGVy", iv: "aXY=", expiresInHours: 1, maxViews: 1 },
  });
  assert.equal(create.statusCode, 201);
  const id = create.json().id as string;

  // Création refusée sans auth.
  const noauth = await app.inject({
    method: "POST",
    url: "/api/send",
    payload: { ciphertext: "x", iv: "y", expiresInHours: 1, maxViews: 1 },
  });
  assert.equal(noauth.statusCode, 401);

  // Récupération publique (sans token).
  const get1 = await app.inject({ method: "GET", url: `/api/send/${id}` });
  assert.equal(get1.statusCode, 200);
  assert.equal(get1.json().ciphertext, "Y2lwaGVy");

  // One-time : la 2e vue est épuisée → 404.
  const get2 = await app.inject({ method: "GET", url: `/api/send/${id}` });
  assert.equal(get2.statusCode, 404);

  // Identifiant inconnu → 404.
  const get3 = await app.inject({ method: "GET", url: "/api/send/inconnu" });
  assert.equal(get3.statusCode, 404);

  await app.close();
});
