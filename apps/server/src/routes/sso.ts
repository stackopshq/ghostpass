import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { loginEvents, sessions, users } from "../db/repositories.js";
import { recordAudit } from "../services/audit.js";
import { createSessionToken, newId, normalizeEmail } from "../services/security.js";
import {
  buildAppReturn,
  buildAuthUrl,
  discover,
  exchangeCode,
  getMobileConfig,
  getOidcConfig,
  pickAppRedirect,
  pkceChallenge,
  pkceVerifies,
  putMobileCode,
  putMobileState,
  putState,
  randomToken,
  takeMobileCode,
  takeMobileState,
  takeState,
  verifyIdToken,
} from "../services/oidc.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours
const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

// Le challenge S256 est un sha256 en base64url : 43 caractères, toujours. Refuser tout le reste
// au `start` fait échouer tôt et bruyamment un client mal encodé, plutôt que par une
// non-correspondance opaque à l'échange.
const mobileStartSchema = z.object({
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  // `S256` uniquement. `plain` est resté dans la RFC 7636 pour des plateformes incapables de
  // hacher ; accepté ici, il rendrait le dispositif décoratif — le challenge intercepté SERAIT
  // le vérificateur. Un `code_challenge_method` absent ou autre est refusé ICI, pas à l'échange.
  code_challenge_method: z.literal("S256"),
  state: z.string().min(1).max(512),
  redirect_uri: z.string().min(1).max(512).optional(),
});

