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

function makeCollection(app: ReturnType<typeof buildApp>, orgId: string, token: string) {
  return app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(token),
    payload: { name: "Infra" },
  });
}

async function userId(
  app: ReturnType<typeof buildApp>,
  orgId: string,
  adminToken: string,
  email: string,
): Promise<string> {
  const members = (
    await app.inject({ method: "GET", url: `/api/orgs/${orgId}/members`, headers: auth(adminToken) })
  ).json().members;
  return members.find((m: { email: string }) => m.email === email).userId;
}

test("un membre actif crée une collection (et en devient gestionnaire) ; un non-membre est refusé", async () => {
  const { app, memberToken, orgId } = await setupOrg();
  const ok = await makeCollection(app, orgId, memberToken);
  assert.equal(ok.statusCode, 201);

  const outsiderToken = await registerUser(app, "outsider@stackops.ch");
  const ko = await makeCollection(app, orgId, outsiderToken);
  assert.equal(ko.statusCode, 403);
  await app.close();
});

test("permissions fines : un membre n'accède pas à une collection sans octroi", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json(); // créée par l'admin

  // Le membre n'a aucun accès explicite → lecture refusée.
  const denied = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
  });
  assert.equal(denied.statusCode, 403);

  // L'admin lui accorde l'accès en lecture.
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");
  const grant = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "read" },
  });
  assert.equal(grant.statusCode, 201);

  // Désormais il lit, mais ne peut pas écrire (read seulement).
  const read = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
  });
  assert.equal(read.statusCode, 200);
  const write = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
    payload: ITEM,
  });
  assert.equal(write.statusCode, 403);
  await app.close();
});

test("seul un gestionnaire de collection peut octroyer des accès", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");

  // Le membre (sans accès manage sur cette collection) ne peut pas octroyer.
  const res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(memberToken),
    payload: { userId: memberId, permission: "write" },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("cycle de vie d'un item partagé par le gestionnaire de la collection", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  // Le membre crée la collection → il en est gestionnaire.
  const col = (await makeCollection(app, orgId, memberToken)).json();

  let res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
    payload: ITEM,
  });
  assert.equal(res.statusCode, 201);
  const itemId = res.json().id as string;

  // L'admin (manage implicite) voit l'item.
  res = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
  });
  assert.equal(res.json().items.length, 1);

  res = await app.inject({
    method: "PUT",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
    payload: { encryptedKey: ITEM.encryptedKey, encryptedData: "2.bmV3.bmV3Y3Q" },
  });
  assert.equal(res.statusCode, 200);

  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 204);

  // Rejouée : toujours 204. Un client qui retente après un délai réseau
  // dépassé ne doit pas voir une erreur pour une suppression qui a réussi.
  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 204, "la suppression d'un item est idempotente");
  await app.close();
});

test("impossible d'accéder à une collection d'une autre organisation", async () => {
  const { app, adminToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

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

test("révocation : la rotation retire le membre, remplace les clés et ré-enveloppe les items", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();
  const item = (
    await app.inject({
      method: "POST",
      url: `/api/orgs/${orgId}/collections/${col.id}/items`,
      headers: auth(adminToken),
      payload: ITEM,
    })
  ).json();

  const adminId = await userId(app, orgId, adminToken, "admin@stackops.ch");
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");

  const rot = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/rotate`,
    headers: auth(adminToken),
    payload: {
      revokeUserId: memberId,
      members: [{ userId: adminId, encryptedOrgKey: "2.bmV3YWRtaW4.eA" }],
      items: [{ id: item.id, encryptedKey: "2.bmV3aWs.eA" }],
    },
  });
  assert.equal(rot.statusCode, 200);

  const revoked = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/membership`,
    headers: auth(memberToken),
  });
  assert.equal(revoked.statusCode, 404);

  const adminMembership = (
    await app.inject({ method: "GET", url: `/api/orgs/${orgId}/membership`, headers: auth(adminToken) })
  ).json();
  assert.equal(adminMembership.encryptedOrgKey, "2.bmV3YWRtaW4.eA");
  const itemsAfter = (
    await app.inject({ method: "GET", url: `/api/orgs/${orgId}/items`, headers: auth(adminToken) })
  ).json().items;
  assert.equal(itemsAfter[0].encryptedKey, "2.bmV3aWs.eA");
  assert.equal(itemsAfter[0].encryptedData, ITEM.encryptedData);
  await app.close();
});

