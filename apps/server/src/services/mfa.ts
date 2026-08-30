import type { DB } from "../db/database.js";
import type { UserRow } from "../types.js";
import { users } from "../db/repositories.js";
import { verifyTOTPCounter } from "./totp.js";
import { dechiffrerAuRepos } from "./secretAtRest.js";

/// Vérifie un code TOTP pour un utilisateur ET le consomme : le compteur de période doit
/// progresser strictement (anti-rejeu). Renvoie false si le code est invalide ou déjà utilisé.
export async function verifyAndConsumeTotp(db: DB, user: UserRow, code: string): Promise<boolean> {
  if (!user.mfa_secret) return false;
  // Le secret est chiffré en base depuis le 2026-08-30. Une valeur écrite
  // avant cette date n'a pas le préfixe et traverse telle quelle : couper le
  // second facteur de tous les comptes existants au déploiement aurait été un
  // correctif de sécurité qui verrouille les gens dehors.
  const counter = verifyTOTPCounter(dechiffrerAuRepos(user.mfa_secret), code);
  if (counter === null) return false;
  if (counter <= user.mfa_last_counter) return false; // rejeu
  await users.setMfaLastCounter(db, user.id, counter);
  return true;
}
