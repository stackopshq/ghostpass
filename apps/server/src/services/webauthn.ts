// Configuration WebAuthn (2e facteur FIDO2) + stockage éphémère des challenges.
//
// ⚠️ WebAuthn exige un contexte sécurisé (https ou localhost) et un `rpID` = DOMAINE (pas une IP).
// Configurer en prod via WEBAUTHN_RP_ID (ex. "ghostpass.ch") et WEBAUTHN_ORIGIN
// (ex. "https://ghostpass.ch"). Défauts adaptés au dev local (localhost).

export const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
export const RP_NAME = "GhostPass";
export const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173";

const CHALLENGE_TTL_MS = 120_000;
const challenges = new Map<string, { challenge: string; expires: number }>();

/// Stocke un challenge à usage unique pour une clé donnée (`reg:<userId>` ou `auth:<userId>`).
export function putChallenge(key: string, challenge: string): void {
  challenges.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
}

/// Récupère ET consomme le challenge (usage unique). Null si absent ou expiré.
export function takeChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}
