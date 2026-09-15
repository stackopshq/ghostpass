// SSO mobile : PKCE entre l'APPLICATION et NOUS.
//
// Pourquoi ce détour plutôt que le flux OIDC natif de l'app : l'IdP est Cloudflare Access
// for SaaS, qui n'enregistre aucun client public (chaque application reçoit un
// `client_secret`, et `grant_types` vaut `authorization_code` seul). Or sur iOS, N'IMPORTE
// QUELLE application peut revendiquer un schéma d'URL personnalisé : une application
// malveillante installée sur le téléphone peut recevoir le retour destiné à GhostPass. Si ce
// retour portait un jeton de session, elle aurait le compte.
//
// Le PKCE est donc déplacé sur le saut interceptable — app ↔ nous. Notre serveur, lui, reste
// un client confidentiel face à Cloudflare, exactement comme le chemin web.
//
// Ces tests couvrent ce qu'une bibliothèque OIDC faisait gratuitement et qu'on hérite en
// déplaçant la vérification chez nous : usage unique du code, liaison au bon challenge,
// comparaison stricte, liste blanche de l'adresse de retour.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { buildApp } from "../src/app.js";
import { type DB, openDatabase } from "../src/db/database.js";

const CLIENT_ID = "ghostpass-test";
const APP_REDIRECT = "ch.stackops.ghostpass://sso";
const MOBILE_CALLBACK = "https://vault.example.test/api/auth/sso/mobile/callback";
const USER = {
  email: "sso-mobile@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

let server: http.Server;
let base = "";
let privateKey: KeyLike;
let currentIdToken = ""; // ce que /token renvoie (réglé par le test après lecture du nonce)

// IdP OIDC mocké en process : découverte + JWKS (vraie clé) + /token.
before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/.well-known/openid-configuration")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
        }),
      );
    } else if (url.startsWith("/jwks")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    } else if (url.startsWith("/token") && req.method === "POST") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id_token: currentIdToken, token_type: "Bearer" }));
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  process.env.OIDC_ISSUER = base;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = "test-secret";
  process.env.OIDC_REDIRECT_URI = "http://localhost:5173/sso/callback";
  process.env.OIDC_MOBILE_REDIRECT_URI = MOBILE_CALLBACK;
  process.env.SSO_MOBILE_REDIRECT_URIS = APP_REDIRECT;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeApp(): { app: ReturnType<typeof buildApp>; db: DB } {
  const db = openDatabase(":memory:");
  return { app: buildApp(db), db };
}

/// PKCE côté application : vérificateur aléatoire, challenge = base64url(sha256(vérificateur)).
function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}
function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function idTokenFor(opts: { email: string; nonce: string; emailVerified?: boolean }) {
  return new SignJWT({
    email: opts.email,
    email_verified: opts.emailVerified ?? true,
    nonce: opts.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(base)
    .setAudience(CLIENT_ID)
    .setSubject("subject-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

type App = ReturnType<typeof buildApp>;

/// Étape 1 : l'app ouvre une session web sur `/start`. Le serveur répond par une redirection
/// vers l'IdP. Renvoie la réponse brute (les tests d'erreur en ont besoin).
function startMobile(
  app: App,
  opts: {
    verifier?: string;
    challenge?: string;
    method?: string | null;
    state: string;
    redirectUri?: string;
  },
) {
  const qs = new URLSearchParams({ state: opts.state });
  const challenge = opts.challenge ?? challengeOf(opts.verifier ?? newVerifier());
  qs.set("code_challenge", challenge);
  if (opts.method !== null) qs.set("code_challenge_method", opts.method ?? "S256");
  if (opts.redirectUri) qs.set("redirect_uri", opts.redirectUri);
  return app.inject({ method: "GET", url: `/api/auth/sso/mobile/start?${qs.toString()}` });
}

/// Mène le parcours jusqu'au retour vers l'application, et rend l'URL de ce retour.
async function loginToRedirect(
  app: App,
  opts: { email: string; verifier: string; appState: string; emailVerified?: boolean },
): Promise<URL> {
  const started = await startMobile(app, { verifier: opts.verifier, state: opts.appState });
  assert.equal(started.statusCode, 302, "start doit rediriger vers l'IdP");
  const authUrl = new URL(started.headers.location as string);
  const ssoState = authUrl.searchParams.get("state") as string;
  const nonce = authUrl.searchParams.get("nonce") as string;
  currentIdToken = await idTokenFor({
    email: opts.email,
    nonce,
    emailVerified: opts.emailVerified,
  });
  const cb = await app.inject({
    method: "GET",
    url: `/api/auth/sso/mobile/callback?code=idp-code&state=${ssoState}`,
  });
  assert.equal(cb.statusCode, 302, "le callback doit renvoyer l'app sur son schéma");
  return new URL(cb.headers.location as string);
}

/// Parcours complet jusqu'au code à usage unique (cas nominal).
async function loginToCode(app: App, verifier: string, appState = "etat-app"): Promise<string> {
  const back = await loginToRedirect(app, { email: USER.email, verifier, appState });
  const code = back.searchParams.get("code");
  assert.ok(code, `code attendu dans le retour, obtenu: ${back.href}`);
  return code as string;
}

function exchange(app: App, code: string, codeVerifier: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sso/exchange",
    payload: { code, codeVerifier },
  });
}

async function register(app: App) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: USER });
  assert.equal(res.statusCode, 201);
}