test("un non-admin ne peut pas déclencher de rotation", async () => {
  const { app, memberToken, orgId } = await setupOrg();
  const res = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/rotate`,
    headers: auth(memberToken),
    payload: { members: [], items: [] },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

/// Le défaut signalé le 2026-08-29 : dans l'org `stackops`, l'écran d'accès
/// d'une collection n'affichait PERSONNE, alors que ses deux admins y lisaient
/// et y écrivaient — l'un venait d'y déposer un mot de passe.
///
/// La liste rendait `collection_access`, une seule des trois sources que
/// `permissionFor` additionne. Une liste d'accès qui affiche « personne » là où
/// deux personnes entrent invite à donner un accès déjà donné, et laisse croire
/// qu'une révocation ferme une porte qui reste ouverte.
test("la liste d'accès montre l'accès effectif, admin compris, pas seulement les octrois", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  // Aucun octroi n'a été fait. L'admin doit pourtant apparaître : son `manage`
  // est implicite, et c'est exactement le cas qui manquait.
  const seul = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections/${col.id}/access`,
      headers: auth(adminToken),
    })
  ).json().access;
  assert.equal(seul.length, 1, "l'admin d'org doit apparaître sans aucun octroi");
  assert.equal(seul[0].email, "admin@stackops.ch");
  assert.equal(seul[0].permission, "manage");
  assert.equal(seul[0].sources[0].kind, "admin");
  assert.equal(seul[0].revocable, false, "on ne révoque pas un rôle depuis cet écran");

  // Un octroi direct s'ajoute, et lui est révocable.
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");
  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "read" },
  });
  const deux = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections/${col.id}/access`,
      headers: auth(adminToken),
    })
  ).json().access;
  assert.equal(deux.length, 2);
  const membre = deux.find((a: { email: string }) => a.email === "member@stackops.ch");
  assert.equal(membre.permission, "read");
  assert.equal(membre.revocable, true);
  assert.equal(membre.sources[0].kind, "direct");

  // Et celui qui n'a rien n'apparaît pas : la liste dit qui entre, pas qui existe.
  assert.equal(
    deux.some((a: { email: string }) => a.email === "readonly@stackops.ch"),
    false,
  );
  await app.close();
});

test("révoquer un accès nommé le retire, ôte l'accès effectif, et reste idempotent", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");

  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "write" },
  });

  // Le bénéficiaire ne peut pas lire la liste : il a `write`, pas `manage`.
  const indiscret = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(memberToken),
  });
  assert.equal(indiscret.statusCode, 403);

  const retrait = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/access/${memberId}`,
    headers: auth(adminToken),
  });
  assert.equal(retrait.statusCode, 204);

  // Retiré de la liste — et l'accès effectivement perdu, pas seulement la ligne.
  const apres = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections/${col.id}/access`,
      headers: auth(adminToken),
    })
  ).json().access;
  assert.equal(
    apres.some((a: { userId: string }) => a.userId === memberId),
    false,
    "le membre ne doit plus figurer dans la liste d'accès",
  );
  const refuse = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(memberToken),
  });
  assert.equal(refuse.statusCode, 403);

  // Idempotent : un second retrait répond comme le premier. Un double appui ne doit
  // pas ressembler à une panne.
  const encore = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/access/${memberId}`,
    headers: auth(adminToken),
  });
  assert.equal(encore.statusCode, 204);
  await app.close();
});

