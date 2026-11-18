import { normalizeEmail } from "./security.js";

/**
 * Les administrateurs de l'instance : ceux dont l'adresse figure dans
 * `GHOSTPASS_ADMIN_EMAILS` (séparées par des virgules ou des espaces).
 *
 * **Pourquoi au lancement et non en base.** Celui qui héberge tient déjà le fichier
 * d'environnement : c'est lui qui décide, et il n'a besoin d'aucun écran pour se désigner.
 * Un rôle stocké en base demanderait un premier administrateur, donc un moyen de le créer,
 * donc une porte de plus — et la question « qui a fait de lui un administrateur ? » n'aurait
 * de réponse que dans un journal.
 *
 * Être administrateur de l'instance ne donne accès à aucun coffre : le serveur ne peut pas
 * les lire, et l'administrateur pas davantage. Il voit les comptes (adresse, dates, second
 * facteur) et peut suspendre l'un d'eux.
 *
 * Lu à chaque requête, comme les autres réglages : retirer une adresse et redémarrer retire
 * le rôle, sans rien à nettoyer en base.
 */
export function adminsDeLInstance(valeur = process.env.GHOSTPASS_ADMIN_EMAILS): Set<string> {
  return new Set(
    (valeur ?? "")
      .split(/[\s,]+/)
      .map((e) => e.trim())
      .filter((e) => e !== "")
      .map(normalizeEmail),
  );
}

export function estAdminDeLInstance(email: string): boolean {
  return adminsDeLInstance().has(normalizeEmail(email));
}

/// La réponse unique à un compte suspendu, où qu'il se présente.
export const COMPTE_SUSPENDU = { error: "compte suspendu", code: "account_suspended" } as const;
