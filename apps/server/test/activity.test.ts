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

test("historique des connexions : enregistrement + drapeau nouvel appareil", async () => {
  const app = buildApp(openDatabase(":memory:"));

  // Inscription (UA "A") = 1re connexion → nouvel appareil.
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "user-agent": "A" },
    payload: REG,
  });
  const token = reg.json().token as string;

  // Login même UA → connu ; login UA "B" → nouvel appareil.
  await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": "A" },
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });
  await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": "B" },
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/account/activity",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const events = res.json().events as Array<{ userAgent: string; newDevice: boolean }>;
  assert.equal(events.length, 3);
  // Le plus récent en tête : login UA "B" = nouvel appareil.
  assert.equal(events[0]!.userAgent, "B");
  assert.equal(events[0]!.newDevice, true);
  // Le login UA "A" (déjà vu à l'inscription) n'est PAS un nouvel appareil.
  assert.equal(events[1]!.userAgent, "A");
  assert.equal(events[1]!.newDevice, false);

  await app.close();
});
