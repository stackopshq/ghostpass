/// La limitation des essais sur le second facteur.
///
/// Avant : rien, au niveau du compte. La seule barrière était le
/// `rateLimit: { max: 10, timeWindow: "1 minute" }` de la route de connexion,
/// qui compte **par adresse IP**. Six chiffres, c'est un million de
/// possibilités, et une fenêtre de ±1 période en rend trois acceptables à tout
/// instant : un attaquant qui fait tourner ses adresses essayait sans compter.
///
/// Le compteur vit désormais dans la ligne du compte. Ces tests portent sur ce
/// qui le distingue d'un compteur par IP, et sur le piège qui transforme une
/// protection en panne : compter une DEMANDE de code comme un échec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import type { DB } from "../src/db/database.js";
import { generateTOTP } from "../src/services/totp.js";
import { MAX_ESSAIS } from "../src/services/mfa.js";

const REG = {
  email: "kevin@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function appAvec2fa() {
  const db: DB = openDatabase(":memory:");
  const app = buildApp(db);
  const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: REG });
  const token = reg.json().token as string;
  const setup = await app.inject({
    method: "POST",
    url: "/api/mfa/setup",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash },
  });
  const secret = setup.json().secret as string;
  await app.inject({
    method: "POST",
    url: "/api/mfa/activate",
    headers: auth(token),
    payload: { code: generateTOTP(secret) },
  });
  return { app, db, secret };
}

/// Une tentative de connexion. `depuis` fait varier l'adresse source — c'est ce
/// qui sépare un compteur par compte d'un compteur par IP.
function seConnecter(
  app: ReturnType<typeof buildApp>,
  totpCode?: string,
  depuis = "127.0.0.1",
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: depuis,
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash, totpCode },
  });
}

/// Lit l'état du compteur en base. Les assertions portent sur ce qui est
/// réellement écrit, pas sur ce que l'API veut bien en dire.
async function compteur(db: DB) {
  const u = await db
    .selectFrom("users")
    .select(["mfa_failed_attempts", "mfa_locked_until"])
    .executeTakeFirstOrThrow();
  return u;
}

// --------------------------------------------------------------------------
// Le blocage
// --------------------------------------------------------------------------

test("cinq essais ratés bloquent le second facteur", async () => {
  const { app, db } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS; i++) {
    assert.equal((await seConnecter(app, "000000")).statusCode, 401);
  }
  const etat = await compteur(db);
  assert.equal(etat.mfa_failed_attempts, MAX_ESSAIS);
  assert.ok(etat.mfa_locked_until !== null && etat.mfa_locked_until > Date.now());
  await app.close();
});

test("une fois bloqué, même le bon code est refusé — et pour une autre raison", async () => {
  // Le blocage se teste AVANT toute comparaison : un compte bloqué ne doit pas
  // servir d'oracle à qui présenterait le bon code. Et la réponse doit dire
  // « trop d'essais » (429) et non « mauvais code » (401), sans quoi un client
  // légitime tourne en boucle sur une saisie qui ne peut plus aboutir.
  const { app, secret } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS; i++) await seConnecter(app, "000000");

  const res = await seConnecter(app, generateTOTP(secret));
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().mfaRequired, true);
  assert.ok(typeof res.json().lockedUntil === "number");
  await app.close();
});

test("le blocage porte sur le COMPTE et non sur l'adresse IP", async () => {
  // Le point de tout ce changement. Chaque essai part d'une adresse différente :
  // un compteur par IP n'aurait consommé qu'une unité sur dix pour chacune et
  // n'aurait donc jamais bloqué. Le 429 ne peut venir que du compteur de compte,
  // ce que `lockedUntil` confirme — le limiteur d'IP ne renvoie pas ce champ.
  const { app, secret } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS; i++) {
    const r = await seConnecter(app, "000000", `10.0.0.${i + 1}`);
    assert.equal(r.statusCode, 401, `essai ${i} depuis 10.0.0.${i + 1}`);
  }

  const depuisUneAdresseNeuve = await seConnecter(app, generateTOTP(secret), "10.0.0.99");
  assert.equal(depuisUneAdresseNeuve.statusCode, 429);
  assert.ok(typeof depuisUneAdresseNeuve.json().lockedUntil === "number");
  await app.close();
});

