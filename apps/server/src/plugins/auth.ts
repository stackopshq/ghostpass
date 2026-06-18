import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { DB } from "../db/database.js";
import type { UserRow } from "../types.js";
import { sessions } from "../db/repositories.js";
import { hashSessionToken } from "../services/security.js";

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
    const user = sessions.findValidUser(db, hashSessionToken(token));
    if (!user) {
      return reply.code(401).send({ error: "session invalide ou expirée" });
    }
    req.currentUser = user;
  };
}