// Vérificateur PKCE : caractères non réservés, 43 à 128 (RFC 7636 §4.1).
const mobileExchangeSchema = z.object({
  code: z.string().min(1).max(256),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

// SSO OIDC — « master password conservé » : le SSO ouvre une session après vérification de
// l'identité, puis renvoie les blobs chiffrés ; le client déverrouille avec le mot de passe maître.
export function registerSsoRoutes(app: FastifyInstance, db: DB): void {
  app.get("/api/auth/sso/status", async () => ({ enabled: getOidcConfig() !== null }));

  // Démarre le flux : Authorization Code + PKCE. Renvoie l'URL d'autorisation (le SPA redirige).
  app.get(
    "/api/auth/sso/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      const cfg = getOidcConfig();
      if (!cfg) return reply.code(404).send({ error: "SSO désactivé" });
      try {
        const d = await discover(cfg.issuer);
        const state = randomToken();
        const nonce = randomToken();
        const codeVerifier = randomToken();
        await putState(db, state, { nonce, codeVerifier });
        const url = buildAuthUrl(d, cfg, {
          state,
          nonce,
          codeChallenge: pkceChallenge(codeVerifier),
        });
        return reply.send({ url });
      } catch {
        return reply.code(502).send({ error: "fournisseur SSO indisponible" });
      }
    },
  );

  // Callback : échange le code, vérifie l'id_token, relie à un compte existant, ouvre une session.
  app.get(
    "/api/auth/sso/callback",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const cfg = getOidcConfig();
      if (!cfg) return reply.code(404).send({ error: "SSO désactivé" });
      const parsed = callbackSchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const st = await takeState(db, parsed.data.state);
      if (!st) return reply.code(400).send({ error: "état SSO invalide ou expiré" });

      let email = "";
      let emailVerified = false;
      try {
        const d = await discover(cfg.issuer);
        const idToken = await exchangeCode(d, cfg, parsed.data.code, st.codeVerifier);
        const claims = await verifyIdToken(d, cfg, idToken, st.nonce);
        email = claims.email;
        emailVerified = claims.emailVerified;
      } catch {
        return reply.code(401).send({ error: "authentification SSO échouée" });
      }
      // Exige un email vérifié par l'IdP (sinon usurpation possible via un compte non prouvé).
      if (!email || !emailVerified) {
        return reply.code(401).send({ error: "authentification SSO échouée" });
      }

      const user = await users.findByEmail(db, normalizeEmail(email));
      // Pas de provisioning JIT : le coffre est chiffré sous le mot de passe maître de l'utilisateur.
      if (!user) return reply.code(403).send({ error: "SSO: compte non provisionné" });

      const ua = String(req.headers["user-agent"] ?? "inconnu").slice(0, 300);
      await loginEvents.record(db, { id: newId(), userId: user.id, ip: req.ip, userAgent: ua });
      const { token, tokenHash } = createSessionToken();
      await sessions.create(db, { id: newId(), userId: user.id, tokenHash, ttlMs: SESSION_TTL_MS });
      await recordAudit(db, req, "login.sso", { userId: user.id, actorEmail: user.email });
      return reply.send({
        token,
        email: user.email,
        kdfParams: user.kdf_params,
        encryptedUserKey: user.encrypted_user_key,
        encryptedPrivateKey: user.encrypted_private_key,
      });
    },
  );

  // ─── SSO mobile ───────────────────────────────────────────────────────────
  //
  // Trois routes, ajoutées À CÔTÉ du chemin web, qui n'est pas modifié.
  //
  //   1. l'app ouvre une session web sur  GET /api/auth/sso/mobile/start
  //   2. nous menons l'échange OIDC habituel avec l'IdP (client confidentiel)
  //   3. au retour, nous redirigeons vers  ch.stackops.ghostpass://sso?code=…&state=…
  //   4. l'app POSTe { code, codeVerifier } sur  POST /api/auth/sso/exchange
  //   5. nous vérifions le couple challenge/vérificateur enregistré, puis rendons la session
  //
  // Le code de l'étape 3 ne vaut RIEN sans le vérificateur que seule l'app détient : une
  // application voisine qui revendiquerait le schéma d'URL n'obtient qu'une chaîne inerte.

  app.get(
    "/api/auth/sso/mobile/start",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const cfg = getOidcConfig();
      const mob = getMobileConfig();
      if (!cfg || !mob) return reply.code(404).send({ error: "SSO mobile désactivé" });
      const parsed = mobileStartSchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });

      // L'adresse de retour est choisie par NOUS dans une liste blanche, jamais par le client.
      const appRedirect = pickAppRedirect(mob, parsed.data.redirect_uri);
      if (!appRedirect) return reply.code(400).send({ error: "adresse de retour non autorisée" });

      try {
        const d = await discover(cfg.issuer);
        const state = randomToken();
        const nonce = randomToken();
        const codeVerifier = randomToken();
        await putMobileState(db, state, {
          nonce,
          codeVerifier,
          appChallenge: parsed.data.code_challenge,
          appState: parsed.data.state,
          appRedirect,
        });
        // Notre PKCE (`codeVerifier`) couvre le saut nous ↔ IdP ; celui de l'app couvre le saut
        // app ↔ nous. Les deux sont indépendants : réutiliser le challenge de l'app ici
        // reviendrait à lui confier le vérificateur de notre propre échange.
        const url = buildAuthUrl(
          d,
          { ...cfg, redirectUri: mob.redirectUri },
          { state, nonce, codeChallenge: pkceChallenge(codeVerifier) },
        );
        return reply.header("cache-control", "no-store").redirect(url, 302);
      } catch {
        return reply.code(502).send({ error: "fournisseur SSO indisponible" });
      }
    },
  );

  // Retour de l'IdP. Répond TOUJOURS par une redirection vers l'application dès que l'état du
  // `start` a été retrouvé : la session web de l'app ne se referme que sur son schéma d'URL, et
  // une page d'erreur JSON y laisserait l'utilisateur bloqué. Aucune de ces redirections d'échec
  // ne porte de code.
  app.get(
    "/api/auth/sso/mobile/callback",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const cfg = getOidcConfig();
      const mob = getMobileConfig();
      if (!cfg || !mob) return reply.code(404).send({ error: "SSO mobile désactivé" });
      const parsed = callbackSchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const st = await takeMobileState(db, parsed.data.state);
      if (!st) return reply.code(400).send({ error: "état SSO invalide ou expiré" });

      const retour = (params: Record<string, string>) =>
        reply
          .header("cache-control", "no-store")
          .redirect(buildAppReturn(st.appRedirect, { ...params, state: st.appState }), 302);

      let email = "";
      let emailVerified = false;
      try {
        const d = await discover(cfg.issuer);
        const idToken = await exchangeCode(
          d,
          { ...cfg, redirectUri: mob.redirectUri },
          parsed.data.code,
          st.codeVerifier,
        );
        const claims = await verifyIdToken(d, cfg, idToken, st.nonce);
        email = claims.email;
        emailVerified = claims.emailVerified;
      } catch {
        return retour({ error: "sso_failed" });
      }
      // Même exigence que le chemin web : une adresse non prouvée ouvrirait l'usurpation.
      if (!email || !emailVerified) return retour({ error: "sso_failed" });

      const user = await users.findByEmail(db, normalizeEmail(email));
      // Pas de provisioning JIT. Structurel, pas prudentiel : le coffre est scellé sous le mot de
      // passe maître, donc un compte créé par SSO n'aurait rien à ouvrir — l'utilisateur verrait
      // un coffre vide et croirait avoir perdu ses données.
      if (!user) return retour({ error: "not_provisioned" });

      // Code à usage unique, lié au challenge de CE `start`. Aucune session n'est encore ouverte :
      // un code jamais échangé ne laisse rien derrière lui.
      const code = randomToken();
      await putMobileCode(db, code, { userId: user.id, appChallenge: st.appChallenge });
      return retour({ code });
    },
  );

  // Échange final : { code, codeVerifier } → session. Même forme de réponse que le callback web,
  // pour que le client n'ait qu'un seul chemin de session à écrire.
  app.post(
    "/api/auth/sso/exchange",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!getOidcConfig() || !getMobileConfig()) {
        return reply.code(404).send({ error: "SSO mobile désactivé" });
      }
      const parsed = mobileExchangeSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });

      // Consommé AVANT toute vérification, et atomiquement : le code disparaît à la première
      // présentation, y compris quand l'échange échoue ensuite pour une autre raison. Sinon un
      // vérificateur deviné hors ligne se rejouerait tant que le code vit.
      const rec = await takeMobileCode(db, parsed.data.code);
      if (!rec) return reply.code(400).send({ error: "code invalide ou expiré" });

      // Comparaison à temps constant, contre le challenge de SON PROPRE `start` : un code comparé
      // au challenge d'un autre rendrait le PKCE décoratif.
      if (!pkceVerifies(parsed.data.codeVerifier, rec.appChallenge)) {
        return reply.code(400).send({ error: "code invalide ou expiré" });
      }

      const user = await users.findById(db, rec.userId);
      if (!user) return reply.code(403).send({ error: "SSO: compte non provisionné" });

      const ua = String(req.headers["user-agent"] ?? "inconnu").slice(0, 300);
      await loginEvents.record(db, { id: newId(), userId: user.id, ip: req.ip, userAgent: ua });
      const { token, tokenHash } = createSessionToken();
      await sessions.create(db, { id: newId(), userId: user.id, tokenHash, ttlMs: SESSION_TTL_MS });
      await recordAudit(db, req, "login.sso", {
        userId: user.id,
        actorEmail: user.email,
        target: "mobile",
      });
      return reply.header("cache-control", "no-store").send({
        token,
        email: user.email,
        kdfParams: user.kdf_params,
        encryptedUserKey: user.encrypted_user_key,
        encryptedPrivateKey: user.encrypted_private_key,
      });
    },
  );
}
