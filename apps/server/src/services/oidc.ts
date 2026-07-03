// SSO OIDC (Relying Party). Le serveur authentifie l'IDENTITÉ via un fournisseur OIDC ; le mot
// de passe maître reste requis CÔTÉ CLIENT pour déchiffrer le coffre (zero-knowledge intact — le
// serveur ne voit jamais le mot de passe maître). Aucun provisioning JIT : le SSO relie à un
// compte EXISTANT via l'email vérifié.
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { DB } from "../db/database.js";
import { ephemeral } from "../db/repositories.js";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/// Config lue dynamiquement (testable). SSO actif ⇔ `OIDC_ISSUER` défini.
export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim();
  if (!issuer) return null;
  return {
    issuer: issuer.replace(/\/+$/, ""),
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    redirectUri: process.env.OIDC_REDIRECT_URI ?? "",
  };
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, Discovery>();

/// Découverte OIDC (`/.well-known/openid-configuration`), mise en cache par issuer.
export async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error("découverte OIDC échouée");
  const d = (await res.json()) as Discovery;
  discoveryCache.set(issuer, d);
  return d;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, set);
  }
  return set;
}

// ─── État éphémère par tentative (state → nonce + PKCE verifier), dans le store partagé (DB) ───
const STATE_TTL_MS = 600_000; // 10 min

export function putState(
  db: DB,
  state: string,
  s: { nonce: string; codeVerifier: string },
): Promise<void> {
  return ephemeral.put(db, `sso:${state}`, JSON.stringify(s), STATE_TTL_MS);
}

/// Récupère ET consomme l'état (usage unique). Null si absent ou expiré.
export async function takeState(
  db: DB,
  state: string,
): Promise<{ nonce: string; codeVerifier: string } | null> {
  const v = await ephemeral.take(db, `sso:${state}`);
  return v ? (JSON.parse(v) as { nonce: string; codeVerifier: string }) : null;
}

const b64url = (b: Buffer): string => b.toString("base64url");

/// Jeton opaque aléatoire (state / nonce / PKCE code_verifier).
export function randomToken(): string {
  return b64url(randomBytes(32));
}

/// PKCE S256 : challenge = base64url(sha256(verifier)).
export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function buildAuthUrl(
  d: Discovery,
  cfg: OidcConfig,
  p: { state: string; nonce: string; codeChallenge: string },
): string {
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", "openid email");
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/// Échange le code contre les tokens (Authorization Code + PKCE), renvoie l'id_token brut.
export async function exchangeCode(
  d: Discovery,
  cfg: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("échange de code échoué");
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("id_token absent");
  return json.id_token;
}

/// Vérifie l'id_token (signature JWKS, issuer, audience, nonce) et renvoie l'email + son statut.
export async function verifyIdToken(
  d: Discovery,
  cfg: OidcConfig,
  idToken: string,
  expectedNonce: string,
): Promise<{ email: string; emailVerified: boolean }> {
  const { payload } = await jwtVerify(idToken, jwksFor(d.jwks_uri), {
    issuer: cfg.issuer,
    audience: cfg.clientId,
  });
  if (payload.nonce !== expectedNonce) throw new Error("nonce invalide");
  return {
    email: typeof payload.email === "string" ? payload.email : "",
    emailVerified: payload.email_verified === true,
  };
}
