import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { lireLInscription } from "../src/services/inscription.js";

// Une instance auto-hébergée exposée sur Internet était ouverte à quiconque trouvait son
// adresse : rien ne permettait à l'hébergeur de fermer l'inscription.

const REG = {
  email: "nouveau@example.com",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

async function avec<T>(valeur: string | undefined, f: () => Promise<T>): Promise<T> {
  const avant = process.env.GHOSTPASS_REGISTRATION;
  if (valeur === undefined) delete process.env.GHOSTPASS_REGISTRATION;
  else process.env.GHOSTPASS_REGISTRATION = valeur;
  try {
    return await f();
  } finally {
    if (avant === undefined) delete process.env.GHOSTPASS_REGISTRATION;
    else process.env.GHOSTPASS_REGISTRATION = avant;
  }
}

async function inscrire(valeur: string | undefined) {
  return avec(valeur, async () => {
    const app = buildApp(openDatabase(":memory:"));
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
    const config = await app.inject({ method: "GET", url: "/api/config" });
    await app.close();
    return { statut: res.statusCode, corps: res.json(), config: config.json() };
  });
}

test("sans réglage, l'inscription reste ouverte, comme avant", async () => {
  const r = await inscrire(undefined);
  assert.equal(r.statut, 201);
  assert.equal(r.config.registration, "open");
});

test("closed : le serveur refuse l'inscription, même d'un client qui l'ignore", async () => {
  const r = await inscrire("closed");
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, "registration_closed");
  assert.equal(r.config.registration, "closed");
});

test("fermée, la connexion des comptes existants fonctionne toujours", async () => {
  await avec(undefined, async () => {
    const db = openDatabase(":memory:");
    const ouverte = buildApp(db);
    assert.equal(
      (await ouverte.inject({ method: "POST", url: "/api/auth/register", payload: REG })).statusCode,
      201,
    );
    await ouverte.close();

    process.env.GHOSTPASS_REGISTRATION = "closed";
    const fermee = buildApp(db);
    const res = await fermee.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash },
    });
    await fermee.close();
    assert.equal(res.statusCode, 200);
  });
});

test("la casse et les blancs ne changent rien ; vide vaut « non réglé »", () => {
  assert.equal(lireLInscription(" Closed "), "closed");
  assert.equal(lireLInscription("OPEN"), "open");
  assert.equal(lireLInscription(""), null);
  assert.equal(lireLInscription("   "), null);
});

// Un `false` ou un `close` tapé de bonne foi ne doit pas retomber sur « ouverte » : l'hébergeur
// croirait son instance fermée. Le démarrage le refuse, et une requête le traite comme fermé.
test("une valeur inconnue est refusée au démarrage, et fermée à la requête", async () => {
  for (const v of ["close", "false", "no", "0", "invite"]) {
    assert.throws(() => lireLInscription(v), /GHOSTPASS_REGISTRATION/);
  }
  const r = await inscrire("false");
  assert.equal(r.statut, 403);
  assert.equal(r.config.registration, "closed");
});
