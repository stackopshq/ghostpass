import type { DB } from "../db/database.js";

/**
 * L'inscription est-elle ouverte sur cette instance ?
 *
 * Deux façons de la régler, et une seule qui gagne :
 *
 * 1. **`GHOSTPASS_REGISTRATION`**, `open` ou `closed`, posée dans l'environnement. Elle
 *    l'emporte toujours : un hébergeur qui décrit son instance dans un fichier de
 *    déploiement doit pouvoir compter que ce fichier dit vrai, et qu'un clic dans
 *    l'interface ne le contredit pas en silence. La vue d'administration l'affiche alors
 *    sans bouton.
 * 2. **Le bouton de la vue d'administration**, quand la variable est vide ou absente. Le
 *    choix est gardé en base (`instance_settings`) et survit aux redémarrages.
 *
 * Sans l'un ni l'autre : ouverte, parce que c'est le comportement de toutes les instances
 * existantes. Une montée de version qui fermerait l'inscription en silence empêcherait un
 * hébergeur d'ajouter le compte de quelqu'un sans qu'il comprenne pourquoi.
 *
 * **Une valeur inconnue fait échouer le démarrage.** Un `close` ou un `false` tapé de bonne
 * foi, retombé sur « ouverte », laisserait l'hébergeur croire son instance fermée alors
 * qu'elle ne l'est pas. C'est un réglage de sécurité : on ne devine pas.
 */
export type Inscription = "open" | "closed";
export type OrigineDeLInscription = "environment" | "admin" | "default";

const CLE = "registration";

/// Ce que dit l'environnement : `null` quand la variable est vide ou absente, c'est-à-dire
/// quand la vue d'administration décide.
export function lireLInscription(
  valeur = process.env.GHOSTPASS_REGISTRATION,
): Inscription | null {
  // Vide ou blanche : ce qu'écrit n'importe quel gabarit pour une valeur absente.
  const v = valeur?.trim().toLowerCase() ?? "";
  if (v === "") return null;
  if (v === "open" || v === "closed") return v;
  throw new Error(
    `GHOSTPASS_REGISTRATION vaut « ${valeur} » : valeurs acceptées « open », « closed », ou ` +
      "vide pour la régler depuis la vue d'administration. Le serveur refuse de démarrer " +
      "plutôt que de deviner si l'inscription doit être ouverte.",
  );
}

export async function etatDeLInscription(
  db: DB,
): Promise<{ registration: Inscription; source: OrigineDeLInscription }> {
  let env: Inscription | null;
  try {
    env = lireLInscription();
  } catch {
    // Le démarrage a déjà refusé une valeur illisible ; ce repli ne sert que si
    // l'environnement change sous un processus lancé. Fermer est l'erreur la moins coûteuse.
    return { registration: "closed", source: "environment" };
  }
  if (env) return { registration: env, source: "environment" };
  const ligne = await db
    .selectFrom("instance_settings")
    .select("value")
    .where("key", "=", CLE)
    .executeTakeFirst();
  if (ligne?.value === "open" || ligne?.value === "closed") {
    return { registration: ligne.value, source: "admin" };
  }
  return { registration: "open", source: "default" };
}

export async function inscriptionOuverte(db: DB): Promise<boolean> {
  return (await etatDeLInscription(db)).registration === "open";
}

/// Le choix de la vue d'administration. À n'appeler que si l'environnement ne fixe rien :
/// la route le vérifie, puisque ce choix serait sinon ignoré.
export async function choisirLInscription(db: DB, valeur: Inscription): Promise<void> {
  await db
    .insertInto("instance_settings")
    .values({ key: CLE, value: valeur, updated_at: Date.now() })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: valeur, updated_at: Date.now() }))
    .execute();
}
