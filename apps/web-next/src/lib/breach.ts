// Vérification de fuite via Have I Been Pwned, en k-anonymity.
// Seuls les 5 premiers caractères du SHA-1 du mot de passe sont envoyés ; le mot de passe (et même
// son hash complet) ne quitte jamais l'appareil. L'API renvoie tous les suffixes du préfixe ;
// la correspondance se fait localement.
//
// QUAND L'APPEL PART
// Jamais en tâche de fond sur tout le coffre : dans Surveillance, sur un clic ;
// dans le formulaire d'un élément, sur un clic aussi, ou en quittant le champ
// du mot de passe si la personne l'a demandé dans Sécurité. Ce réglage est
// désactivé par défaut : l'appel part du NAVIGATEUR, donc le service voit
// l'adresse IP de la personne, et c'est à elle de l'accepter.

async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/// Renvoie le nombre d'apparitions du mot de passe dans des fuites connues (0 = jamais vu).
export async function pwnedCount(password: string): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  // `Add-Padding` renvoie des entrées factices (count 0) pour masquer la taille de la réponse.
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!res.ok) throw new Error("service de vérification des fuites indisponible");
  const text = await res.text();
  for (const line of text.split("\n")) {
    const [s, c] = line.trim().split(":");
    if (s === suffix) return Number.parseInt(c ?? "0", 10) || 0;
  }
  return 0;
}

/// Le réglage « vérifier en quittant le champ », propre à l'appareil comme le
/// verrouillage. 1 : oui ; 0 : non, le défaut.
export const CLE_FUITES_A_LA_SAISIE = "gp_fuites_a_la_saisie";
export const CHOIX_FUITES_A_LA_SAISIE = [0, 1] as const;
export const FUITES_A_LA_SAISIE_PAR_DEFAUT = 0;
