// E2E du SSO mobile : IdP OIDC mocké + serveur GhostPass, sur des ports RÉELS (pas `inject`).
// Sert de référence exécutable au client iOS — il montre les requêtes et les réponses exactes.
// Lancement : `node --import tsx scripts/e2e-sso-mobile.ts` depuis apps/server.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const pair = await generateKeyPair("RS256");
const jwk = await exportJWK(pair.publicKey);
Object.assign(jwk, { kid: "dev", alg: "RS256", use: "sig" });
let idToken = "";
const idp = http.createServer((req, res) => {
  const u = req.url ?? "";
  res.setHeader("content-type", "application/json");
  if (u.startsWith("/.well-known")) res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` }));
  else if (u.startsWith("/jwks")) res.end(JSON.stringify({ keys: [jwk] }));
  else if (u.startsWith("/token")) res.end(JSON.stringify({ id_token: idToken, token_type: "Bearer" }));
  else { res.statusCode = 404; res.end("{}"); }
});
await new Promise<void>((r) => idp.listen(9101, "127.0.0.1", r));
const base = "http://127.0.0.1:9101";

process.env.OIDC_ISSUER = base;
process.env.OIDC_CLIENT_ID = "ghostpass-dev";
process.env.OIDC_CLIENT_SECRET = "dev";
process.env.OIDC_REDIRECT_URI = "http://127.0.0.1:9100/sso/callback";
process.env.OIDC_MOBILE_REDIRECT_URI = "http://127.0.0.1:9100/api/auth/sso/mobile/callback";
process.env.SSO_MOBILE_REDIRECT_URIS = "ch.stackops.ghostpass://sso";

const db = openDatabase(":memory:");
const app = buildApp(db);
await app.listen({ port: 9100, host: "127.0.0.1" });

// Un compte existant (le SSO relie, il ne provisionne pas).
// nosemgrep: react-insecure-request -- boucle locale : le script demarre lui-meme le serveur sur 127.0.0.1:9100 quelques lignes plus haut. Il n'y a pas de reseau a intercepter, et exiger TLS ici obligerait a fabriquer un certificat pour un banc jetable.
await fetch("http://127.0.0.1:9100/api/auth/register", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "clara@stackops.ch", masterPasswordHash: "hash", kdfParams: "{}", encryptedUserKey: "2.a.b", encryptedPrivateKey: "2.c.d", publicKey: "pk" }),
});

// L'app: vérificateur + challenge, puis /start.
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const start = await fetch(`http://127.0.0.1:9100/api/auth/sso/mobile/start?code_challenge=${challenge}&code_challenge_method=S256&state=etat-ios`, { redirect: "manual" });
console.log("start           →", start.status, new URL(start.headers.get("location")!).origin + "/authorize?…");

// L'IdP renvoie chez nous : on simule son retour.
const authUrl = new URL(start.headers.get("location")!);
idToken = await new SignJWT({ email: "clara@stackops.ch", email_verified: true, nonce: authUrl.searchParams.get("nonce") })
  .setProtectedHeader({ alg: "RS256", kid: "dev" }).setIssuer(base).setAudience("ghostpass-dev")
  .setSubject("s").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
const cb = await fetch(`http://127.0.0.1:9100/api/auth/sso/mobile/callback?code=idp&state=${authUrl.searchParams.get("state")}`, { redirect: "manual" });
const back = new URL(cb.headers.get("location")!);
console.log("callback        →", cb.status, `${back.protocol}//${back.host}?code=…&state=${back.searchParams.get("state")}`);

// nosemgrep: react-insecure-request -- boucle locale : le script demarre lui-meme le serveur sur 127.0.0.1:9100 quelques lignes plus haut. Il n'y a pas de reseau a intercepter, et exiger TLS ici obligerait a fabriquer un certificat pour un banc jetable.
const ex = await fetch("http://127.0.0.1:9100/api/auth/sso/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: back.searchParams.get("code"), codeVerifier: verifier }) });
const body = await ex.json() as Record<string, string>;
console.log("exchange        →", ex.status, JSON.stringify({ ...body, token: `${body.token?.slice(0, 6)}…` }));

// nosemgrep: react-insecure-request -- boucle locale : le script demarre lui-meme le serveur sur 127.0.0.1:9100 quelques lignes plus haut. Il n'y a pas de reseau a intercepter, et exiger TLS ici obligerait a fabriquer un certificat pour un banc jetable.
const rejeu = await fetch("http://127.0.0.1:9100/api/auth/sso/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: back.searchParams.get("code"), codeVerifier: verifier }) });
console.log("rejeu du code   →", rejeu.status, await rejeu.text());
// nosemgrep: react-insecure-request -- boucle locale : le script demarre lui-meme le serveur sur 127.0.0.1:9100 quelques lignes plus haut. Il n'y a pas de reseau a intercepter, et exiger TLS ici obligerait a fabriquer un certificat pour un banc jetable.
const items = await fetch("http://127.0.0.1:9100/api/vault/items", { headers: { authorization: `Bearer ${body.token}` } });
console.log("jeton sur /items→", items.status);
await app.close(); idp.close();
