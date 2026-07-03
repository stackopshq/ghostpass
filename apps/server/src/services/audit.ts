import type { FastifyRequest } from "fastify";
import type { DB } from "../db/database.js";
import { audit } from "../db/repositories.js";
import { newId } from "./security.js";

/// Actions auditées (stables, en anglais). Métadonnées seulement — jamais de secret.
export type AuditAction =
  | "login.password"
  | "login.sso"
  | "login.passkey"
  | "logout"
  | "passkey.add"
  | "passkey.remove"
  | "webauthn.add"
  | "webauthn.remove"
  | "mfa.enable"
  | "mfa.disable"
  | "recovery.reset"
  | "org.member.add"
  | "org.member.remove"
  | "org.member.role"
  | "org.group.create"
  | "org.group.delete"
  | "org.group.member.add"
  | "org.group.member.remove"
  | "org.group.access.grant"
  | "org.group.access.revoke"
  | "org.key.rotate"
  | "emergency.grant"
  | "emergency.request"
  | "emergency.approve";

/// Enregistre un événement d'audit. Best-effort : une erreur d'audit ne casse jamais l'action métier.
export async function recordAudit(
  db: DB,
  req: FastifyRequest,
  action: AuditAction,
  e: { userId: string | null; actorEmail: string | null; target?: string | null },
): Promise<void> {
  try {
    await audit.record(db, {
      id: newId(),
      userId: e.userId,
      actorEmail: e.actorEmail,
      action,
      target: e.target ?? null,
      ip: req.ip,
    });
  } catch {
    /* silencieux : l'audit ne doit jamais interrompre la requête */
  }
}
