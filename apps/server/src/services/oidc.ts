// SSO OIDC (Relying Party). Le serveur authentifie l'IDENTITÉ via un fournisseur OIDC ; le mot
// de passe maître reste requis CÔTÉ CLIENT pour déchiffrer le coffre (zero-knowledge intact — le
// serveur ne voit jamais le mot de passe maître). Aucun provisioning JIT : le SSO relie à un
// compte EXISTANT via l'email vérifié.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { DB } from "../db/database.js";
import { ephemeral } from "../db/repositories.js";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /// Voir `getOidcConfig` : déplace la preuve de l'adresse du claim vers l'émetteur.
  trustIssuerEmail: boolean;
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
    trustIssuerEmail: (process.env.OIDC_TRUST_ISSUER_EMAIL ?? "").toLowerCase() === "true",
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
  // `email_verified` absent ≠ adresse non prouvée : certains émetteurs n'émettent
  // AUCUN claim applicatif. Cloudflare Access est de ceux-là — son document de
  // découverte ne déclare pas un seul `claims_supported` (mesuré le 2026-08-27).
  //
  // Sans échappatoire, brancher un tel émetteur ne produit pas un refus lisible :
  // il produit un SSO dont AUCUNE connexion n'aboutit, pour personne, avec un
  // échec indiscernable d'un SSO volontairement éteint.
  //
  // Le drapeau déplace donc la preuve du claim vers l'ÉMETTEUR. Ce qui le rend
  // défendable, c'est que `jwtVerify` ci-dessus a déjà exigé `iss === cfg.issuer`
  // et une signature du JWKS de cet émetteur : la confiance ne s'élargit pas,
  // elle change de porteur. Un `email_verified: false` explicite reste refusé —
  // un émetteur qui prend la peine de nier n'est pas un émetteur qui se tait.
  const nie = payload.email_verified === false;
  const atteste = payload.email_verified === true || (cfg.trustIssuerEmail && !nie);
  return {
    email: typeof payload.email === "string" ? payload.email : "",
    emailVerified: atteste,
  };
}

// ─── SSO mobile : le PKCE se déplace entre l'APPLICATION et NOUS ───────────────
//
// L'IdP est Cloudflare Access for SaaS : son API n'enregistre AUCUN client OIDC public — chaque
// application reçoit un `client_secret`, et `grant_types` vaut `authorization_code` seul (mesuré).
// L'application iPhone ne peut donc pas mener elle-même un flux OIDC.
//
// Or le danger propre au mobile est ailleurs : sur iOS, n'importe quelle application peut
// revendiquer un schéma d'URL personnalisé. Une application malveillante installée sur le
// téléphone peut recevoir le retour destiné à GhostPass ; s'il portait un jeton de session, elle
// aurait le compte.
//
// D'où cette conception : le PKCE couvre le saut app ↔ nous, qui est exactement le saut
// interceptable. Nous restons client confidentiel face à l'IdP, comme sur le chemin web — que ce
// bloc ne touche pas.

/// Adresses de retour par défaut de l'application iPhone. La liste blanche est côté serveur : le
/// corps de l'échange ne choisit jamais où repart le code.
///
/// Deux schémas, parce que l'App Store en impose deux : la build distribuée porte
/// `ch.stackops.ghostpass`, celle de recette (TestFlight, simulateur) porte
/// `ch.stackops.ghostpass.essai`, et un identifiant de paquet ne peut pas être partagé entre
/// deux applications. Refuser le second obligerait à ne jamais éprouver le SSO ailleurs qu'en
/// production, ce qui est exactement l'endroit où l'on ne veut pas le découvrir.
///
/// Le second n'affaiblit pas le premier. Une application voisine qui revendiquerait l'un ou
/// l'autre schéma ne récupère qu'un code inerte : l'échange exige le vérificateur PKCE, que seule
/// l'application qui a ouvert la session détient. Le risque résiduel est le même pour les deux,
/// et il est celui, connu, des schémas d'URL sur iOS.
///
/// L'ORDRE COMPTE : `pickAppRedirect` rend le premier élément quand la requête ne demande rien.
/// Le schéma de production doit donc rester en tête.
const DEFAULT_APP_REDIRECTS = [
  "ch.stackops.ghostpass://sso",
  "ch.stackops.ghostpass.essai://sso",
];

export interface MobileConfig {
  /// Où l'IdP nous renvoie (chez NOUS, pas sur le SPA). Doit être enregistrée côté IdP ; jamais
  /// déduite de l'en-tête `Host`, qui est fourni par le client.
  redirectUri: string;
  /// Adresses de retour vers l'application, en correspondance exacte.
  allowedAppRedirects: string[];
}