// ─── /status : ce que le client peut savoir, et rien de plus ───

test("status: expose enabled, et rien d'autre", async () => {
  // `enabled` reste : il décide de l'affichage du bouton SSO côté app, et c'est un fait de
  // déploiement que le client ne peut pas connaître autrement. Ni `issuer` ni `mobileClientId` :
  // le client ne fait plus de découverte OIDC, ils n'auraient aucun consommateur.
  const { app } = makeApp();
  const res = await app.inject({ method: "GET", url: "/api/auth/sso/status" });
  assert.deepEqual(res.json(), { enabled: true });
  await app.close();
});

// ─── /start : ce qui doit être refusé AVANT même de parler à l'IdP ───

test("start: redirige vers l'IdP, avec NOTRE propre PKCE (pas celui de l'app)", async () => {
  const { app } = makeApp();
  const verifier = newVerifier();
  const res = await startMobile(app, { verifier, state: "etat-app" });
  assert.equal(res.statusCode, 302);
  const u = new URL(res.headers.location as string);
  assert.equal(u.origin, new URL(base).origin, "doit pointer sur l'IdP");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    u.searchParams.get("redirect_uri"),
    MOBILE_CALLBACK,
    "le retour de l'IdP doit atterrir chez NOUS, pas sur le SPA",
  );
  // Le PKCE de l'app protège le saut app↔nous ; celui-ci protège le saut nous↔IdP. Les
  // confondre reviendrait à donner à l'app le vérificateur de notre propre échange.
  assert.notEqual(u.searchParams.get("code_challenge"), challengeOf(verifier));
  assert.ok(u.searchParams.get("state"));
  assert.ok(u.searchParams.get("nonce"));
  await app.close();
});