test("le blocage expire, et un code juste remet le compteur à zéro", async () => {
  const { app, db, secret } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS; i++) await seConnecter(app, "000000");

  // Le quart d'heure passé.
  await db.updateTable("users").set({ mfa_locked_until: Date.now() - 1 }).execute();

  const res = await seConnecter(app, generateTOTP(secret));
  assert.equal(res.statusCode, 200);
  const etat = await compteur(db);
  assert.equal(etat.mfa_failed_attempts, 0);
  assert.equal(etat.mfa_locked_until, null);
  await app.close();
});

test("passé un blocage, un seul échec reverrouille aussitôt", async () => {
  // Le compteur n'est pas remis à zéro par l'expiration : volontairement
  // sévère, c'est un essai par quart d'heure au lieu de cinq une fois le compte
  // repéré. Sans conséquence pour son propriétaire, qu'un code juste libère.
  const { app, db } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS; i++) await seConnecter(app, "000000");
  await db.updateTable("users").set({ mfa_locked_until: Date.now() - 1 }).execute();

  const res = await seConnecter(app, "000000");
  assert.equal(res.statusCode, 401);
  const etat = await compteur(db);
  assert.equal(etat.mfa_failed_attempts, MAX_ESSAIS + 1);
  assert.ok(etat.mfa_locked_until !== null && etat.mfa_locked_until > Date.now());
  await app.close();
});

// --------------------------------------------------------------------------
// Le piège : ce qui ne doit PAS compter
// --------------------------------------------------------------------------

test("une demande de code ne compte pas comme un essai raté", async () => {
  // La connexion se fait en deux temps : le client envoie d'abord le mot de
  // passe seul, reçoit « il faut un code », puis renvoie avec le code. Si le
  // premier appel comptait comme un échec, dix connexions parfaitement
  // normales verrouilleraient le compte de quelqu'un qui n'a rien fait.
  const { app, db, secret } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS * 2; i++) {
    const r = await seConnecter(app, undefined, `10.0.0.${i + 1}`);
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().mfaRequired, true);
  }

  const etat = await compteur(db);
  assert.equal(etat.mfa_failed_attempts, 0);
  assert.equal(etat.mfa_locked_until, null);
  // Et la connexion aboutit toujours.
  assert.equal((await seConnecter(app, generateTOTP(secret), "10.0.0.50")).statusCode, 200);
  await app.close();
});

test("un code rejoué compte comme un essai raté", async () => {
  // Sinon un code capté se rejoue à l'infini sans jamais déclencher le blocage.
  const { app, db, secret } = await appAvec2fa();
  const code = generateTOTP(secret);
  assert.equal((await seConnecter(app, code)).statusCode, 200);

  const rejeu = await seConnecter(app, code);
  assert.equal(rejeu.statusCode, 401);
  assert.equal((await compteur(db)).mfa_failed_attempts, 1);
  await app.close();
});

test("un code juste efface les essais ratés accumulés", async () => {
  const { app, db, secret } = await appAvec2fa();
  for (let i = 0; i < MAX_ESSAIS - 1; i++) await seConnecter(app, "000000");
  assert.equal((await compteur(db)).mfa_failed_attempts, MAX_ESSAIS - 1);

  assert.equal((await seConnecter(app, generateTOTP(secret))).statusCode, 200);
  assert.equal((await compteur(db)).mfa_failed_attempts, 0);
  await app.close();
});

// --------------------------------------------------------------------------
// La même porte ailleurs
// --------------------------------------------------------------------------

test("le retrait du second facteur compte ses essais lui aussi", async () => {
  // `/api/mfa/disable` exige un code : sans compteur, il offrirait exactement
  // le million d'essais que la connexion refuse désormais, à qui a déjà une
  // session ouverte — c'est-à-dire au voleur d'un poste laissé déverrouillé.
  const { app, db, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;

  for (let i = 0; i < MAX_ESSAIS; i++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/mfa/disable",
      headers: auth(token),
      payload: { masterPasswordHash: REG.masterPasswordHash, code: "000000" },
    });
    assert.equal(r.statusCode, 401);
  }

  const bloque = await app.inject({
    method: "POST",
    url: "/api/mfa/disable",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash, code: "000000" },
  });
  assert.equal(bloque.statusCode, 429);
  assert.ok(typeof bloque.json().lockedUntil === "number");
  assert.ok((await compteur(db)).mfa_locked_until !== null);
  await app.close();
});
