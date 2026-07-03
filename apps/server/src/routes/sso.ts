import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/database.js";
import { loginEvents, sessions, users } from "../db/repositories.js";
import { createSessionToken, newId, normalizeEmail } from "../services/security.js";
import {
  buildAuthUrl,
  discover,
  exchangeCode,
  getOidcConfig,
  pkceChallenge,
  putState,
  randomToken,
  takeState,
  verifyIdToken,
} from "../services/oidc.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours
const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

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
      return reply.send({
        token,
        email: user.email,
        kdfParams: user.kdf_params,
        encryptedUserKey: user.encrypted_user_key,
        encryptedPrivateKey: user.encrypted_private_key,
      });
    },
  );
}
