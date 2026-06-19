import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const base = {
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function user(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { ...base, email } });
  return res.json().token as string;
}

test("accès d'urgence : invitation → demande → délai → approbation → accès, + authz", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const grantor = await user(app, "grantor@x.ch");
  const grantee = await user(app, "grantee@x.ch");
  const tiers = await user(app, "tiers@x.ch");

  // Grantor invite le contact (USK scellée = blob opaque pour le test).
  const inv = await app.inject({
    method: "POST",
    url: "/api/emergency",
    headers: auth(grantor),
    payload: { email: "grantee@x.ch", role: "view", waitDays: 1, sealedUserKey: "sealed-usk-blob" },
  });
  assert.equal(inv.statusCode, 201);

  // Le contact voit l'invitation.
  let list = await app.inject({ method: "GET", url: "/api/emergency", headers: auth(grantee) });
  const entry = list.json().asGrantee[0];
  assert.equal(entry.status, "invited");
  const id = entry.id as string;

  // accepter → demander.
  assert.equal((await app.inject({ method: "POST", url: `/api/emergency/${id}/accept`, headers: auth(grantee) })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/api/emergency/${id}/request`, headers: auth(grantee) })).statusCode, 200);

  // Avant approbation/délai : accès refusé (waitDays=1 non écoulé).
  assert.equal((await app.inject({ method: "GET", url: `/api/emergency/${id}/access`, headers: auth(grantee) })).statusCode, 403);

  // Un tiers ne peut rien faire sur cette entrée.
  assert.equal((await app.inject({ method: "GET", url: `/api/emergency/${id}/access`, headers: auth(tiers) })).statusCode, 403);

  // Le grantor approuve → accès disponible immédiatement.
  assert.equal((await app.inject({ method: "POST", url: `/api/emergency/${id}/approve`, headers: auth(grantor) })).statusCode, 200);
  const access = await app.inject({ method: "GET", url: `/api/emergency/${id}/access`, headers: auth(grantee) });
  assert.equal(access.statusCode, 200);
  assert.equal(access.json().sealedUserKey, "sealed-usk-blob");
  assert.ok(Array.isArray(access.json().items));

  // Rôle "view" ⇒ takeover interdit.
  assert.equal((await app.inject({ method: "POST", url: `/api/emergency/${id}/takeover`, headers: auth(grantee), payload: { newMasterPasswordHash: "x", newEncryptedUserKey: "2.a.b" } })).statusCode, 403);

  await app.close();
});
