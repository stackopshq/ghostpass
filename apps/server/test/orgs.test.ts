import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { audit, organizations, orgMembers, users } from "../src/db/repositories.js";

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

/// App + un admin ayant créé une org. Renvoie tokens, orgId et la DB (pour relire les lignes :
/// un 204 dit ce que le serveur a répondu, pas ce qu'il a écrit).
async function appWithOrg() {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  const adminToken = await registerUser(app, "admin@stackops.ch", "QURNSU4tcHViLWtleQ");
  const memberToken = await registerUser(app, "member@stackops.ch", "TUVNQkVSLXB1Yi1rZXk");
  const created = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(adminToken),
    payload: { name: "StackOps Team", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
  });
  assert.equal(created.statusCode, 201);
  return { app, db, adminToken, memberToken, orgId: created.json().orgId as string };
}

/// Fait entrer `member@stackops.ch` dans l'org avec le rôle donné, puis lui fait accepter.
async function joinAsActiveMember(
  app: ReturnType<typeof buildApp>,
  adminToken: string,
  memberToken: string,
  orgId: string,
  role: "admin" | "member" | "readonly" = "member",
) {
  const add = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(adminToken),
    payload: { email: "member@stackops.ch", role, encryptedOrgKey: "2.bWVtYmVy.bWVtYmVyY3Q" },
  });
  assert.equal(add.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/accept`,
    headers: auth(memberToken),
  });
  assert.equal(accept.statusCode, 200);
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

// ─── Suppression d'organisation ───
//
// L'opération est irréversible et emporte en cascade `org_members`, `collections` et
// `org_groups`. Chaque refus est testé séparément : une garde qu'aucun test ne fait tomber
// n'en est pas une.

test("supprimer une org : un non-membre reçoit 404 (l'existence n'est pas révélée)", async () => {
  const { app, db, memberToken, orgId } = await appWithOrg();
  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "organisation introuvable");
  // Et l'org est toujours là.
  assert.ok(await organizations.findById(db, orgId));
  await app.close();
});

test("supprimer une org : un membre actif non-admin reçoit 403", async () => {
  const { app, db, adminToken, memberToken, orgId } = await appWithOrg();
  await joinAsActiveMember(app, adminToken, memberToken, orgId, "member");
  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /administrateur/);
  assert.ok(await organizations.findById(db, orgId));
  await app.close();
});

test("supprimer une org qui contient encore des collections et des secrets → 409 chiffré", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  const coll = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(adminToken),
    payload: { name: "Prod" },
  });
  assert.equal(coll.statusCode, 201);
  const cid = coll.json().id as string;
  const item = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${cid}/items`,
    headers: auth(adminToken),
    payload: { encryptedKey: "2.aXRlbQ.aXRlbWN0", encryptedData: "2.ZGF0YQ.ZGF0YWN0" },
  });
  assert.equal(item.statusCode, 201);

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.collections, 1);
  assert.equal(body.items, 1);
  // Le décompte doit être DANS le message : c'est lui que l'interface affiche.
  assert.match(body.error, /1 collection et 1 secret partagé/);
  assert.ok(await organizations.findById(db, orgId));
  await app.close();
});

test("supprimer une org où il reste un autre membre actif → 409 avec le décompte", async () => {
  const { app, db, adminToken, memberToken, orgId } = await appWithOrg();
  await joinAsActiveMember(app, adminToken, memberToken, orgId, "member");
  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.activeMembers, 1);
  assert.match(body.error, /1 autre membre actif/);
  assert.ok(await organizations.findById(db, orgId));
  await app.close();
});

test("une invitation en attente ne bloque pas la suppression", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  // Invité mais jamais accepté : ce membre n'a jamais eu accès à quoi que ce soit.
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
  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 204);
  assert.equal(await organizations.findById(db, orgId), undefined);
  await app.close();
});

test("supprimer une org vide : 204, la ligne disparaît vraiment et l'audit la consigne", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  assert.ok(await organizations.findById(db, orgId), "l'org doit exister avant la suppression");

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 204);

  // Relecture directe en base : c'est la ligne qui fait foi, pas le code de retour.
  assert.equal(await organizations.findById(db, orgId), undefined);
  // Et l'adhésion de l'admin est partie en cascade.
  assert.equal(await orgMembers.listByOrg(db, orgId).then((r) => r.length), 0);

  const mine = await app.inject({ method: "GET", url: "/api/orgs", headers: auth(adminToken) });
  assert.equal(mine.json().organizations.length, 0);

  const admin = (await users.findByEmail(db, "admin@stackops.ch"))!;
  const events = await audit.listByUser(db, admin.id, 50);
  assert.ok(
    events.some((e) => e.action === "org.delete" && e.target === "StackOps Team"),
    "la suppression doit être consignée à l'audit",
  );
  await app.close();
});
