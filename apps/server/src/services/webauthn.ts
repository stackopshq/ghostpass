// Configuration WebAuthn (2e facteur FIDO2) + stockage éphémère des challenges.
//
// ⚠️ WebAuthn exige un contexte sécurisé (https ou localhost) et un `rpID` = DOMAINE (pas une IP).
//
// UNE SEULE variable à poser en production : WEBAUTHN_ORIGIN (ex. "https://pass.stackops.ch").
// Le `rpID` en découle. WEBAUTHN_RP_ID existe encore, mais seulement pour le cas particulier
// décrit sur `derivezRpId` — partager une passkey entre sous-domaines.

import type { DB } from "../db/database.js";
import { ephemeral } from "../db/repositories.js";

export const RP_NAME = "GhostPass";

/// L'origine de repli, pour le développement seul. En production elle est TOUJOURS fausse : le
/// navigateur compare l'origine de la page à celle-ci, et refuse dès qu'elles diffèrent.
export const ORIGINE_DE_DEVELOPPEMENT = "http://localhost:5173";

/// Vrai si l'exploitant a posé `WEBAUTHN_ORIGIN`. Séparé d'`ORIGIN` parce que la valeur ne dit
/// pas d'où elle vient : `http://localhost:5173` posé explicitement et le repli se ressemblent,
/// et seul le second est un oubli à signaler.
export const ORIGINE_CONFIGUREE =
  (process.env.WEBAUTHN_ORIGIN ?? "").trim() !== "";

export const ORIGIN = ORIGINE_CONFIGUREE
  ? (process.env.WEBAUTHN_ORIGIN as string).trim()
  : ORIGINE_DE_DEVELOPPEMENT;

/// Ce que l'exploitant doit lire au démarrage quand rien n'est posé, ou `null` si tout va bien.
///
/// POURQUOI UN AVERTISSEMENT ET NON UN REFUS DE DÉMARRER. C'est la convention de ce dépôt, et
/// elle est écrite dans `index.ts` à propos de `MFA_SECRET_KEY` : « un correctif de sécurité qui
/// met les gens dehors n'en est pas un ». GhostPass s'auto-héberge ; faire échouer le démarrage
/// mettrait hors ligne, à la montée de version, toutes les instances qui n'utilisent pas
/// WebAuthn. Le mode de défaillance qu'on combat n'est pas l'absence de réglage, c'est de croire
/// que WebAuthn marche alors qu'aucune cérémonie ne peut aboutir.
///
/// Une valeur posée mais ILLISIBLE reste une erreur fatale, elle : c'est une faute de frappe dans
/// une intention claire, pas un chemin de montée de version. Voir `derivezRpId`.
export function avertissementDOrigine(): string | null {
  if (ORIGINE_CONFIGUREE) return null;
  return (
    `WEBAUTHN_ORIGIN absente : WebAuthn s'annonce sur ${ORIGINE_DE_DEVELOPPEMENT} ` +
    `(rpID « localhost »). Servi depuis un vrai domaine, CHAQUE cérémonie sera refusée par le ` +
    `navigateur — « The RP ID "localhost" is invalid for this domain » — à l'ajout d'une passkey ` +
    `comme d'une clé de sécurité. Poser WEBAUTHN_ORIGIN à l'origine publique, ` +
    `par exemple https://pass.ghostsuite.cloud`
  );
}

/// Le `rpID` DÉRIVE de l'origine, au lieu d'être une seconde variable à tenir d'accord.
///
/// `WEBAUTHN_RP_ID ?? "localhost"` était un réglage qui existe, qui est documenté, et que le
/// déploiement ne posait pas : en production le serveur annonçait donc `rpID: "localhost"` à une
/// page servie depuis un vrai domaine, et le navigateur refusait chaque cérémonie —
///
///     The RP ID "localhost" is invalid for this domain
///
/// — pour l'ajout d'une clé de sécurité comme pour celui d'une passkey. Le défaut n'est pas la
/// valeur par défaut : c'est qu'il ait fallu poser DEUX variables cohérentes pour que WebAuthn
/// marche, et qu'en poser une seule échoue en silence jusqu'au clic d'un utilisateur.
///
/// Le `rpID` doit être le domaine de l'origine, ou un de ses suffixes enregistrables. Le domaine
/// de l'origine est donc toujours une réponse juste, et c'est celle que l'on prend. `WEBAUTHN_RP_ID`
/// reste un remplacement explicite, pour le seul cas qui le justifie : vouloir un domaine PARENT
/// (`stackops.ch` plutôt que `pass.stackops.ch`) afin qu'une passkey serve à plusieurs
/// sous-domaines.
export function derivezRpId(origine: string, remplacement?: string): string {
  const explicite = remplacement?.trim();
  if (explicite) return explicite;
  try {
    return new URL(origine).hostname;
  } catch {
    // Une origine illisible est un défaut de configuration, pas un cas à rattraper en silence :
    // renvoyer « localhost » ici recréerait exactement la panne qu'on vient de corriger.
    throw new Error(
      `WEBAUTHN_ORIGIN n'est pas une URL valide (${JSON.stringify(origine)}). ` +
        `WebAuthn ne peut pas démarrer sans savoir sur quel domaine il s'exerce.`,
    );
  }
}

export const RP_ID = derivezRpId(ORIGIN, process.env.WEBAUTHN_RP_ID);

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
export function putChallenge(
  db: DB,
  key: string,
  challenge: string,
): Promise<void> {
  return ephemeral.put(db, `wa:${key}`, challenge, CHALLENGE_TTL_MS);
}

/// Récupère ET consomme le challenge (usage unique). Null si absent ou expiré.
export function takeChallenge(db: DB, key: string): Promise<string | null> {
  return ephemeral.take(db, `wa:${key}`);
}