test("la liste des collections porte la permission effective, pas le rôle", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();
  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");

  // L'admin d'org n'a reçu aucun octroi : sa permission vient de son rôle, et
  // `permissionFor` la calcule à `manage`. C'est elle qu'on doit lire, pas le rôle brut.
  const vueAdmin = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections`,
      headers: auth(adminToken),
    })
  ).json().collections;
  const sienne = vueAdmin.find((c: { id: string }) => c.id === col.id);
  assert.equal(sienne.permission, "manage", "un administrateur gère toute collection");

  // Un membre avec un octroi en lecture doit lire `read` — et non `member`, son rôle.
  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "read" },
  });
  const vueMembre = (
    await app.inject({
      method: "GET",
      url: `/api/orgs/${orgId}/collections`,
      headers: auth(memberToken),
    })
  ).json().collections;
  // Ne pas compter : l'organisation porte déjà une collection par défaut, que le membre
  // voit aussi. C'est celle qu'on vient de lui ouvrir qu'on interroge.
  const vue = vueMembre.find((c: { id: string }) => c.id === col.id);
  assert.ok(vue, "le membre doit voir la collection qu'on vient de lui ouvrir");
  assert.equal(vue.permission, "read", "la permission effective, pas le rôle « member »");
  await app.close();
});

test("un accès en lecture seule ne peut pas supprimer un élément partagé", async () => {
  // L'interface cache désormais « Supprimer » quand la permission effective
  // n'est pas `write`/`manage`. Ce test dit que la garde n'est pas seulement
  // cosmétique : un appel direct est refusé de la même façon, et le refus est
  // un 403 — pas un 404 qui laisserait croire que l'élément n'existe plus.
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  const created = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
    payload: ITEM,
  });
  assert.equal(created.statusCode, 201);
  const itemId = created.json().id as string;

  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");
  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "read" },
  });

  const refus = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}/items/${itemId}`,
    headers: auth(memberToken),
  });
  assert.equal(refus.statusCode, 403);

  // Et l'élément est toujours là : un refus ne doit rien avoir emporté.
  const encore = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
  });
  assert.equal(encore.json().items.length, 1);
  await app.close();
});

test("supprimer une collection : le gestionnaire peut, le membre simple non", async () => {
  const { app, adminToken, memberToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();

  // Un étranger à l'organisation reçoit 404 : lui répondre « réservé au
  // gestionnaire » confirmerait qu'une collection porte cet identifiant.
  const outsiderToken = await registerUser(app, "outsider-del@stackops.ch");
  let res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}`,
    headers: auth(outsiderToken),
  });
  assert.equal(res.statusCode, 404);

  // Un membre de l'organisation, lui, reçoit 403 — avec ou sans accès en
  // lecture. C'est la règle déjà en vigueur sur la route de lecture des items,
  // et deux gestes voisins ne doivent pas se comporter différemment.
  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 403);

  const memberId = await userId(app, orgId, adminToken, "member@stackops.ch");
  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/access`,
    headers: auth(adminToken),
    payload: { userId: memberId, permission: "read" },
  });
  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}`,
    headers: auth(memberToken),
  });
  assert.equal(res.statusCode, 403);

  res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 204, "un admin d'organisation a `manage` d'office");

  // Vérifié par ce que l'appelant observe, pas en fouillant la base : la
  // collection ne doit plus figurer dans la liste.
  const restantes = (await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(adminToken),
  })).json().collections;
  assert.equal(restantes.filter((c: { id: string }) => c.id === col.id).length, 0);
  await app.close();
});

test("une collection qui contient encore un secret refuse d'être supprimée", async () => {
  const { app, adminToken, orgId } = await setupOrg();
  const col = (await makeCollection(app, orgId, adminToken)).json();
  await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${col.id}/items`,
    headers: auth(adminToken),
    payload: ITEM,
  });

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${col.id}`,
    headers: auth(adminToken),
  });
  // Le schéma cascade sur `org_items` : sans ce garde, le clic effacerait des
  // secrets d'équipe sans jamais les nommer.
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().items, 1);
  assert.match(res.json().error, /1 secret partagé/);
  await app.close();
});

test("la collection par défaut ne se supprime pas", async () => {
  const { app, adminToken, orgId } = await setupOrg();
  const parDefaut = (await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(adminToken),
  })).json().collections[0];

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}/collections/${parDefaut.id}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().reason, "default");
  await app.close();
});
