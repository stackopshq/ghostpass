/// La porte du second facteur : ce qu'un code juste ne suffit pas à établir.
///
/// Vérifier six chiffres est la partie facile, et `totp.ts` la fait. Ce module
/// contient le reste, c'est-à-dire ce qui décide si le second facteur protège
/// vraiment :
///
/// - l'**anti-rejeu**, déjà là : un code vaut trente secondes, largement de quoi
///   être lu par-dessus l'épaule ou capté dans un journal, donc la période
///   consommée doit progresser strictement ;
/// - la **limitation des essais**, nouvelle. Six chiffres, c'est un million de
///   possibilités, et la fenêtre de ±1 période en rend trois acceptables à tout
///   instant. Le `rateLimit` de la route de connexion ne peut pas y suffire : il
///   compte **par adresse IP**, qu'un attaquant fait tourner, et son magasin par
///   défaut est en mémoire de processus, donc il ne survit ni à un redémarrage
///   ni à une seconde instance. Ce compteur-ci vit dans la ligne du compte ;
/// - les **codes de récupération**, nouveaux aussi. Voir `recoveryCodes.ts` :
///   sans eux, un téléphone perdu était un compte perdu, et la récupération de
///   coffre n'y changeait rien puisqu'elle rend le mot de passe, pas la porte.
///
/// Le second facteur garde la porte ; il n'ouvre pas le coffre. Le serveur
/// connaît la graine TOTP — il le faut pour vérifier un code — mais elle ne
/// déchiffre rien : la clé du coffre est dérivée du mot de passe maître, que le
/// serveur ne voit jamais. C'est aussi pourquoi un code de récupération n'est
/// pas un passe-partout : la connexion vérifie le mot de passe AVANT d'arriver
/// ici, et sans lui le coffre reste illisible même la porte franchie.
import type { DB } from "../db/database.js";
import type { UserRow } from "../types.js";
import { users } from "../db/repositories.js";
import { verifyTOTPCounter } from "./totp.js";
import { consommerUnCode, ressembleAUnCodeDeRecuperation } from "./recoveryCodes.js";
import { dechiffrerAuRepos } from "./secretAtRest.js";

/// Cinq essais avant blocage. Avec une fenêtre de ±1 période, trois codes sur un
/// million sont acceptables à un instant donné : cinq essais laissent une chance
/// sur près de soixante-dix mille par salve, et il en faut une par quart d'heure.
export const MAX_ESSAIS = 5;
export const BLOCAGE_MS = 15 * 60 * 1000;

export type ResultatSecondFacteur =
  /// Aucun code fourni. **Ce n'est pas un échec** : c'est la première moitié
  /// d'une connexion en deux temps, et le client doit maintenant en demander un.
  /// Le compter comme un raté verrouillerait le compte de quelqu'un qui se
  /// connecte normalement cinq fois.
  | { ok: false; raison: "requis" }
  | { ok: true }
  | { ok: false; raison: "invalide" }
  | { ok: false; raison: "bloque"; jusqua: number };

/// Vérifie un code — TOTP ou de récupération — et en tire les conséquences.
///
/// Remplace l'ancien `verifyAndConsumeTotp`, qui rendait un booléen. Le booléen
/// ne permettait pas de distinguer « code faux » de « trop d'essais », donc pas
/// de répondre autre chose que 401 à un compte bloqué, donc de faire tourner un
/// client légitime en boucle sur une saisie qui ne peut plus aboutir.
export async function verifierLeSecondFacteur(
  db: DB,
  user: UserRow,
  code: string | undefined,
  maintenant: number = Date.now(),
): Promise<ResultatSecondFacteur> {
  if (!user.mfa_secret) return { ok: false, raison: "invalide" };

  // Le blocage se teste AVANT toute comparaison : un compte bloqué ne doit pas
  // servir d'oracle, même à qui présenterait le bon code.
  if (user.mfa_locked_until !== null && user.mfa_locked_until > maintenant) {
    return { ok: false, raison: "bloque", jusqua: user.mfa_locked_until };
  }

  // Demande, pas échec — ne compte pas dans les essais ratés. Testé APRÈS le
  // blocage pour qu'un compte bloqué le dise plutôt que de réclamer un code.
  if (code === undefined || code === "") return { ok: false, raison: "requis" };

  // Le secret est chiffré en base depuis le 2026-08-30. Une valeur écrite avant
  // cette date n'a pas le préfixe et traverse telle quelle : couper le second
  // facteur de tous les comptes existants au déploiement aurait été un correctif
  // de sécurité qui verrouille les gens dehors.
  const counter = verifyTOTPCounter(dechiffrerAuRepos(user.mfa_secret), code, maintenant);
  if (counter !== null) {
    if (counter <= user.mfa_last_counter) {
      // Code juste mais déjà consommé : c'est un rejeu, donc un échec, et il
      // compte comme tel. Sans quoi un code capté se rejoue à l'infini sans
      // jamais déclencher le blocage.
      await enregistrerUnEchec(db, user, maintenant);
      return { ok: false, raison: "invalide" };
    }
    await users.setMfaSuccess(db, user.id, counter);
    return { ok: true };
  }

  if (ressembleAUnCodeDeRecuperation(code) && (await consommerUnCode(db, user.id, code))) {
    // Un code de récupération n'a pas de période TOTP à faire avancer ; on garde
    // donc la dernière, et on efface les essais ratés comme pour tout succès.
    await users.setMfaSuccess(db, user.id, user.mfa_last_counter);
    return { ok: true };
  }

  await enregistrerUnEchec(db, user, maintenant);
  return { ok: false, raison: "invalide" };
}

/// Compte l'échec et bloque au seuil.
///
/// Le compteur n'est **pas** remis à zéro quand le blocage expire : passé le
/// premier verrouillage, chaque nouvel échec reverrouille aussitôt, donc un
/// essai par quart d'heure au lieu de cinq. C'est volontairement sévère — un
/// compte sous attaque ne se rouvre pas tout seul — et sans conséquence pour son
/// propriétaire, qu'un seul code juste remet à zéro, et à qui il reste ses codes
/// de récupération.
async function enregistrerUnEchec(db: DB, user: UserRow, maintenant: number): Promise<void> {
  const essais = user.mfa_failed_attempts + 1;
  const jusqua = essais >= MAX_ESSAIS ? maintenant + BLOCAGE_MS : null;
  await users.setMfaFailure(db, user.id, essais, jusqua);
}
