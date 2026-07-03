import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const KDF = JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 });
const ITEM = { encryptedKey: "2.aWtleQ.aWtleWN0", encryptedData: "2.ZGF0YQ.ZGF0YWN0" };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

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

/// Org avec admin + member (actif) + readonly (actif) + une collection.
async function setup() {
  const app = buildApp(openDatabase(":memory:"));
  const adminToken = await registerUser(app, "admin@stackops.ch");
  const memberToken = await registerUser(app, "member@stackops.ch");
  const readonlyToken = await registerUser(app, "readonly@stackops.ch");
  const orgId = (
    await app.inject({
      method: "POST",
      url: "/api/orgs",
      headers: auth(adminToken),
      payload: { name: "Team", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
    })
  ).json().orgId as string;
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
  const col = (
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/collections`,
      headers: auth(adminToken),
      payload: { name: "Infra" },
    })
  ).json();
  const members = (
    await app.inject({ method: "GET", url: `/api/orgs/${orgId}/members`, headers: auth(adminToken) })
  ).json().members;
  const memberId = members.find((m: { email: string }) => m.email === "member@stackops.ch").userId;
  return { app, adminToken, memberToken, readonlyToken, orgId, colId: col.id as string, memberId };
}

test("un groupe confère l'accès effectif à une collection (via une route item)", async () => {
  const { app, adminToken, memberToken, orgId, colId, memberId } = await setup();

  // Sans accès : le membre ne peut pas lire les items de la collection.
  const before = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${colId}/items`,
    headers: auth(memberToken),
  });
  assert.equal(before.statusCode, 403);

  // Admin : crée un groupe, y ajoute le membre, accorde `write` sur la collection.
  const gid = (
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/groups`,
      headers: auth(adminToken),
      payload: { name: "Ops" },
    })
  ).json().id as string;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups/${gid}/members`,
        headers: auth(adminToken),
        payload: { userId: memberId },
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups/${gid}/collections/${colId}`,
        headers: auth(adminToken),
        payload: { permission: "write" },
      })
    ).statusCode,
    201,
  );

  // Désormais : lecture OK (200) et écriture OK (201) via l'accès de groupe.
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/orgs/${orgId}/collections/${colId}/items`,
        headers: auth(memberToken),
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/collections/${colId}/items`,
        headers: auth(memberToken),
        payload: ITEM,
      })
    ).statusCode,
    201,
  );

  // La collection apparaît maintenant dans la liste du membre.
  const list = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections`,
      headers: auth(memberToken),
    })
  ).json().collections;
  assert.ok(list.some((c: { id: string }) => c.id === colId));

  // Révocation → accès retiré.
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/orgs/${orgId}/groups/${gid}/collections/${colId}`,
        headers: auth(adminToken),
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/orgs/${orgId}/collections/${colId}/items`,
        headers: auth(memberToken),
      })
    ).statusCode,
    403,
  );
});

test("changement de rôle + refus de rétrograder le dernier admin", async () => {
  const { app, adminToken, orgId, memberId } = await setup();
  const adminMembers = (
    await app.inject({ method: "GET", url: `/api/orgs/${orgId}/members`, headers: auth(adminToken) })
  ).json().members;
  const adminId = adminMembers.find((m: { email: string }) => m.email === "admin@stackops.ch").userId;

  // Rétrograder le seul admin → refusé.
  const lastAdmin = await app.inject({
    method: "PATCH",
    url: `/api/orgs/${orgId}/members/${adminId}`,
    headers: auth(adminToken),
    payload: { role: "member" },
  });
  assert.equal(lastAdmin.statusCode, 400);

  // Promouvoir le membre en admin → OK.
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/orgs/${orgId}/members/${memberId}`,
        headers: auth(adminToken),
        payload: { role: "admin" },
      })
    ).statusCode,
    200,
  );
  // Maintenant deux admins : rétrograder l'un passe.
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/orgs/${orgId}/members/${adminId}`,
        headers: auth(adminToken),
        payload: { role: "member" },
      })
    ).statusCode,
    200,
  );
});

test("les endpoints admin refusent les non-admins et l'inter-org", async () => {
  const { app, memberToken, adminToken, orgId } = await setup();
  // Non-admin (membre) → 403.
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups`,
        headers: auth(memberToken),
        payload: { name: "X" },
      })
    ).statusCode,
    403,
  );
  // Inter-org : un admin d'une AUTRE org ne peut pas créer de groupe ici.
  const otherAdmin = await registerUser(app, "other@stackops.ch");
  await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(otherAdmin),
    payload: { name: "Other", encryptedOrgKey: "2.x.y" },
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups`,
        headers: auth(otherAdmin),
        payload: { name: "X" },
      })
    ).statusCode,
    403,
  );
  // Sanity : l'admin légitime, lui, peut.
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/orgs/${orgId}/groups`,
        headers: auth(adminToken),
        payload: { name: "Ops" },
      })
    ).statusCode,
    201,
  );
});
