/// Les codes de récupération du second facteur.
///
/// Ils n'existaient pas. Le mot « recovery » de GhostPass désignait la
/// récupération de la CLÉ DU COFFRE — `/api/auth/recover` rend le mot de passe
/// maître — et ne touchait pas à `mfa_enabled`. Quelqu'un qui perdait son
/// téléphone reprenait donc son mot de passe et restait devant une porte
/// réclamant un code que plus personne ne pouvait produire. Le premier test
/// ci-dessous épingle exactement ça, pour que la raison d'être de ce filet reste
/// écrite quelque part d'exécutable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";
import type { DB } from "../src/db/database.js";
import { generateTOTP } from "../src/services/totp.js";
import { NOMBRE_DE_CODES, empreinte } from "../src/services/recoveryCodes.js";

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

/// App + compte avec 2FA activée. Garde la base sous la main : certaines
/// vérifications portent sur ce qui est RÉELLEMENT écrit, pas sur ce que l'API
/// veut bien en dire.
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

  const activate = await app.inject({
    method: "POST",
    url: "/api/mfa/activate",
    headers: auth(token),
    payload: { code: generateTOTP(secret) },
  });
  assert.equal(activate.statusCode, 200);
  const codes = activate.json().recoveryCodes as string[];
  return { app, db, token, secret, codes };
}

function seConnecter(app: ReturnType<typeof buildApp>, totpCode?: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: REG.masterPasswordHash, totpCode },
  });
}

// --------------------------------------------------------------------------
// Pourquoi ce filet existe
// --------------------------------------------------------------------------

test("la récupération de coffre ne rouvre PAS la porte du second facteur", async () => {
  // Le défaut d'origine, en une exécution : on récupère le mot de passe maître
  // avec la clé de récupération, et la connexion réclame toujours un code TOTP.
  // C'est volontaire — faire sauter `mfa_enabled` ici transformerait la clé de
  // récupération en contournement du second facteur — donc il FAUT un autre filet.
  const { app, secret } = await appAvec2fa();
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email: REG.email,
      masterPasswordHash: REG.masterPasswordHash,
      totpCode: generateTOTP(secret),
    },
  });
  const token = reg.json().token as string;
  await app.inject({
    method: "POST",
    url: "/api/account/recovery",
    headers: auth(token),
    payload: { recoveryAuthHash: "preuve", encryptedUserKeyRecovery: "2.rec.blob" },
  });

  const recovered = await app.inject({
    method: "POST",
    url: "/api/auth/recover",
    payload: {
      email: REG.email,
      recoveryAuthHash: "preuve",
      newMasterPasswordHash: "nouveau-hash",
      newEncryptedUserKey: "2.nouvelle.cle",
    },
  });
  assert.equal(recovered.statusCode, 200);

  // Nouveau mot de passe accepté, et pourtant : toujours pas de session.
  const apres = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: REG.email, masterPasswordHash: "nouveau-hash" },
  });
  assert.equal(apres.statusCode, 401);
  assert.equal(apres.json().mfaRequired, true);
  await app.close();
});

// --------------------------------------------------------------------------
// Le filet lui-même
// --------------------------------------------------------------------------

test("l'activation rend dix codes distincts, et l'état ne les réaffiche jamais", async () => {
  const { app, codes, secret } = await appAvec2fa();
  assert.equal(codes.length, NOMBRE_DE_CODES);
  assert.equal(new Set(codes).size, NOMBRE_DE_CODES);

  // Une seule fois : l'état rend un compte, jamais les codes eux-mêmes. Seules
  // les empreintes sont gardées, donc ni le support ni nous ne pourrions les
  // réafficher même en le voulant.
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;
  const etat = await app.inject({ method: "GET", url: "/api/mfa", headers: auth(token) });
  assert.equal(etat.statusCode, 200);
  assert.equal(etat.json().recoveryCodesRemaining, NOMBRE_DE_CODES);
  assert.equal(etat.json().recoveryCodes, undefined);
  await app.close();
});

test("un code de récupération ouvre la connexion", async () => {
  const { app, codes } = await appAvec2fa();
  const res = await seConnecter(app, codes[0]);
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().token);
  await app.close();
});

test("un code de récupération ne sert qu'une fois", async () => {
  const { app, codes } = await appAvec2fa();
  assert.equal((await seConnecter(app, codes[0])).statusCode, 200);
  const rejeu = await seConnecter(app, codes[0]);
  assert.equal(rejeu.statusCode, 401);
  await app.close();
});

test("un code de récupération se retape sans cérémonie", async () => {
  // Il est lu sur une feuille imprimée : casse, tirets et espaces ne comptent pas.
  const { app, codes } = await appAvec2fa();
  const premier = codes[0]!;
  const brouillon = `  ${premier.toLowerCase().replace("-", " ")}  `;
  assert.equal((await seConnecter(app, brouillon)).statusCode, 200);
  await app.close();
});

