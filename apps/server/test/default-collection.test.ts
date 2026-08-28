import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { collections, organizations } from "../src/db/repositories.js";
import {
  DEFAULT_COLLECTION_NAME,
  ensureDefaultCollections,
} from "../src/services/defaultCollection.js";
import { newId } from "../src/services/security.js";

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

/// App + une org fraîche, avec la DB pour relire les lignes : une réponse dit ce que le serveur
/// a répondu, pas ce qu'il a écrit.
async function appWithOrg() {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  const adminToken = await registerUser(app, "admin@stackops.ch");
  const created = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(adminToken),
    payload: { name: "StackOps Team", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
  });
  assert.equal(created.statusCode, 201);
  return { app, db, adminToken, orgId: created.json().orgId as string };
}

/// Invite `email` avec le rôle donné et le fait accepter. Renvoie son jeton.
async function invite(
  app: ReturnType<typeof buildApp>,
  adminToken: string,
  orgId: string,
  email: string,
  role: "admin" | "member" | "readonly",
): Promise<string> {
  const token = await registerUser(app, email);
  const add = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/members`,
    headers: auth(adminToken),
    payload: { email, role, encryptedOrgKey: "2.bWVtYmVy.bWVtYmVyY3Q" },
  });
  assert.equal(add.statusCode, 201);
  const accept = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/accept`,
    headers: auth(token),
  });
  assert.equal(accept.statusCode, 200);
  return token;
}

test("créer une organisation crée sa collection par défaut", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();

  const rows = await collections.listByOrg(db, orgId);
  assert.equal(rows.length, 1, "une organisation neuve doit avoir exactement une collection");
  const shared = rows[0]!;
  assert.equal(shared.name, DEFAULT_COLLECTION_NAME);
  assert.equal(shared.is_default, 1, "elle doit être reconnaissable au drapeau, pas à son âge");

  // Et elle est utilisable tout de suite : un secret partagé s'y range sans rien créer d'abord.
  const listed = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(adminToken),
  });
  assert.equal(listed.json().collections.length, 1);
  const put = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${shared.id}/items`,
    headers: auth(adminToken),
    payload: ITEM,
  });
  assert.equal(put.statusCode, 201);
  await app.close();
});

test("rattrapage : une org sans collection en reçoit une, et le rejouer n'en ajoute pas", async () => {
  const db = openDatabase(":memory:");
  // Org écrite directement en base, comme celles créées avant ce changement : aucune collection.
  const legacyId = newId();
  await organizations.create(db, { id: legacyId, name: "Ancienne" });
  assert.equal(await collections.listByOrg(db, legacyId).then((r) => r.length), 0);

  assert.equal(await ensureDefaultCollections(db), 1, "la première passe doit traiter l'org");
  const after = await collections.listByOrg(db, legacyId);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.name, DEFAULT_COLLECTION_NAME);
  assert.equal(after[0]!.is_default, 1);

  // Deuxième passage : c'est le point du test. Un rattrapage qui empile une collection à chaque
  // démarrage serait pire que l'absence de rattrapage.
  assert.equal(await ensureDefaultCollections(db), 0, "la seconde passe ne doit rien traiter");
  const afterSecond = await collections.listByOrg(db, legacyId);
  assert.equal(afterSecond.length, 1, "toujours une seule collection après deux passes");
  assert.equal(afterSecond[0]!.id, after[0]!.id, "et c'est la même, pas une remplaçante");

  // Une org qui possédait déjà une collection à elle n'est pas concernée : elle a un rangement,
  // en choisir un autre à sa place serait décider pour l'équipe.
  const furnishedId = newId();
  await organizations.create(db, { id: furnishedId, name: "Déjà rangée" });
  await collections.create(db, { id: newId(), orgId: furnishedId, name: "Prod" });
  assert.equal(await ensureDefaultCollections(db), 0);
  assert.equal(await collections.listByOrg(db, furnishedId).then((r) => r.length), 1);
  await db.destroy();
});

test("inviter un membre lui ouvre le coffre partagé en écriture", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  const shared = (await collections.findDefault(db, orgId))!;
  const memberToken = await invite(app, adminToken, orgId, "member@stackops.ch", "member");

  const listed = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(memberToken),
  });
  assert.deepEqual(
    listed.json().collections.map((c: { id: string }) => c.id),
    [shared.id],
    "le membre invité doit voir le coffre partagé sans octroi supplémentaire",
  );

  const write = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${shared.id}/items`,
    headers: auth(memberToken),
    payload: ITEM,
  });
  assert.equal(write.statusCode, 201, "et il doit pouvoir y déposer un secret");
  await app.close();
});

test("inviter un membre en lecture seule lui ouvre le coffre partagé en lecture", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  const shared = (await collections.findDefault(db, orgId))!;
  const readerToken = await invite(app, adminToken, orgId, "lecteur@stackops.ch", "readonly");

  const read = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${shared.id}/items`,
    headers: auth(readerToken),
  });
  assert.equal(read.statusCode, 200, "le lecteur seul doit voir le contenu du coffre partagé");

  const write = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${shared.id}/items`,
    headers: auth(readerToken),
    payload: ITEM,
  });
  assert.equal(write.statusCode, 403, "mais pas y écrire");
  assert.equal(write.json().error, "accès en écriture refusé");
  await app.close();
});

// Le test qui compte : inviter ouvre le coffre commun, et rien d'autre. Les collections
// existent pour cloisonner ; si l'invitation les ouvrait toutes, elles ne serviraient plus à
// rien, et l'élargissement passerait inaperçu jusqu'au jour où il ne le serait plus.
test("un membre invité ne voit pas les autres collections de l'organisation", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  const shared = (await collections.findDefault(db, orgId))!;

  const cloisonnee = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(adminToken),
    payload: { name: "Direction" },
  });
  assert.equal(cloisonnee.statusCode, 201);
  const privateId = cloisonnee.json().id as string;

  const memberToken = await invite(app, adminToken, orgId, "member@stackops.ch", "member");

  const listed = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(memberToken),
  });
  assert.deepEqual(
    listed.json().collections.map((c: { id: string }) => c.id),
    [shared.id],
    "seul le coffre partagé doit apparaître",
  );

  const peek = await app.inject({
    method: "GET",
    url: `/api/orgs/${orgId}/collections/${privateId}/items`,
    headers: auth(memberToken),
  });
  assert.equal(peek.statusCode, 403, "et la collection cloisonnée doit rester fermée");
  assert.equal(peek.json().error, "accès refusé à cette collection");
  await app.close();
});

test("la collection par défaut vide ne bloque pas la suppression de l'organisation", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  assert.equal(await collections.listByOrg(db, orgId).then((r) => r.length), 1);

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 204, "une org neuve doit rester supprimable");
  assert.equal(await organizations.findById(db, orgId), undefined);
  await app.close();
});

test("un secret déposé dans le coffre partagé bloque la suppression de l'organisation", async () => {
  const { app, db, adminToken, orgId } = await appWithOrg();
  const shared = (await collections.findDefault(db, orgId))!;
  const item = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${shared.id}/items`,
    headers: auth(adminToken),
    payload: ITEM,
  });
  assert.equal(item.statusCode, 201);

  const res = await app.inject({
    method: "DELETE",
    url: `/api/orgs/${orgId}`,
    headers: auth(adminToken),
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().items, 1);
  assert.match(res.json().error, /1 secret partagé/);
  assert.ok(await organizations.findById(db, orgId));
  await app.close();
});
