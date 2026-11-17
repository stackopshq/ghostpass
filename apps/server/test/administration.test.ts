import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import { adminsDeLInstance } from "../src/services/administration.js";

// L'administration de l'instance : la vue de celui qui héberge. Le rôle vient de
// `GHOSTPASS_ADMIN_EMAILS`, posé au lancement.

const ADMIN = "hote@example.com";

function reg(email: string) {
  return {
    email,
    masterPasswordHash: `hash-${email}`,
    kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
    encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
    encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
    publicKey: "cHVibGlja2V5LWJhc2U2NA",
  };
}

async function avecAdmins<T>(valeur: string | undefined, f: () => Promise<T>): Promise<T> {
  const avant = process.env.GHOSTPASS_ADMIN_EMAILS;
  if (valeur === undefined) delete process.env.GHOSTPASS_ADMIN_EMAILS;
  else process.env.GHOSTPASS_ADMIN_EMAILS = valeur;
  try {
    return await f();
  } finally {
    if (avant === undefined) delete process.env.GHOSTPASS_ADMIN_EMAILS;
    else process.env.GHOSTPASS_ADMIN_EMAILS = avant;
  }
}

async function instance() {
  const app = buildApp(openDatabase(":memory:"));
  const inscrire = async (email: string) => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: reg(email) });
    assert.equal(res.statusCode, 201);
    return res.json() as { userId: string; token: string };
  };
  const connecter = (email: string) =>
    app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, masterPasswordHash: `hash-${email}` },
    });
  const appeler = (method: "GET" | "POST", url: string, token: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
  return { app, inscrire, connecter, appeler };
}

test("la liste des administrateurs : virgules ou espaces, casse et blancs ignorés", () => {
  assert.deepEqual([...adminsDeLInstance(" Hote@Example.com, autre@example.com  tiers@example.com ")], [
    "hote@example.com",
    "autre@example.com",
    "tiers@example.com",
  ]);
  assert.equal(adminsDeLInstance("").size, 0);
  assert.equal(adminsDeLInstance(undefined).size, 0);
});

test("un compte ordinaire ne voit pas la vue : 404, pas 403", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, inscrire, appeler } = await instance();
    const { token } = await inscrire("membre@example.com");
    assert.equal((await appeler("GET", "/api/admin/users", token)).statusCode, 404);
    const compte = await appeler("GET", "/api/account", token);
    assert.equal(compte.json().isInstanceAdmin, false);
    await app.close();
  });
});

test("sans GHOSTPASS_ADMIN_EMAILS, personne n'est administrateur", async () => {
  await avecAdmins(undefined, async () => {
    const { app, inscrire, appeler } = await instance();
    const { token } = await inscrire(ADMIN);
    assert.equal((await appeler("GET", "/api/admin/users", token)).statusCode, 404);
    await app.close();
  });
});

test("l'administrateur voit les comptes, et rien de chiffré", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, inscrire, appeler } = await instance();
    const { token } = await inscrire(ADMIN);
    await inscrire("membre@example.com");
    assert.equal((await appeler("GET", "/api/account", token)).json().isInstanceAdmin, true);

    const res = await appeler("GET", "/api/admin/users", token);
    assert.equal(res.statusCode, 200);
    const corps = res.json();
    assert.equal(corps.registration, "open");
    assert.deepEqual(
      corps.users.map((u: { email: string; isAdmin: boolean }) => [u.email, u.isAdmin]),
      [
        [ADMIN, true],
        ["membre@example.com", false],
      ],
    );
    // L'inscription ouvre une session et l'enregistre : la date est là.
    assert.ok(corps.users[1].lastLoginAt > 0);
    const brut = res.body;
    for (const champ of ["encrypted", "password", "public_key", "mfa_secret", "kdf"]) {
      assert.ok(!brut.includes(champ), `la vue ne doit pas exposer ${champ}`);
    }
    await app.close();
  });
});

test("suspendre révoque les sessions et refuse la connexion ; réactiver la rend", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, inscrire, connecter, appeler } = await instance();
    const { token: admin } = await inscrire(ADMIN);
    const { userId, token: membre } = await inscrire("membre@example.com");

    const s = await appeler("POST", `/api/admin/users/${userId}/suspend`, admin);
    assert.equal(s.statusCode, 200);

    // La session ouverte ne vaut plus rien, tout de suite.
    assert.equal((await appeler("GET", "/api/account", membre)).statusCode, 401);
    // Une nouvelle connexion, avec le bon mot de passe, est refusée et dit pourquoi.
    const refus = await connecter("membre@example.com");
    assert.equal(refus.statusCode, 403);
    assert.equal(refus.json().code, "account_suspended");
    // Un mauvais mot de passe ne l'apprend pas : il reçoit le refus ordinaire.
    const intrus = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "membre@example.com", masterPasswordHash: "faux" },
    });
    assert.equal(intrus.statusCode, 401);
    assert.notEqual(intrus.json().code, "account_suspended");

    const liste = (await appeler("GET", "/api/admin/users", admin)).json();
    assert.ok(liste.users.find((u: { id: string }) => u.id === userId).suspendedAt > 0);

    assert.equal((await appeler("POST", `/api/admin/users/${userId}/reactivate`, admin)).statusCode, 200);
    assert.equal((await connecter("membre@example.com")).statusCode, 200);
    await app.close();
  });
});

test("un administrateur ne peut pas être suspendu depuis la vue", async () => {
  await avecAdmins(`${ADMIN} second@example.com`, async () => {
    const { app, inscrire, appeler } = await instance();
    const { userId: moi, token } = await inscrire(ADMIN);
    const { userId: autre } = await inscrire("second@example.com");
    assert.equal((await appeler("POST", `/api/admin/users/${moi}/suspend`, token)).statusCode, 409);
    assert.equal((await appeler("POST", `/api/admin/users/${autre}/suspend`, token)).statusCode, 409);
    await app.close();
  });
});

test("un compte ordinaire ne peut pas suspendre", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, inscrire, appeler } = await instance();
    await inscrire(ADMIN);
    const { token } = await inscrire("membre@example.com");
    const { userId: cible } = await inscrire("cible@example.com");
    assert.equal((await appeler("POST", `/api/admin/users/${cible}/suspend`, token)).statusCode, 404);
    await app.close();
  });
});
