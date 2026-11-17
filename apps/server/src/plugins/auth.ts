import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { DB } from "../db/database.js";
import type { UserRow } from "../types.js";
import { sessions } from "../db/repositories.js";
import { hashSessionToken } from "../services/security.js";
import { COMPTE_SUSPENDU } from "../services/administration.js";

// L'utilisateur authentifié est attaché à la requête.
declare module "fastify" {
  interface FastifyRequest {
    currentUser: UserRow | null;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/// Fabrique un preHandler qui exige une session valide et renseigne `req.currentUser`.
export function makeAuthenticate(db: DB): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req);
    if (!token) {
      return reply.code(401).send({ error: "non authentifié" });
    }
    const user = await sessions.findValidUser(db, hashSessionToken(token));
    if (!user) {
      return reply.code(401).send({ error: "session invalide ou expirée" });
    }
    // Suspendu par un administrateur de l'instance. Les sessions sont révoquées au moment
    // de la suspension ; ce contrôle couvre celles qui s'ouvriraient malgré tout, par un
    // chemin de connexion qui l'aurait oublié.
    if (user.suspended_at) {
      return reply.code(403).send(COMPTE_SUSPENDU);
    }
    req.currentUser = user;
  };
}
