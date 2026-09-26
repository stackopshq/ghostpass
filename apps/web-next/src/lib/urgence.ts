// L'accès d'urgence : ce que chaque état permet, et quand le délai expire.
//
// Le serveur porte cette fonctionnalité en ENTIER depuis des mois — huit routes, la machine à
// états, l'application du délai — et six fonctions clientes l'appellent depuis `api.ts`. Aucun
// écran ne les appelait. Personne ne pouvait accorder d'accès d'urgence, et les deux seuls
// libellés traduits (`app.emergency`, `app.emergencyWho`) disent que l'écran avait été prévu.
//
// Ce module existe pour que la machine à états ne vive pas dans du JSX : quatre états, deux
// rôles, deux côtés, et des actions qui ne sont pas les mêmes selon qui regarde.

/** Ce que le serveur renvoie, des deux côtés. `available` n'existe que du côté contact. */
export interface EntreeDUrgence {
  id: string;
  contactEmail: string;
  role: string;
  waitDays: number;
  status: string;
  requestedAt: number | null;
  available?: boolean;
}

export type ActionDUrgence =
  | "accepter"
  | "demander"
  | "approuver"
  | "refuser"
  | "ouvrir"
  | "reprendre"
  | "retirer";

/**
 * Ce que le PROPRIÉTAIRE du coffre peut faire sur une entrée.
 *
 * Il n'approuve ni ne refuse que pendant qu'une demande est en cours : c'est le seul moment où
 * son avis change quelque chose. Une fois le délai écoulé, l'accès est acquis et proposer
 * « refuser » laisserait croire qu'il peut encore le reprendre.
 */
export function actionsDuProprietaire(entree: EntreeDUrgence): ActionDUrgence[] {
  const actions: ActionDUrgence[] =
    entree.status === "requested" ? ["approuver", "refuser"] : [];
  // Retirer reste possible dans TOUS les états, y compris « granted ». C'est la seule façon de
  // révoquer un accès déjà accordé, et une personne qui a changé d'avis sur un proche ne doit
  // pas avoir à supprimer son compte pour cela.
  return [...actions, "retirer"];
}

/**
 * Ce que le CONTACT peut faire.
 *
 * `available` vient du serveur et fait autorité. On ne le recalcule pas ici : l'horloge du
 * navigateur n'est pas celle du serveur, et une horloge en avance afficherait « ouvrir » sur un
 * accès que le serveur refuse par un 403 — un bouton qui ment sur le seul écran où l'on compte
 * sur lui.
 */
export function actionsDuContact(entree: EntreeDUrgence): ActionDUrgence[] {
  const actions: ActionDUrgence[] = [];
  if (entree.status === "invited") actions.push("accepter");
  if (entree.status === "accepted") actions.push("demander");
  if (entree.available) {
    actions.push("ouvrir");
    // La reprise réinitialise le mot de passe maître du propriétaire et ferme toutes ses
    // sessions. Elle n'est offerte qu'au rôle qui la porte, jamais en consultation seule.
    if (entree.role === "takeover") actions.push("reprendre");
  }
  return [...actions, "retirer"];
}

/**
 * L'instant où le délai expire, en millisecondes depuis l'époque — ou `null` si aucune demande
 * n'est en cours.
 *
 * La même arithmétique que `accessAllowed` côté serveur : `requested_at + wait_days * 86 400 000`.
 * Elle est recopiée, ce qui est un défaut connu ; mais l'alternative serait que le serveur
 * renvoie la date, et il ne le fait pas. Ce test est donc ce qui tient les deux ensemble.
 */
export function disponibleLe(entree: EntreeDUrgence): number | null {
  if (entree.status !== "requested" || entree.requestedAt == null) return null;
  return entree.requestedAt + entree.waitDays * 86_400_000;
}

/**
 * Ce qu'il reste à attendre, en jours entiers ARRONDIS AU SUPÉRIEUR — ou 0 si c'est passé.
 *
 * Arrondi au supérieur parce qu'« il reste 0 jour » pendant les vingt-trois dernières heures
 * ferait revenir quelqu'un toutes les heures pour rien. Mieux vaut annoncer un jour de trop que
 * promettre une ouverture qui n'arrive pas.
 */
export function joursRestants(entree: EntreeDUrgence, maintenant: number): number {
  const echeance = disponibleLe(entree);
  if (echeance === null) return 0;
  return Math.max(0, Math.ceil((echeance - maintenant) / 86_400_000));
}
