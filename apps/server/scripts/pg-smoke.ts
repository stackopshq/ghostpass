// Smoke test PostgreSQL : boote l'app contre `DATABASE_URL` (Postgres), crée le schéma via
// `createDb()`, puis exerce les flux cœur (register → login → CRUD coffre → corbeille → org)
// avec `app.inject`. Sort en code 1 au premier échec. Usage : DATABASE_URL=... tsx scripts/pg-smoke.ts
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/database.js";

const REG = {
  email: `pg-smoke-${Date.now()}@stackops.ch`,
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL requis (Postgres)");
  const db = await createDb();
  const app = buildApp(db);

  // Anti-énumération : /.well-known/webauthn + health OK.
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  const wk = await app.inject({ method: "GET", url: "/.well-known/webauthn" });
  assert.equal(wk.statusCode, 200);
  assert.ok(Array.isArray(wk.json().origins));

  // register
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  assert.equal(reg.statusCode, 201, `register: ${reg.body}`);
  const token = reg.json().token as string;
  assert.ok(token);

  // register en double → 409
  const dup = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  assert.equal(dup.statusCode, 409);

  // prelogin renvoie les kdfParams stockés
  const pre = await app.inject({
    method: "POST",
    url: "/api/auth/prelogin",
    payload: { email: REG.email },
  });
  assert.equal(pre.json().kdfParams, REG.kdfParams);

  // login
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal(login.statusCode, 200, `login: ${login.body}`);
  const token2 = login.json().token as string;

  // vault: create → list → update → soft-delete → trash → restore → purge
  const create = await app.inject({
    method: "POST",
    url: "/api/vault/items",
    headers: auth(token2),
    payload: { encryptedKey: "2.k.k", encryptedData: "2.d.d" },
  });
  assert.equal(create.statusCode, 201);
  const itemId = create.json().id as string;

  const list = await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token2) });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 1);
  assert.equal(list.json().items[0].id, itemId);

  const upd = await app.inject({
    method: "PUT",
    url: `/api/vault/items/${itemId}`,
    headers: auth(token2),
    payload: { encryptedKey: "2.k2.k2", encryptedData: "2.d2.d2" },
  });
  assert.equal(upd.statusCode, 200);
  assert.equal(upd.json().encryptedData, "2.d2.d2");

  assert.equal(
    (await app.inject({ method: "DELETE", url: `/api/vault/items/${itemId}`, headers: auth(token2) }))
      .statusCode,
    204,
  );
  const trash = await app.inject({ method: "GET", url: "/api/vault/trash", headers: auth(token2) });
  assert.equal(trash.json().items.length, 1);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/vault/trash/${itemId}/restore`,
        headers: auth(token2),
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/vault/items", headers: auth(token2) })).json().items
      .length,
    1,
  );

  // org: create → membership (upsert de collection_access via un autre flux) → rotate (transaction)
  const org = await app.inject({
    method: "POST",
    url: "/api/orgs",
    headers: auth(token2),
    payload: { name: "PG Team", encryptedOrgKey: "2.ok.ok" },
  });
  assert.equal(org.statusCode, 201, `org: ${org.body}`);
  const orgId = org.json().orgId as string;
  const orgs = await app.inject({ method: "GET", url: "/api/orgs", headers: auth(token2) });
  assert.equal(orgs.json().organizations[0].orgId, orgId);
  assert.equal(orgs.json().organizations[0].role, "admin");

  // collection (admin) + item partagé + upsert d'accès (ON CONFLICT)
  const col = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections`,
    headers: auth(token2),
    payload: { name: "Prod" },
  });
  assert.equal(col.statusCode, 201);
  const cid = col.json().id as string;
  const oitem = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/collections/${cid}/items`,
    headers: auth(token2),
    payload: { encryptedKey: "2.ik.ik", encryptedData: "2.id.id" },
  });
  assert.equal(oitem.statusCode, 201);

  // rotate (exécute une transaction Kysely + upsert-like)
  const rot = await app.inject({
    method: "POST",
    url: `/api/orgs/${orgId}/rotate`,
    headers: auth(token2),
    payload: { members: [{ userId: reg.json().userId, encryptedOrgKey: "2.ok2.ok2" }], items: [] },
  });
  assert.equal(rot.statusCode, 200, `rotate: ${rot.body}`);

  await app.close();
  await db.destroy();
  // eslint-disable-next-line no-console
  console.log("PG_SMOKE_OK");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("PG_SMOKE_FAIL", err);
  process.exit(1);
});
