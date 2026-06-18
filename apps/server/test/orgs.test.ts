import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const KDF = JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 });

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerUser(
  app: ReturnType<typeof buildApp>,
  email: string,
  publicKey: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      masterPasswordHash: `hash-${email}`,
      kdfParams: KDF,
      encryptedUserKey: "2.dWsx.dWsy",
      encryptedPrivateKey: "2.cGsx.cGsy",
      publicKey,
    },
  });
  return res.json().token as string;
}

/// App + un admin ayant créé une org. Renvoie tokens et orgId.
async function appWithOrg() {
  const app = buildApp(openDatabase(":memory:"));
  const adminToken = await registerUser(app, "admin@stackops.ch", "QURNSU4tcHViLWtleQ");
  const memberToken = await registerUser(app, "member@stackops.ch", "TUVNQkVSLXB1Yi1rZXk");
  const created = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(adminToken),
    payload: { name: "StackOps Team", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
  });
  assert.equal(created.statusCode, 201);
  return { app, adminToken, memberToken, orgId: created.json().orgId as string };
}

test("créer une org : le créateur devient admin actif", async () => {
  const { app, adminToken } = await appWithOrg();
  const res = await app.inject({ method: "GET", url: "/api/orgs", headers: auth(adminToken) });
  const orgs = res.json().organizations;
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].role, "admin");
  assert.equal(orgs[0].status, "active");
  await app.close();
});

test("lookup de clé publique d'un utilisateur existant", async () => {
  const { app, adminToken } = await appWithOrg();
  const res = await app.inject({
    method: "GET",
    url: "/api/users/lookup?email=member@stackops.ch",
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().publicKey, "TUVNQkVSLXB1Yi1rZXk");
  await app.close();
});

test("lookup d'un email inconnu → 404", async () => {
  const { app, adminToken } = await appWithOrg();
  const res = await app.inject({
    method: "GET",
    url: "/api/users/lookup?email=inconnu@stackops.ch",
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("flux d'invitation + acceptation + récupération de la clé d'org", async () => {
  const { app, adminToken, memberToken, orgId } = await appWithOrg();

  // L'admin ajoute le membre avec l'Org Key déjà scellée pour lui.
  const add = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(adminToken),
    payload: {
      email: "member@stackops.ch",
      role: "member",
      encryptedOrgKey: "2.bWVtYmVy.bWVtYmVyY3Q",
    },
  });
  assert.equal(add.statusCode, 201);

  // Le membre voit l'org en attente.
  let myOrgs = await app.inject({ method: "GET", url: "/api/orgs", headers: auth(memberToken) });
  assert.equal(myOrgs.json().organizations[0].status, "invited");

  // Son adhésion contient sa clé scellée + la clé publique de l'admin émetteur.
  const membership = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/membership`,
    headers: auth(memberToken),
  });
  assert.equal(membership.json().encryptedOrgKey, "2.bWVtYmVy.bWVtYmVyY3Q");
  assert.equal(membership.json().sealedByPublicKey, "QURNSU4tcHViLWtleQ");

  // Il accepte → actif.
  const accept = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/accept`,
    headers: auth(memberToken),
  });
  assert.equal(accept.statusCode, 200);
  myOrgs = await app.inject({ method: "GET", url: "/api/orgs", headers: auth(memberToken) });
  assert.equal(myOrgs.json().organizations[0].status, "active");

  // L'admin voit les deux membres.
  const members = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(adminToken),
  });
  assert.equal(members.json().members.length, 2);

  await app.close();
});

test("un non-admin ne peut pas ajouter de membre", async () => {
  const { app, memberToken, orgId } = await appWithOrg();
  const res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(memberToken),
    payload: { email: "x@stackops.ch", role: "member", encryptedOrgKey: "2.a.b" },
  });
  // Le membre n'appartient pas (encore) à l'org → 403.
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("ajouter un email inconnu → 404", async () => {
  const { app, adminToken, orgId } = await appWithOrg();
  const res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(adminToken),
    payload: { email: "inconnu@stackops.ch", role: "member", encryptedOrgKey: "2.a.b" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("accès au coffre d'org refusé sans authentification", async () => {
  const { app, orgId } = await appWithOrg();
  const res = await app.inject({ method: "GET", url: `/api/orgs/${orgId}/membership` });
  assert.equal(res.statusCode, 401);
  await app.close();
});
