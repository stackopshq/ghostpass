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

const ITEM = { encryptedKey: "2.aWtleW5vbmNl.aWtleWN0", encryptedData: "2.ZGF0YW5vbmNl.ZGF0YWN0" };

/// Crée une app + un compte, renvoie le token de session.
async function appWithUser() {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return { app, token: res.json().token as string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("accès au coffre refusé sans token", async () => {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "GET", url: "/api/vault/items" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("accès refusé avec un token invalide", async () => {
  const { app } = await appWithUser();
  const res = await app.inject({
    method: "GET",
    url: "/api/vault/items",
    headers: auth("token-bidon"),
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("cycle de vie complet d'un item de coffre", async () => {
  const { app, token } = await appWithUser();

  // Liste vide au départ.
  let res = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().items, []);

  // Création.
  res = await app.inject({
    method: "POST",
    url: "/api/vault/items",
    headers: auth(token),
    payload: ITEM,
  });
  assert.equal(res.statusCode, 201);
  const created = res.json();
  assert.ok(created.id);
  assert.equal(created.encryptedData, ITEM.encryptedData);

  // Présent dans la liste.
  res = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(res.json().items.length, 1);

  // Mise à jour.
  const updated = { encryptedKey: ITEM.encryptedKey, encryptedData: "2.bmV3.bmV3Y3Q" };
  res = await app.inject({
    method: "PUT",
    url: `/api/vault/items/${created.id}`,
    headers: auth(token),
    payload: updated,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().encryptedData, updated.encryptedData);

  // Suppression.
  res = await app.inject({
    method: "DELETE",
    url: `/api/vault/items/${created.id}`,
    headers: auth(token),
  });
  assert.equal(res.statusCode, 204);

  // Liste de nouveau vide.
  res = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(res.json().items.length, 0);

  await app.close();
});

test("mise à jour d'un item inexistant → 404", async () => {
  const { app, token } = await appWithUser();
  const res = await app.inject({
    method: "PUT",
    url: "/api/vault/items/inexistant",
    headers: auth(token),
    payload: ITEM,
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("corbeille : suppression douce, restauration, purge", async () => {
  const { app, token } = await appWithUser();
  const created = (
    await app.inject({ method: "POST", url: "/api/vault/items", headers: auth(token), payload: ITEM })
  ).json();

  // Suppression = corbeille : absent de la liste, présent dans la corbeille.
  let res = await app.inject({
    method: "DELETE",
    url: `/api/vault/items/${created.id}`,
    headers: auth(token),
  });
  assert.equal(res.statusCode, 204);
  res = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(res.json().items.length, 0);
  res = await app.inject({ method: "GET", url: "/api/vault/trash", headers: auth(token) });
  assert.equal(res.json().items.length, 1);

  // Restauration : de retour dans la liste.
  res = await app.inject({
    method: "POST",
    url: `/api/vault/trash/${created.id}/restore`,
    headers: auth(token),
  });
  assert.equal(res.statusCode, 200);
  res = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token) });
  assert.equal(res.json().items.length, 1);

  // Purge définitive depuis la corbeille.
  await app.inject({ method: "DELETE", url: `/api/vault/items/${created.id}`, headers: auth(token) });
  res = await app.inject({
    method: "DELETE",
    url: `/api/vault/trash/${created.id}`,
    headers: auth(token),
  });
  assert.equal(res.statusCode, 204);
  res = await app.inject({ method: "GET", url: "/api/vault/trash", headers: auth(token) });
  assert.equal(res.json().items.length, 0);

  await app.close();
});

test("les items d'un utilisateur sont cloisonnés", async () => {
  const { app, token } = await appWithUser();
  // Crée un item pour l'utilisateur A.
  await app.inject({ method: "POST", url: "/api/vault/items", headers: auth(token), payload: ITEM });

  // Un second utilisateur ne voit pas les items du premier.
  const resB = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { ...REG, email: "autre@stackops.ch" },
  });
  const tokenB = resB.json().token as string;
  const list = await app.inject({
    method: "GET",
    url: "/api/vault/items",
    headers: auth(tokenB),
  });
  assert.deepEqual(list.json().items, []);

  await app.close();
});