test("start: code_challenge_method absent → refusé", async () => {
  const { app } = makeApp();
  const res = await startMobile(app, { verifier: newVerifier(), state: "s", method: null });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("start: code_challenge_method=plain → refusé", async () => {
  // `plain` est resté dans la RFC pour des plateformes qui ne savaient pas hacher. Accepté ici,
  // il rendrait le dispositif décoratif : le challenge intercepté SERAIT le vérificateur.
  const { app } = makeApp();
  // Challenge bien formé (43 caractères base64url) : ce test doit tomber sur la MÉTHODE, pas sur
  // le format. Avec un challenge en clair il passerait pour la mauvaise raison.
  const res = await startMobile(app, {
    challenge: challengeOf(newVerifier()),
    state: "s",
    method: "plain",
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("start: adresse de retour hors liste blanche → refusée", async () => {
  const { app } = makeApp();
  const res = await startMobile(app, {
    verifier: newVerifier(),
    state: "s",
    redirectUri: "ch.attaquant.app://sso",
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

// ─── Parcours nominal ───

test("parcours complet: start → callback → exchange rend la session et les blobs", async () => {
  const { app } = makeApp();
  await register(app);
  const verifier = newVerifier();
  const back = await loginToRedirect(app, {
    email: USER.email,
    verifier,
    appState: "etat-opaque-de-l-app",
  });
  assert.equal(`${back.protocol}//${back.host}${back.pathname}`, APP_REDIRECT);
  // L'état rendu vient de l'enregistrement du `start`, jamais du corps de l'échange.
  assert.equal(back.searchParams.get("state"), "etat-opaque-de-l-app");
  const code = back.searchParams.get("code") as string;
  assert.ok(code);

  const res = await exchange(app, code, verifier);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  // Exactement la forme du callback web : le client n'a qu'un seul chemin de session à écrire.
  assert.deepEqual(Object.keys(body).sort(), [
    "email",
    "encryptedPrivateKey",
    "encryptedUserKey",
    "kdfParams",
    "token",
  ]);
  assert.equal(body.email, USER.email);
  assert.equal(body.kdfParams, USER.kdfParams);
  assert.equal(body.encryptedUserKey, USER.encryptedUserKey);
  assert.equal(body.encryptedPrivateKey, USER.encryptedPrivateKey);

  const items = await app.inject({
    method: "GET",
    url: "/api/vault/items",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(items.statusCode, 200, "le jeton doit ouvrir une route authentifiée");
  await app.close();
});

// ─── Usage unique du code ───

test("exchange: rejeu du même code → refusé", async () => {
  const { app } = makeApp();
  await register(app);
  const verifier = newVerifier();
  const code = await loginToCode(app, verifier);
  assert.equal((await exchange(app, code, verifier)).statusCode, 200);
  const rejeu = await exchange(app, code, verifier);
  assert.notEqual(rejeu.statusCode, 200, "un code rejouable annule tout le dispositif");
  assert.equal(rejeu.statusCode, 400);
  await app.close();
});

test("exchange: code consommé par un échange ÉCHOUÉ pour une autre raison → refusé ensuite", async () => {
  // Le cas qu'on oublie : le code doit disparaître à la première présentation, y compris quand
  // l'échange échoue APRÈS pour une raison qui n'a rien à voir. Sinon un vérificateur deviné
  // hors ligne se rejoue tant que le code vit.
  const { app } = makeApp();
  await register(app);
  const verifier = newVerifier();
  const code = await loginToCode(app, verifier);
  const rate = await exchange(app, code, newVerifier()); // mauvais vérificateur
  assert.equal(rate.statusCode, 400);
  const secondEssai = await exchange(app, code, verifier); // le BON, cette fois
  assert.notEqual(secondEssai.statusCode, 200, "le code devait être consommé par l'échec");
  assert.equal(secondEssai.statusCode, 400);
  await app.close();
});

// ─── Liaison challenge ↔ vérificateur ───

test("exchange: vérificateur qui ne correspond pas au challenge → refusé", async () => {
  const { app } = makeApp();
  await register(app);
  const code = await loginToCode(app, newVerifier());
  const res = await exchange(app, code, newVerifier());
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("exchange: vérificateur valide mais issu d'un AUTRE start → refusé", async () => {
  // Un code comparé au mauvais challenge rend le PKCE décoratif : n'importe quel couple
  // cohérent ouvrirait n'importe quel code.
  const { app } = makeApp();
  await register(app);
  const verifierA = newVerifier();
  const verifierB = newVerifier();
  const codeA = await loginToCode(app, verifierA, "etat-a");
  await loginToCode(app, verifierB, "etat-b");
  const res = await exchange(app, codeA, verifierB);
  assert.equal(res.statusCode, 400);
  // …et un couple cohérent, lui, passe : l'échec ci-dessus tient à la liaison, pas au hasard.
  // Il faut un `start` NEUF pour le montrer — le refus précédent a brûlé `codeA`, ce qui est
  // exactement la règle (a) : consommé à la première présentation, même quand elle échoue.
  const verifierC = newVerifier();
  const codeC = await loginToCode(app, verifierC, "etat-c");
  assert.equal((await exchange(app, codeC, verifierC)).statusCode, 200);
  await app.close();
});

// ─── Expiration ───

test("exchange: code expiré → refusé, et sa durée de vie est courte", async () => {
  const { app, db } = makeApp();
  await register(app);
  const verifier = newVerifier();
  const code = await loginToCode(app, verifier);

  const lignes = await db.selectFrom("auth_ephemeral").select(["expires_at"]).execute();
  const plusLoin = Math.max(...lignes.map((l) => Number(l.expires_at)));
  assert.ok(
    plusLoin - Date.now() <= 5 * 60_000,
    `le code doit être de courte durée, expire dans ${Math.round((plusLoin - Date.now()) / 1000)}s`,
  );

  await db
    .updateTable("auth_ephemeral")
    .set({ expires_at: Date.now() - 1000 })
    .execute();
  const res = await exchange(app, code, verifier);
  assert.equal(res.statusCode, 400);
  await app.close();
});

// ─── Règles héritées du chemin web, à ne pas perdre en route ───

test("callback: email non vérifié → aucun code rendu à l'application", async () => {
  const { app } = makeApp();
  await register(app);
  const back = await loginToRedirect(app, {
    email: USER.email,
    verifier: newVerifier(),
    appState: "s",
    emailVerified: false,
  });
  assert.equal(back.searchParams.get("code"), null, "aucun code ne doit sortir");
  assert.ok(back.searchParams.get("error"), "l'app doit pouvoir afficher un échec");
  await app.close();
});

test("callback: utilisateur inconnu → refusé, et AUCUN compte créé", async () => {
  // Structurel, pas prudentiel : le coffre est scellé sous le mot de passe maître. Un compte
  // créé par SSO n'aurait rien à ouvrir — l'utilisateur verrait un coffre vide et croirait
  // avoir perdu ses données.
  const { app, db } = makeApp();
  const back = await loginToRedirect(app, {
    email: "inconnu@stackops.ch",
    verifier: newVerifier(),
    appState: "s",
  });
  assert.equal(back.searchParams.get("code"), null);
  assert.ok(back.searchParams.get("error"));
  const compte = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", "inconnu@stackops.ch")
    .executeTakeFirst();
  assert.equal(compte, undefined, "aucun provisionnement à la volée");
  await app.close();
});

test("exchange: code inconnu → refusé", async () => {
  const { app } = makeApp();
  const res = await exchange(app, "code-inexistant", newVerifier());
  assert.equal(res.statusCode, 400);
  await app.close();
});
