// Configuration WebAuthn (2e facteur FIDO2) + stockage éphémère des challenges.
//
// ⚠️ WebAuthn exige un contexte sécurisé (https ou localhost) et un `rpID` = DOMAINE (pas une IP).
// Configurer en prod via WEBAUTHN_RP_ID (ex. "ghostpass.ch") et WEBAUTHN_ORIGIN
// (ex. "https://ghostpass.ch"). Défauts adaptés au dev local (localhost).

import type { DB } from "../db/database.js";
import { ephemeral } from "../db/repositories.js";

export const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
export const RP_NAME = "GhostPass";
export const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173";

// Origines supplémentaires autorisées pour WebAuthn (Related Origin Requests) : typiquement les
// extensions navigateur (`chrome-extension://<id>`), qui ne sont pas same-site avec le `rpID`.
// Renseigner via WEBAUTHN_EXTRA_ORIGINS (séparées par des virgules). Lues dynamiquement pour
// rester testables. Ces origines sont exposées via `/.well-known/webauthn` ET acceptées à la
// vérification des assertions — aux QUATRE endroits : inscription et connexion par passkey,
// enregistrement d'une clé de sécurité, et second facteur à la connexion.
//
// Cette dernière phrase était déjà écrite ici le 2026-08-29 alors que deux des quatre
// vérifications validaient contre `ORIGIN` seul. Un commentaire qui décrit une garantie que le
// code ne tient pas est pire qu'un commentaire absent : il donne au lecteur suivant la raison de
// ne pas regarder. `test/webauthn-origins.test.ts` mesure désormais les quatre.
export function getExtraOrigins(): string[] {
  return (process.env.WEBAUTHN_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/// Toutes les origines acceptées : l'origine principale + les origines liées configurées.
export function getAllowedOrigins(): string[] {
  return [ORIGIN, ...getExtraOrigins()];
}

const CHALLENGE_TTL_MS = 120_000;

/// Stocke un challenge à usage unique (`reg:`/`auth:`/`pkreg:`/`pklogin:`) dans le store partagé.
export function putChallenge(db: DB, key: string, challenge: string): Promise<void> {
  return ephemeral.put(db, `wa:${key}`, challenge, CHALLENGE_TTL_MS);
}

/// Récupère ET consomme le challenge (usage unique). Null si absent ou expiré.
export function takeChallenge(db: DB, key: string): Promise<string | null> {
  return ephemeral.take(db, `wa:${key}`);
}
