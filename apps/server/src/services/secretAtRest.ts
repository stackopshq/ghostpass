/// Chiffrement au repos des secrets que le serveur DOIT pouvoir lire.
///
/// GhostPass est zero-knowledge pour le contenu des coffres : le serveur ne
/// détient aucune clé et ne peut rien déchiffrer. Le secret TOTP est
/// l'exception, et elle est structurelle — vérifier un code à six chiffres
/// suppose de connaître la graine. Il était donc stocké **en clair**
/// (`database.ts:66`), et `SECURITY.md` le reconnaissait.
///
/// Ce que ça changeait concrètement : quiconque lit la base — une sauvegarde
/// égarée, une injection, un accès d'exploitation — pouvait générer les codes
/// du second facteur de tout le monde. Le mot de passe maître restait hors de
/// portée, mais le deuxième facteur cessait d'en être un.
///
/// Ce que ce module apporte, et ce qu'il n'apporte pas. La clé vit à côté de la
/// base, pas dedans : un attaquant qui obtient les deux gagne quand même. C'est
/// une atténuation réelle contre le vol de base seul — le cas le plus fréquent,
/// et celui d'une sauvegarde qui fuit — et non une garantie zero-knowledge.
/// L'écrire ainsi évite de le vendre pour ce qu'il n'est pas.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/// Le préfixe est ce qui rend la migration possible sans migration : une valeur
/// sans lui est une valeur d'avant, encore en clair. Numéroté, pour qu'un
/// changement d'algorithme un jour ne soit pas indiscernable de l'absence.
const PREFIXE = "v1:";

/// Longueur de l'étiquette d'authentification, en octets, EXPLICITE des deux
/// côtés.
///
/// Sans elle, Node accepte à la vérification n'importe quelle étiquette de 4 à
/// 16 octets. Un attaquant peut alors présenter une étiquette **tronquée** :
/// forger devient exponentiellement plus facile à chaque octet retiré, et 4
/// octets se force en quelques milliards d'essais hors ligne. Le chiffrement
/// tiendrait, l'authentification non — et c'est elle qui empêche de fabriquer
/// une valeur de remplacement.
///
/// Relevé par Semgrep (`gcm-no-tag-length`) sur la première version de ce
/// fichier. Le garde-fou a fait exactement son travail.
const LONGUEUR_ETIQUETTE = 16;

let cleEnMemoire: Buffer | null = null;

/// Charge la clé depuis l'environnement. Séparée du reste pour être testable
/// sans variables globales.
export function chargerLaCle(valeur: string | undefined): Buffer | null {
  if (!valeur) return null;
  // Accepte 64 caractères hexadécimaux (32 octets) ou n'importe quelle phrase,
  // dérivée alors par scrypt. La seconde forme existe pour qu'un auto-hébergeur
  // ne soit pas bloqué par un format, pas pour être recommandée.
  if (/^[0-9a-f]{64}$/i.test(valeur)) return Buffer.from(valeur, "hex");
  return scryptSync(valeur, "ghostpass-secret-at-rest", 32);
}

export function definirLaCle(cle: Buffer | null): void {
  cleEnMemoire = cle;
}

export function laCleEstPosee(): boolean {
  return cleEnMemoire !== null;
}

/// Chiffre une valeur destinée à la base. Sans clé, rend la valeur telle quelle
/// — le serveur refuse déjà de démarrer dans ce cas en production, et le mode
/// développement doit rester utilisable sans cérémonie.
export function chiffrerAuRepos(clair: string): string {
  if (!cleEnMemoire) return clair;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cleEnMemoire, iv, {
    authTagLength: LONGUEUR_ETIQUETTE,
  });
  const ct = Buffer.concat([c.update(clair, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${PREFIXE}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/// Déchiffre une valeur venue de la base.
///
/// Une valeur sans préfixe est rendue telle quelle : c'est une ligne écrite
/// avant ce module, encore en clair. Elle sera réécrite chiffrée au prochain
/// enregistrement du secret. Refuser de la lire reviendrait à couper le second
/// facteur de tous les comptes existants au déploiement — un correctif de
/// sécurité qui verrouille les gens dehors n'est pas un correctif.
export function dechiffrerAuRepos(stocke: string): string {
  if (!stocke.startsWith(PREFIXE)) return stocke;
  if (!cleEnMemoire)
    throw new Error(
      "un secret chiffré a été lu sans clé : MFA_SECRET_KEY manque ou a changé",
    );
  const [iv, tag, ct] = stocke.slice(PREFIXE.length).split(":");
  if (!iv || !tag || !ct) throw new Error("secret au repos malformé");
  const d = createDecipheriv("aes-256-gcm", cleEnMemoire, Buffer.from(iv, "base64url"), {
    authTagLength: LONGUEUR_ETIQUETTE,
  });
  const etiquette = Buffer.from(tag, "base64url");
  // Refuser AVANT `setAuthTag` : `authTagLength` borne ce que Node accepte,
  // mais un refus explicite dit pourquoi, là où l'erreur de la bibliothèque
  // parle d'une longueur invalide sans dire qu'on tentait de tronquer.
  if (etiquette.length !== LONGUEUR_ETIQUETTE)
    throw new Error("étiquette d'authentification de longueur inattendue");
  d.setAuthTag(etiquette);
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/// Une valeur déjà chiffrée ? Sert à savoir s'il faut réécrire au passage.
export function dejaChiffre(stocke: string): boolean {
  return stocke.startsWith(PREFIXE);
}
