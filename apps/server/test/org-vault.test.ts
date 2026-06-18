import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const KDF = JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 });
const ITEM = { encryptedKey: "2.aWtleQ.aWtleWN0", encryptedData: "2.ZGF0YQ.ZGF0YWN0" };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerUser(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      masterPasswordHash: `hash-${email}`,
      kdfParams: KDF,
      encryptedUserKey: "2.dWsx.dWsy",
      encryptedPrivateKey: "2.cGsx.cGsy",
      publicKey: `pub-${email}`,
    },
  });
  return res.json().token as string;
}

/// Org avec un admin, un membre (actif) et un lecteur seul (actif).
async function setupOrg() {
  const app = buildApp(openDatabase(":memory:"));
  const adminToken = await registerUser(app, "admin@stackops.ch");
  const memberToken = await registerUser(app, "member@stackops.ch");
  const readonlyToken = await registerUser(app, "readonly@stackops.ch");

  const created = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(adminToken),
    payload: { name: "Team", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
  });
  const orgId = created.json().orgId as string;

  for (const [email, role, token] of [
    ["member@stackops.ch", "member", memberToken],
    ["readonly@stackops.ch", "readonly", readonlyToken],
  ] as const) {
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/members`,
      headers: auth(adminToken),
      payload: { email, role, encryptedOrgKey: "2.a.b" },
    });
    await app.inject({ method: "POST", url: `/api/orgs/${orgId}/accept`, headers: auth(token) });
  }
  return { app, adminToken, memberToken, readonlyToken, orgId };
}

async function makeCollection(app: ReturnType<typeof buildApp>, orgId: string, token: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(token),
    payload: { name: "Infra" },
  });
  return res;
}

test("un membre actif crée une collection ; un non-membre est refusé", async () => {
  const { app, memberToken, orgId } = await setupOrg();
  const ok = await makeCollection(app, orgId, memberToken);
  assert.equal(ok.statusCode, 201);

  const outsiderToken = await registerUser(app, "outsider@stackops.ch");
  const ko = await makeCollection(app, orgId, outsiderToken);
  assert.equal(ko.statusCode, 403);
  await app.close();
});

test("le lecteur seul ne peut pas écrire mais peut lire", async () => {
  const { app, adminToken, readonlyToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  // Écriture interdite.
  const write = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(readonlyToken),
    payload: ITEM,
  });
  assert.equal(write.statusCode, 403);

  // Lecture autorisée.
  const read = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(readonlyToken),
  });
  assert.equal(read.statusCode, 200);
  await app.close();
});

test("cycle de vie d'un item partagé (create/list/update/delete)", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  // Le membre crée un item.
  let res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
    payload: ITEM,
  });
  assert.equal(res.statusCode, 201);
  const itemId = res.json().id as string;

  // L'admin le voit dans la liste.
  res = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
  });
  assert.equal(res.json().items.length, 1);

  // Mise à jour.
  res = await app.inject({
    method: "PUT",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
    payload: { encryptedKey: ITEM.encryptedKey, encryptedData: "2.bmV3.bmV3Y3Q" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().encryptedData, "2.bmV3.bmV3Y3Q");

  // Suppression.
  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 204);
  await app.close();
});

test("impossible d'accéder à une collection d'une autre organisation", async () => {
  const { app, adminToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  // Une 2e org (même admin) ; la collection de la 1ère ne doit pas y être accessible.
  const other = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(adminToken),
    payload: { name: "Autre", encryptedOrgKey: "2.x.y" },
  });
  const otherOrgId = other.json().orgId as string;

  const res = await app.inject({
    method: "GET",
    url: `/api/orgs/${otherOrgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});