/// SSO mobile actif ⇔ SSO actif ET `OIDC_MOBILE_REDIRECT_URI` défini.
export function getMobileConfig(): MobileConfig | null {
  const redirectUri = process.env.OIDC_MOBILE_REDIRECT_URI?.trim();
  if (!redirectUri) return null;
  const raw = process.env.SSO_MOBILE_REDIRECT_URIS?.trim();
  const allowedAppRedirects = (raw ? raw.split(",") : DEFAULT_APP_REDIRECTS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowedAppRedirects.length === 0) return null;
  return { redirectUri, allowedAppRedirects };
}

/// Correspondance EXACTE : un préfixe suffirait à un voisin malveillant
/// (`ch.stackops.ghostpass.evil://`).
export function pickAppRedirect(cfg: MobileConfig, demandee: string | undefined): string | null {
  if (!demandee) return cfg.allowedAppRedirects[0] ?? null;
  return cfg.allowedAppRedirects.includes(demandee) ? demandee : null;
}

/// Construit le retour vers l'application. Encodage à la main plutôt que `URLSearchParams` :
/// celui-ci écrit l'espace ` ` en `+`, que `URLComponents` (iOS) rend tel quel et non comme un
/// espace — l'état de l'app reviendrait alors déformé.
export function buildAppReturn(base: string, params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}${base.includes("?") ? "&" : "?"}${q}`;
}

// Deux durées : le parcours navigateur peut traîner (l'utilisateur s'authentifie), le retour à
// l'application est immédiat. Le code émis vit donc bien moins longtemps que l'état du `start`.
const MOBILE_STATE_TTL_MS = 600_000; // 10 min
const MOBILE_CODE_TTL_MS = 120_000; // 2 min

/// Ce que le `start` enregistre. `appChallenge`, `appState` et `appRedirect` viennent d'ICI au
/// moment de l'échange — jamais du corps envoyé par le client.
export interface MobileStart {
  nonce: string;
  /// PKCE de NOTRE échange avec l'IdP. Sans rapport avec celui de l'application.
  codeVerifier: string;
  appChallenge: string;
  appState: string;
  appRedirect: string;
}

// Préfixe distinct de `sso:` : un état mobile ne peut pas être dépensé sur le callback web, ni
// l'inverse.
const stateKey = (state: string): string => `ssom:${state}`;

export function putMobileState(db: DB, state: string, s: MobileStart): Promise<void> {
  return ephemeral.put(db, stateKey(state), JSON.stringify(s), MOBILE_STATE_TTL_MS);
}

export async function takeMobileState(db: DB, state: string): Promise<MobileStart | null> {
  const v = await ephemeral.takeOnce(db, stateKey(state));
  return v ? (JSON.parse(v) as MobileStart) : null;
}

/// Ce que porte le code à usage unique. Aucun jeton de session : il n'est frappé qu'à l'échange,
/// donc un code jamais consommé n'ouvre aucune session.
export interface MobileCode {
  userId: string;
  appChallenge: string;
}

// Le code est stocké HACHÉ : une lecture de la table `auth_ephemeral` ne rend alors aucun code
// utilisable, comme pour les jetons de session.
const codeKey = (code: string): string =>
  `ssoc:${createHash("sha256").update(code).digest("hex")}`;

export function putMobileCode(db: DB, code: string, c: MobileCode): Promise<void> {
  return ephemeral.put(db, codeKey(code), JSON.stringify(c), MOBILE_CODE_TTL_MS);
}

/// Récupère ET consomme le code, atomiquement. La consommation a lieu à la PREMIÈRE présentation,
/// avant toute vérification : un code présenté avec un mauvais vérificateur est brûlé lui aussi,
/// sinon il se rejouerait tant qu'il vit.
export async function takeMobileCode(db: DB, code: string): Promise<MobileCode | null> {
  const v = await ephemeral.takeOnce(db, codeKey(code));
  return v ? (JSON.parse(v) as MobileCode) : null;
}

/// PKCE S256 vérifié à temps constant. `plain` n'existe pas ici : il est refusé au `start`.
export function pkceVerifies(verifier: string, challenge: string): boolean {
  const attendu = Buffer.from(pkceChallenge(verifier), "utf8");
  const fourni = Buffer.from(challenge, "utf8");
  return attendu.length === fourni.length && timingSafeEqual(attendu, fourni);
}
