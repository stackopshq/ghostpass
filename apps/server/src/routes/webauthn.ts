import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { DB } from "../db/database.js";
import { webauthnCredentials } from "../db/repositories.js";
import { makeAuthenticate } from "../plugins/auth.js";
import { ORIGIN, RP_ID, RP_NAME, putChallenge, takeChallenge } from "../services/webauthn.js";

const toB64Url = (u: Uint8Array): string => Buffer.from(u).toString("base64url");

function parseTransports(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const t = JSON.parse(json);
    return Array.isArray(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

// Enregistrement et gestion des clés de sécurité WebAuthn/FIDO2 (2e facteur). Le serveur ne
// stocke que la clé publique ; aucune donnée du coffre n'est en jeu (le master password reste requis).
export function registerWebAuthnRoutes(app: FastifyInstance, db: DB): void {
  const authenticate = makeAuthenticate(db);

  app.post(
    "/api/mfa/webauthn/register/options",
    { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const user = req.currentUser!;
      const existing = await webauthnCredentials.listByUser(db, user.id);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({
          id: c.id,
          transports: parseTransports(c.transports) as never,
        })),
        authenticatorSelection: { residentKey: "discouraged", userVerification: "preferred" },
      });
      putChallenge(`reg:${user.id}`, options.challenge);
      return options;
    },
  );

  const verifySchema = z.object({ response: z.any(), name: z.string().min(1).max(64).optional() });
  app.post(
    "/api/mfa/webauthn/register/verify",
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "requête invalide" });
      const user = req.currentUser!;
      const expectedChallenge = takeChallenge(`reg:${user.id}`);
      if (!expectedChallenge) return reply.code(400).send({ error: "challenge expiré" });

      try {
        const verification = await verifyRegistrationResponse({
          response: parsed.data.response,
          expectedChallenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: false,
        });
        if (!verification.verified || !verification.registrationInfo) {
          return reply.code(400).send({ error: "vérification échouée" });
        }
        const cred = verification.registrationInfo.credential;
        await webauthnCredentials.create(db, {
          id: cred.id,
          userId: user.id,
          publicKey: toB64Url(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports ? JSON.stringify(cred.transports) : null,
          name: parsed.data.name?.trim() || "Clé de sécurité",
        });
        return reply.code(201).send({ ok: true });
      } catch {
        return reply.code(400).send({ error: "vérification échouée" });
      }
    },
  );

  app.get("/api/mfa/webauthn/credentials", { preHandler: authenticate }, async (req) => {
    const creds = await webauthnCredentials.listByUser(db, req.currentUser!.id);
    return { credentials: creds.map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at })) };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/mfa/webauthn/credentials/:id",
    { preHandler: authenticate },
    async (req, reply) => {
      const ok = await webauthnCredentials.remove(db, { id: req.params.id, userId: req.currentUser!.id });
      if (!ok) return reply.code(404).send({ error: "clé introuvable" });
      return reply.code(204).send();
    },
  );
}
