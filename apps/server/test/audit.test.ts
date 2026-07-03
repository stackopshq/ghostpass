import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

function makeApp() {
  return buildApp(openDatabase(":memory:"));
}

function reg(email: string) {
  return {
    email,
    masterPasswordHash: "client-auth-hash-AAA",
    kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
    encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
    encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
    publicKey: "cHVibGlja2V5LWJhc2U2NA",
  };
}

async function login(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, masterPasswordHash: "client-auth-hash-AAA" },
  });
  return res.json().token as string;
}

async function registerAndLogin(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
  await app.inject({ method: "POST", url: "/api/auth/register", payload: reg(email) });
  return login(app, email);
}

test("l'audit enregistre login.password et est interrogeable", async () => {
  const app = makeApp();
  const token = await registerAndLogin(app, "audit-a@stackops.ch");
  const res = await app.inject({
    method: "GET",
    url: "/api/account/audit",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const { events } = res.json();
  assert.ok(
    events.some((e: { action: string }) => e.action === "login.password"),
    "un événement login.password est attendu",
  );
  await app.close();
});

test("l'endpoint d'audit exige une authentification", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: "/api/account/audit" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("l'audit est cloisonné par utilisateur", async () => {
  const app = makeApp();
  const tokenA = await registerAndLogin(app, "audit-scope-a@stackops.ch");
  const tokenB = await registerAndLogin(app, "audit-scope-b@stackops.ch");
  // A se reconnecte : deux événements pour A, toujours un seul pour B.
  await login(app, "audit-scope-a@stackops.ch");

  const a = (
    await app.inject({
      method: "GET",
      url: "/api/account/audit",
      headers: { authorization: `Bearer ${tokenA}` },
    })
  ).json();
  const b = (
    await app.inject({
      method: "GET",
      url: "/api/account/audit",
      headers: { authorization: `Bearer ${tokenB}` },
    })
  ).json();
  assert.equal(b.events.length, 1, "B ne doit voir que sa propre connexion");
  assert.equal(a.events.length, 2, "A doit voir ses deux connexions");
  await app.close();
});
