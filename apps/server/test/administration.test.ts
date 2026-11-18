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
  const db = openDatabase(":memory:");
  const app = buildApp(db);
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
  const effacer = (id: string, token: string, confirmEmail?: string) =>
    app.inject({
      method: "DELETE",
      url: `/api/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: confirmEmail === undefined ? {} : { confirmEmail },
    });
  return { app, db, inscrire, connecter, appeler, effacer };
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

test("effacer : l'adresse recopiée est exigée, puis le compte disparaît", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, db, inscrire, connecter, appeler, effacer } = await instance();
    const { token: admin } = await inscrire(ADMIN);
    const { userId } = await inscrire("membre@example.com");

    assert.equal((await effacer(userId, admin)).statusCode, 400);
    assert.equal((await effacer(userId, admin, "autre@example.com")).statusCode, 400);
    assert.equal((await effacer(userId, admin, " Membre@Example.com ")).statusCode, 204);

    assert.equal((await connecter("membre@example.com")).statusCode, 401);
    const liste = (await appeler("GET", "/api/admin/users", admin)).json();
    assert.deepEqual(
      liste.users.map((u: { email: string }) => u.email),
      [ADMIN],
    );

    // Le journal garde que l'administrateur a effacé UN compte, sans dire lequel.
    const lignes = await db
      .selectFrom("audit_log")
      .select(["action", "actor_email", "target"])
      .where("action", "=", "admin.user.delete")
      .execute();
    assert.deepEqual(lignes, [
      { action: "admin.user.delete", actor_email: ADMIN, target: "(compte supprimé)" },
    ]);
    const restes = await db
      .selectFrom("audit_log")
      .selectAll()
      .execute();
    assert.ok(!JSON.stringify(restes).includes("membre@example.com"));
    await app.close();
  });
});

test("effacer : ni un administrateur, ni par un compte ordinaire", async () => {
  await avecAdmins(`${ADMIN} second@example.com`, async () => {
    const { app, inscrire, effacer } = await instance();
    const { token: admin } = await inscrire(ADMIN);
    const { userId: second } = await inscrire("second@example.com");
    const { userId: membre, token: tokenMembre } = await inscrire("membre@example.com");
    const { userId: cible } = await inscrire("cible@example.com");
    assert.equal((await effacer(second, admin, "second@example.com")).statusCode, 409);
    assert.equal((await effacer(cible, tokenMembre, "cible@example.com")).statusCode, 404);
    assert.equal((await effacer(membre, admin, "membre@example.com")).statusCode, 204);
    await app.close();
  });
});

test("effacer : refusé pour le dernier administrateur d'une organisation", async () => {
  await avecAdmins(ADMIN, async () => {
    const { app, inscrire, effacer } = await instance();
    const { token: admin } = await inscrire(ADMIN);
    const { userId, token } = await inscrire("fondatrice@example.com");
    const org = await app.inject({
      method: "POST",
      url: "/api/orgs",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Équipe", encryptedOrgKey: "2.c2VsZg.c2VsZmN0" },
    });
    assert.equal(org.statusCode, 201);
    const res = await effacer(userId, admin, "fondatrice@example.com");
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().organizationId, org.json().orgId);
    await app.close();
  });
});

async function avecInscription<T>(valeur: string | undefined, f: () => Promise<T>): Promise<T> {
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

test("le bouton ferme puis rouvre l'inscription, et le choix reste en base", async () => {
  await avecAdmins(ADMIN, () =>
    avecInscription(undefined, async () => {
      const { app, db, inscrire, appeler } = await instance();
      const { token: admin } = await inscrire(ADMIN);
      const { token: membre } = await inscrire("membre@example.com");
      const regler = (token: string, registration: string) =>
        app.inject({
          method: "PUT",
          url: "/api/admin/registration",
          headers: { authorization: `Bearer ${token}` },
          payload: { registration },
        });

      const avant = (await appeler("GET", "/api/admin/users", admin)).json();
      assert.deepEqual([avant.registration, avant.registrationSource], ["open", "default"]);

      // Un compte ordinaire ne voit pas la route ; une valeur inconnue est refusée.
      assert.equal((await regler(membre, "closed")).statusCode, 404);
      assert.equal((await regler(admin, "false")).statusCode, 400);

      assert.equal((await regler(admin, "closed")).statusCode, 200);
      const refus = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: reg("nouveau@example.com"),
      });
      assert.equal(refus.statusCode, 403);
      assert.equal((await app.inject({ method: "GET", url: "/api/config" })).json().registration, "closed");

      // Un redémarrage relit la base : même base, nouvelle application.
      await app.close();
      const relance = buildApp(db);
      const config = await relance.inject({ method: "GET", url: "/api/config" });
      assert.equal(config.json().registration, "closed");

      const rouvrir = await relance.inject({
        method: "PUT",
        url: "/api/admin/registration",
        headers: { authorization: `Bearer ${admin}` },
        payload: { registration: "open" },
      });
      assert.equal(rouvrir.statusCode, 200);
      const ok = await relance.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: reg("nouveau@example.com"),
      });
      assert.equal(ok.statusCode, 201);

      const actions = await db
        .selectFrom("audit_log")
        .select("action")
        .where("action", "like", "admin.registration.%")
        .orderBy("created_at")
        .execute();
      assert.deepEqual(
        actions.map((a) => a.action),
        ["admin.registration.close", "admin.registration.open"],
      );
      await relance.close();
    }),
  );
});

test("posée dans l'environnement, l'inscription ne se change pas depuis la vue", async () => {
  await avecAdmins(ADMIN, () =>
    avecInscription("open", async () => {
      const { app, inscrire, appeler } = await instance();
      const { token } = await inscrire(ADMIN);
      const vue = (await appeler("GET", "/api/admin/users", token)).json();
      assert.deepEqual([vue.registration, vue.registrationSource], ["open", "environment"]);
      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/registration",
        headers: { authorization: `Bearer ${token}` },
        payload: { registration: "closed" },
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().code, "registration_fixed");
      await app.close();
    }),
  );
});