test("les codes évitent les caractères qu'on confond en les retapant", async () => {
  // Un zéro pris pour un O est une tentative perdue sur une réserve de dix.
  const { app, codes } = await appAvec2fa();
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  await app.close();
});

test("la base ne contient aucun code en clair", async () => {
  // Une base lue — sauvegarde égarée, injection — ne doit rendre aucun code
  // utilisable. Seules les empreintes sont gardées.
  const { app, db, codes } = await appAvec2fa();
  const lignes = await db.selectFrom("mfa_recovery_codes").selectAll().execute();
  assert.equal(lignes.length, NOMBRE_DE_CODES);
  const stockes = new Set(lignes.map((l) => l.code_hash));
  for (const c of codes) {
    assert.ok(!stockes.has(c), "un code en clair est en base");
    assert.ok(stockes.has(empreinte(c)), "l'empreinte du code est absente");
  }
  await app.close();
});

test("l'état annonce combien de codes restent", async () => {
  const { app, codes, secret } = await appAvec2fa();
  const connexion = await seConnecter(app, generateTOTP(secret));
  const token = connexion.json().token as string;

  const avant = await app.inject({ method: "GET", url: "/api/mfa", headers: auth(token) });
  assert.equal(avant.json().recoveryCodesRemaining, NOMBRE_DE_CODES);

  await seConnecter(app, codes[0]);
  const apres = await app.inject({ method: "GET", url: "/api/mfa", headers: auth(token) });
  assert.equal(apres.json().recoveryCodesRemaining, NOMBRE_DE_CODES - 1);
  await app.close();
});

test("un code de récupération permet de retirer le second facteur", async () => {
  // Le cas du téléphone définitivement perdu : sans ça, le filet servirait à
  // se connecter mais jamais à sortir de la situation.
  const { app, codes, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;

  const res = await app.inject({
    method: "POST",
    url: "/api/mfa/disable",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash, code: codes[0] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().enabled, false);
  assert.equal((await seConnecter(app)).statusCode, 200);
  await app.close();
});

test("le retrait du second facteur emporte les codes", async () => {
  // Sinon un réenrôlement plus tard hériterait de codes qu'on croit périmés.
  const { app, db, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;

  // Le code de la période SUIVANTE, et non celui qui vient d'ouvrir la session :
  // l'anti-rejeu refuse le second, à juste titre. La fenêtre de tolérance de
  // ±1 période le rend acceptable tout en faisant avancer le compteur.
  const res = await app.inject({
    method: "POST",
    url: "/api/mfa/disable",
    headers: auth(token),
    payload: {
      masterPasswordHash: REG.masterPasswordHash,
      code: generateTOTP(secret, Date.now() + 30_000),
    },
  });
  assert.equal(res.statusCode, 200);
  const restants = await db.selectFrom("mfa_recovery_codes").selectAll().execute();
  assert.equal(restants.length, 0);
  await app.close();
});

test("un réenrôlement emporte les codes de l'ancien secret", async () => {
  // Ils ouvriraient une porte que leur propriétaire croit refermée.
  const { app, db, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;
  await app.inject({
    method: "POST",
    url: "/api/mfa/setup",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash },
  });
  assert.equal((await db.selectFrom("mfa_recovery_codes").selectAll().execute()).length, 0);
  await app.close();
});

test("refaire la réserve invalide les anciens codes", async () => {
  const { app, codes, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;

  const res = await app.inject({
    method: "POST",
    url: "/api/mfa/recovery-codes",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash, code: codes[0] },
  });
  assert.equal(res.statusCode, 200);
  const nouveaux = res.json().recoveryCodes as string[];
  assert.equal(nouveaux.length, NOMBRE_DE_CODES);
  for (const n of nouveaux) assert.ok(!codes.includes(n));

  // Un ancien code, non consommé, ne vaut plus rien.
  assert.equal((await seConnecter(app, codes[1])).statusCode, 401);
  assert.equal((await seConnecter(app, nouveaux[0])).statusCode, 200);
  await app.close();
});

test("refaire la réserve exige le mot de passe ET un code", async () => {
  const { app, codes, secret } = await appAvec2fa();
  const token = (await seConnecter(app, generateTOTP(secret))).json().token as string;

  const sansMdp = await app.inject({
    method: "POST",
    url: "/api/mfa/recovery-codes",
    headers: auth(token),
    payload: { masterPasswordHash: "mauvais", code: codes[0] },
  });
  assert.equal(sansMdp.statusCode, 401);

  const mauvaisCode = await app.inject({
    method: "POST",
    url: "/api/mfa/recovery-codes",
    headers: auth(token),
    payload: { masterPasswordHash: REG.masterPasswordHash, code: "000000" },
  });
  assert.equal(mauvaisCode.statusCode, 401);
  await app.close();
});
