import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const CLIENT_ID = "ghostpass-test";
const USER = {
  email: "sso-user@stackops.ch",
  masterPasswordHash: "client-auth-hash-AAA",
  kdfParams: JSON.stringify({ mem_cost_kib: 65536, time_cost: 3, parallelism: 4 }),
  encryptedUserKey: "2.bm9uY2U.Y2lwaGVy",
  encryptedPrivateKey: "2.bm9uY2Uy.Y2lwaGVyMg",
  publicKey: "cHVibGlja2V5LWJhc2U2NA",
};

let server: http.Server;
let base = "";
let privateKey: KeyLike;
let currentIdToken = ""; // ce que /token renvoie (le test le règle après avoir lu le nonce)

// IdP OIDC mocké en process : découverte + JWKS (vraie clé) + /token. La vérification de
// signature/issuer/audience/nonce est donc exercée pour de vrai.
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
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeApp() {
  return buildApp(openDatabase(":memory:"));
}

async function idTokenFor(opts: { email: string; nonce: string; emailVerified?: boolean; aud?: string }) {
  return new SignJWT({ email: opts.email, email_verified: opts.emailVerified ?? true, nonce: opts.nonce })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(base)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setSubject("subject-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

/// Démarre un flux SSO et renvoie le `state` + `nonce` extraits de l'URL d'autorisation.
async function startLogin(app: ReturnType<typeof makeApp>) {
  const res = await app.inject({ method: "GET", url: "/api/auth/sso/login" });
  assert.equal(res.statusCode, 200);
  const u = new URL(res.json().url);
  return { state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")! };
}

test("status: SSO actif quand OIDC_ISSUER est défini", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: "/api/auth/sso/status" });
  assert.deepEqual(res.json(), { enabled: true });
  await app.close();
});

test("login: URL d'autorisation bien formée (PKCE S256 + state + nonce)", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: "/api/auth/sso/login" });
  const u = new URL(res.json().url);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("state"));
  assert.ok(u.searchParams.get("nonce"));
  assert.ok(u.searchParams.get("code_challenge"));
  await app.close();
});

test("callback: id_token valide pour un compte existant → session + blobs", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: USER });
  const { state, nonce } = await startLogin(app);
  currentIdToken = await idTokenFor({ email: USER.email, nonce });

  const res = await app.inject({ method: "GET", url: `/api/auth/sso/callback?code=xyz&state=${state}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.token, "token attendu");
  assert.equal(body.kdfParams, USER.kdfParams);
  assert.equal(body.encryptedUserKey, USER.encryptedUserKey);
  assert.equal(body.encryptedPrivateKey, USER.encryptedPrivateKey);

  // Le token ouvre bien une route authentifiée.
  const items = await app.inject({
    method: "GET",
    url: "/api/vault/items",
    headers: { authorization: `Bearer ${body.token}` },
  });
  assert.equal(items.statusCode, 200);
  await app.close();
});

test("callback: email inconnu → 403 (pas de provisioning JIT)", async () => {
  const app = makeApp();
  const { state, nonce } = await startLogin(app);
  currentIdToken = await idTokenFor({ email: "inconnu@stackops.ch", nonce });
  const res = await app.inject({ method: "GET", url: `/api/auth/sso/callback?code=xyz&state=${state}` });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test("callback: state inconnu → 400", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "GET", url: "/api/auth/sso/callback?code=xyz&state=bidon" });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("callback: nonce falsifié → 401", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: USER });
  const { state } = await startLogin(app);
  currentIdToken = await idTokenFor({ email: USER.email, nonce: "mauvais-nonce" });
  const res = await app.inject({ method: "GET", url: `/api/auth/sso/callback?code=xyz&state=${state}` });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("callback: email non vérifié → 401", async () => {
  const app = makeApp();
  await app.inject({ method: "POST", url: "/api/auth/register", payload: USER });
  const { state, nonce } = await startLogin(app);
  currentIdToken = await idTokenFor({ email: USER.email, nonce, emailVerified: false });
  const res = await app.inject({ method: "GET", url: `/api/auth/sso/callback?code=xyz&state=${state}` });
  assert.equal(res.statusCode, 401);
  await app.close();
});
