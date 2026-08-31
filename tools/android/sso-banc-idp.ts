// Un banc d'essai pour le SSO mobile : un fournisseur d'identité OIDC simulé, et le vrai
// serveur GhostPass, sur des ports réels.
//
// Adapté d'`apps/server/scripts/e2e-sso-mobile.ts` (branche `main` du serveur), qui rejoue
// le parcours **entier** côté serveur. Ici on s'arrête volontairement avant l'échange : ce
// banc mène le flux jusqu'au retour dans le schéma de l'application, imprime l'URL de
// retour, puis **attend**. C'est le client Android qui fait le reste — vérifier l'état,
// lire le code, échanger contre une session. Sans cette coupure, on éprouverait le serveur
// une seconde fois et le client pas du tout.
//
//   node --import tsx sso-banc-idp.ts --challenge <défi> --state <état>
//
// Il imprime deux lignes puis attend sur l'entrée standard :
//   SERVEUR http://127.0.0.1:<port>
//   RETOUR  ch.stackops.ghostpass://sso?code=…&state=…
//
// Fermer son entrée standard l'arrête. Le serveur doit rester vivant pendant l'échange,
// sans quoi le client recevrait un refus de connexion et on lirait une panne de réseau là
// où il n'y a qu'un banc déjà rangé.
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

function argument(nom: string): string {
  const i = process.argv.indexOf(`--${nom}`);
  if (i < 0 || !process.argv[i + 1]) {
    console.error(`argument --${nom} manquant`);
    process.exit(2);
  }
  return process.argv[i + 1];
}

const defi = argument("challenge");
const etat = argument("state");
const email = process.env.EMAIL_DESSAI ?? "clara@ghostpass.test";

// ─── Le fournisseur d'identité simulé ───
const pair = await generateKeyPair("RS256");
const jwk = await exportJWK(pair.publicKey);
Object.assign(jwk, { kid: "dev", alg: "RS256", use: "sig" });
let idToken = "";
const idp = http.createServer((req, res) => {
  const u = req.url ?? "";
  res.setHeader("content-type", "application/json");
  if (u.startsWith("/.well-known")) {
    res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
    }));
  } else if (u.startsWith("/jwks")) res.end(JSON.stringify({ keys: [jwk] }));
  else if (u.startsWith("/token")) res.end(JSON.stringify({ id_token: idToken, token_type: "Bearer" }));
  else { res.statusCode = 404; res.end("{}"); }
});
await new Promise<void>((r) => idp.listen(0, "127.0.0.1", r));
const portIdp = (idp.address() as { port: number }).port;
const base = `http://127.0.0.1:${portIdp}`;

// ─── Le vrai serveur GhostPass ───
process.env.OIDC_ISSUER = base;
process.env.OIDC_CLIENT_ID = "ghostpass-dev";
process.env.OIDC_CLIENT_SECRET = "dev";
const db = openDatabase(":memory:");
const app = buildApp(db);
await app.listen({ port: 0, host: "0.0.0.0" });
const portServeur = (app.server.address() as { port: number }).port;
const serveur = `http://127.0.0.1:${portServeur}`;
process.env.OIDC_REDIRECT_URI = `${serveur}/sso/callback`;
process.env.OIDC_MOBILE_REDIRECT_URI = `${serveur}/api/auth/sso/mobile/callback`;
process.env.SSO_MOBILE_REDIRECT_URIS = "ch.stackops.ghostpass://sso";

// Un compte existant : **le SSO relie, il ne provisionne pas**. Sans ce compte, le retour
// porterait `error=not_provisioned` et pas de code — ce qui est un autre cas d'essai, utile
// lui aussi, et que le témoin déclenche en changeant EMAIL_DESSAI.
await fetch(`${serveur}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email, masterPasswordHash: "hash", kdfParams: "{}",
    encryptedUserKey: "2.a.b", encryptedPrivateKey: "2.c.d", publicKey: "pk",
  }),
});

// ─── Le flux, jusqu'au retour dans le schéma de l'application ───
//
// Le défi et l'état viennent du **client Android** : c'est ce qui fait que le code émis ici
// n'est échangeable que par lui.
const start = await fetch(
  `${serveur}/api/auth/sso/mobile/start?code_challenge=${encodeURIComponent(defi)}` +
  `&code_challenge_method=S256&state=${encodeURIComponent(etat)}` +
  `&redirect_uri=${encodeURIComponent("ch.stackops.ghostpass://sso")}`,
  { redirect: "manual" },
);
if (start.status !== 302) {
  console.error(`start a répondu ${start.status} : ${await start.text()}`);
  process.exit(1);
}
const authUrl = new URL(start.headers.get("location")!);

idToken = await new SignJWT({
  email, email_verified: true, nonce: authUrl.searchParams.get("nonce"),
})
  .setProtectedHeader({ alg: "RS256", kid: "dev" })
  .setIssuer(base).setAudience("ghostpass-dev").setSubject("s")
  .setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);

const cb = await fetch(
  `${serveur}/api/auth/sso/mobile/callback?code=idp&state=${authUrl.searchParams.get("state")}`,
  { redirect: "manual" },
);
const retour = cb.headers.get("location");
if (!retour) {
  console.error(`callback n'a pas redirigé : ${cb.status} ${await cb.text()}`);
  process.exit(1);
}

console.log(`SERVEUR ${serveur}`);
console.log(`RETOUR ${retour}`);

// On attend : le serveur doit vivre pendant que le client échange.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
