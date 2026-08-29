// Forme des réponses de l'API — le contrat que lisent les clients.
//
// Ces tests ne vérifient pas des valeurs mais des **types**. Ils existent parce que deux
// divergences de forme, invisibles côté serveur, ont rendu l'application iOS inutilisable :
//
//   — `kdfParams` est une *chaîne* contenant du JSON, jamais un objet : la colonne est un
//     TEXT et le serveur la renvoie verbatim. Le client iOS l'attendait en objet, le
//     ré-encodait, et obtenait une chaîne doublement échappée que serde refuse. Toute
//     connexion échouait dès le calcul du hash d'authentification.
//   — `createdAt` / `updatedAt` / `deletedAt` sont des *nombres* — des millisecondes
//     depuis l'epoch, les colonnes étant des INTEGER. Le client iOS les attendait en
//     chaînes, et le décodage échouait pour la liste entière : le coffre restait vide.
//
// Aucun test ne les couvrait, ni ici ni côté client : le serveur était juste, et les
// clients se trompaient chacun de leur côté. Les tests iOS disent la même chose, mais ils
// réclament un runner macOS que la forge n'a pas ; ceux-ci tournent partout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const KDF = JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 });

const REG = {
  email: "kevin@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: KDF,
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

const ITEM = { encryptedKey: "2.aWtleW5vbmNl.aWtleWN0", encryptedData: "2.ZGF0YW5vbmNl.ZGF0YWN0" };

async function appWithUser() {
  const app = buildApp(openDatabase(":memory:"));
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  return { app, token: res.json().token as string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("prelogin renvoie kdfParams en chaîne, pas en objet", async () => {
  const app = buildApp(openDatabase(":memory:"));
  for (const email of ["inconnu@example.com", REG.email]) {
    if (email === REG.email) {
      await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
    }
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/prelogin",
      payload: { email },
    });
    assert.equal(res.statusCode, 200);
    const { kdfParams } = res.json();
    assert.equal(typeof kdfParams, "string", `kdfParams doit rester une chaîne (${email})`);
    // Et une chaîne que le cœur sait relire : du JSON, avec les champs attendus.
    const parsed = JSON.parse(kdfParams);
    assert.equal(typeof parsed.mem_cost_kib, "number");
    assert.equal(typeof parsed.time_cost, "number");
    assert.equal(typeof parsed.parallelism, "number");
  }
  await app.close();
});

test("login renvoie les blobs d'ouverture et kdfParams en chaîne", async () => {
  const { app } = await appWithUser();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.token, "string");
  assert.equal(typeof body.kdfParams, "string", "kdfParams doit rester une chaîne");
  assert.equal(typeof body.encryptedUserKey, "string");
  assert.equal(typeof body.encryptedPrivateKey, "string");
  await app.close();
});

test("les horodatages des items sont des nombres", async () => {
  const { app, token } = await appWithUser();
  const cree = await app.inject({
    method: "POST",
    url: "/api/vault/items",
    headers: auth(token),
    payload: ITEM,
  });
  assert.equal(cree.statusCode, 201);

  for (const item of [cree.json(), (await app.inject({
    method: "GET",
    url: "/api/vault/items",
    headers: auth(token),
  }).then((r) => r.json())).items[0]]) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.encryptedKey, "string");
    assert.equal(typeof item.encryptedData, "string");
    assert.equal(typeof item.createdAt, "number", "createdAt doit rester un nombre");
    assert.equal(typeof item.updatedAt, "number", "updatedAt doit rester un nombre");
    // `deletedAt` est nul tant que l'item n'est pas à la corbeille — jamais une chaîne.
    assert.equal(item.deletedAt, null);
  }
  await app.close();
});

test("un item mis à la corbeille porte un deletedAt numérique", async () => {
  const { app, token } = await appWithUser();
  const { id } = (await app.inject({
    method: "POST",
    url: "/api/vault/items",
    headers: auth(token),
    payload: ITEM,
  })).json();

  await app.inject({ method: "DELETE", url: `/api/vault/items/${id}`, headers: auth(token) });
  const corbeille = (await app.inject({
    method: "GET",
    url: "/api/vault/trash",
    headers: auth(token),
  })).json();
  assert.equal(corbeille.items.length, 1);
  assert.equal(typeof corbeille.items[0].deletedAt, "number");
  await app.close();
});
