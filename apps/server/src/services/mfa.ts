import type { DB } from "../db/database.js";
import type { UserRow } from "../types.js";
import { users } from "../db/repositories.js";
import { verifyTOTPCounter } from "./totp.js";

/// Vérifie un code TOTP pour un utilisateur ET le consomme : le compteur de période doit
/// progresser strictement (anti-rejeu). Renvoie false si le code est invalide ou déjà utilisé.
export async function verifyAndConsumeTotp(db: DB, user: UserRow, code: string): Promise<boolean> {
  if (!user.mfa_secret) return false;
  const counter = verifyTOTPCounter(user.mfa_secret, code);
  if (counter === null) return false;
  if (counter <= user.mfa_last_counter) return false; // rejeu
  await users.setMfaLastCounter(db, user.id, counter);
  return true;
}
