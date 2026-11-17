/**
 * L'inscription est-elle ouverte sur cette instance ?
 *
 * `GHOSTPASS_REGISTRATION` : `open` (défaut) ou `closed`. Ouverte par défaut, parce que
 * c'est le comportement de toutes les instances existantes : une montée de version qui
 * fermerait l'inscription en silence empêcherait un hébergeur d'ajouter le compte de
 * quelqu'un sans qu'il comprenne pourquoi.
 *
 * Une instance auto-hébergée exposée sur Internet est, sans ce réglage, ouverte à quiconque
 * trouve son adresse. Fermer se fait en deux temps : créer ses comptes, puis passer à
 * `closed` et redémarrer.
 *
 * **Une valeur inconnue fait échouer le démarrage.** Un `close` ou un `false` tapé de bonne
 * foi, retombé sur « ouverte », laisserait l'hébergeur croire son instance fermée alors
 * qu'elle ne l'est pas. C'est un réglage de sécurité : on ne devine pas.
 */
export type Inscription = "open" | "closed";

export function lireLInscription(valeur = process.env.GHOSTPASS_REGISTRATION): Inscription {
  // Vide ou blanche : ce qu'écrit n'importe quel gabarit pour une valeur absente.
  const v = valeur?.trim().toLowerCase() ?? "";
  if (v === "" || v === "open") return "open";
  if (v === "closed") return "closed";
  throw new Error(
    `GHOSTPASS_REGISTRATION vaut « ${valeur} » : valeurs acceptées « open » ou « closed ». ` +
      "Le serveur refuse de démarrer plutôt que de deviner si l'inscription doit être ouverte.",
  );
}

/**
 * La même lecture, pour une requête : une valeur illisible y vaut « fermée ». Le démarrage
 * l'a déjà refusée ; ce repli ne sert que si l'environnement change sous un processus
 * lancé, et dans ce cas fermer est l'erreur la moins coûteuse.
 */
export function inscriptionOuverte(): boolean {
  try {
    return lireLInscription() === "open";
  } catch {
    return false;
  }
}
