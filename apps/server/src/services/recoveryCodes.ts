/// Codes de récupération du second facteur.
///
/// **Pourquoi ils existent.** GhostPass avait déjà un « recovery », mais il ne
/// parle pas de la même chose : `encrypted_user_key_recovery` récupère la CLÉ DU
/// COFFRE, c'est-à-dire le mot de passe maître. Il ne touche pas au second
/// facteur — `/api/auth/recover` ne remet pas `mfa_enabled` à 0, et c'est très
/// bien ainsi : le faire transformerait la clé de récupération en contournement
/// du second facteur. Conséquence, avant ce module : quelqu'un qui perd son
/// téléphone pouvait reprendre son mot de passe et restait malgré tout devant
/// une porte qui réclame un code que plus personne ne peut produire.
///
/// **Empreinte et non chiffrement.** `secretAtRest.ts` existe et sert au secret
/// TOTP, parce que celui-là doit être RELU pour vérifier un code. Un code de
/// récupération n'a jamais besoin d'être relu : on veut seulement savoir s'il
/// correspond. Une empreinte est donc strictement meilleure qu'un chiffrement —
/// elle ne se déchiffre pas, même avec la clé.
///
/// **SHA-256 et non `hashServerSecret`.** Le scrypt salé du module `security`
/// défend contre le dictionnaire : il protège des secrets que l'humain choisit.
/// Un code de récupération est tiré au hasard sur ~49 bits et n'a aucune
/// structure à deviner. Et comme on retrouve la ligne PAR son empreinte, un sel
/// par code obligerait à dérouler scrypt sur chacun des dix à chaque tentative,
/// ce qui offrirait un levier de déni de service pour un gain nul.
import { createHash, randomInt } from "node:crypto";

import type { DB } from "../db/database.js";
import { newId } from "./security.js";

/// Dix codes : assez pour parer plusieurs pertes d'appareil sans que la feuille
/// imprimée devienne elle-même un inventaire de secrets à garder.
export const NOMBRE_DE_CODES = 10;

/// Alphabet sans O, 0, I, 1 ni L. Ces codes sont lus sur un écran ou sur une
/// feuille imprimée puis retapés à la main : un zéro pris pour un O est une
/// tentative perdue sur une réserve qui en compte dix.
///
/// Trente et un caractères, donc, et pas une puissance de deux. Sans importance :
/// `randomInt` tire sans biais de modulo quelle que soit la borne, et 31**10
/// laisse encore 49 bits par code.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LONGUEUR = 10;

/// Retire ce que la saisie à la main ajoute : espaces, tirets, casse.
export function normaliser(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function empreinte(code: string): string {
  return createHash("sha256").update(normaliser(code)).digest("hex");
}

/// Un code a-t-il la forme attendue ? Sert à distinguer un code de récupération
/// d'un code TOTP à six chiffres sans avoir à interroger la base.
export function ressembleAUnCodeDeRecuperation(code: string): boolean {
  const n = normaliser(code);
  return n.length === LONGUEUR && [...n].every((c) => ALPHABET.includes(c));
}

export function genererLesCodes(): string[] {
  const un = (): string => {
    let brut = "";
    for (let i = 0; i < LONGUEUR; i++) brut += ALPHABET[randomInt(0, ALPHABET.length)];
    return `${brut.slice(0, 5)}-${brut.slice(5)}`;
  };
  return Array.from({ length: NOMBRE_DE_CODES }, un);
}

/// Remplace toute la réserve d'un compte. Les anciens codes cessent de valoir.
export async function remplacerLesCodes(db: DB, userId: string, codes: string[]): Promise<void> {
  await db.deleteFrom("mfa_recovery_codes").where("user_id", "=", userId).execute();
  if (codes.length === 0) return;
  await db
    .insertInto("mfa_recovery_codes")
    .values(
      codes.map((code) => ({
        id: newId(),
        user_id: userId,
        code_hash: empreinte(code),
        used_at: null,
        created_at: Date.now(),
      })),
    )
    .execute();
}

/// Consomme un code. Rend false s'il n'existe pas, ou s'il a déjà servi.
///
/// L'usage unique tient au `used_at IS NULL` du WHERE, pas à une lecture
/// préalable : deux requêtes simultanées présentant le même code passeraient
/// toutes les deux un test fait à la lecture, et une seule peut gagner ici.
export async function consommerUnCode(db: DB, userId: string, code: string): Promise<boolean> {
  const r = await db
    .updateTable("mfa_recovery_codes")
    .set({ used_at: Date.now() })
    .where("user_id", "=", userId)
    .where("code_hash", "=", empreinte(code))
    .where("used_at", "is", null)
    .executeTakeFirst();
  return (r.numUpdatedRows ?? 0n) > 0n;
}

/// Combien de codes restent utilisables. Sert à prévenir AVANT que la réserve
/// soit vide — le moment où l'utilisateur se croit protégé et n'a plus de porte
/// de sortie.
export async function compterLesCodesRestants(db: DB, userId: string): Promise<number> {
  const rows = await db
    .selectFrom("mfa_recovery_codes")
    .select("id")
    .where("user_id", "=", userId)
    .where("used_at", "is", null)
    .execute();
  return rows.length;
}

/// Retire toute la réserve (retrait du second facteur, suppression de compte).
export async function retirerLesCodes(db: DB, userId: string): Promise<void> {
  await db.deleteFrom("mfa_recovery_codes").where("user_id", "=", userId).execute();
}
