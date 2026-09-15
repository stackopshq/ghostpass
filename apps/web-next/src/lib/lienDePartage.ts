/// Décide si la clé de déchiffrement peut être attachée à l'URL rendue par le
/// serveur.
///
/// POURQUOI CETTE QUESTION EXISTE
/// ------------------------------
/// Depuis que le partage délègue à ghostbit, `POST /api/send` rend une `url`
/// que le client complète d'un `#<clé>`. Le fragment ne traverse jamais le
/// réseau — c'est vrai, et c'est exactement ce qui rassure à tort. **La page
/// servie par ce domaine lit `location.hash`.** Un serveur compromis qui
/// répondrait `https://relais.attaquant.example/p/abc` recevrait donc la clé,
/// et comme il détient déjà le chiffré, il lirait le secret en clair.
///
/// Le zero-knowledge tient sur DEUX hypothèses : la clé reste dans le fragment,
/// **et** le fragment n'est servi que par une page de confiance. La seconde
/// n'était vérifiée nulle part.
///
/// « Un serveur compromis a déjà tout perdu » ne vaut pas ici : nginx sert le
/// lot statique depuis sa propre image et relaie `/api` vers un autre
/// conteneur. Un `ghostpass-app` compromis ne peut pas altérer le code de
/// l'application ; il peut seulement mentir dans ses réponses.
///
/// L'ANCRE DE CONFIANCE EST L'UTILISATEUR, PAS LE SERVEUR
/// -------------------------------------------------------
/// Demander au serveur quel domaine est légitime reviendrait à lui redemander
/// ce qu'on cherche justement à ne pas croire. Seule une personne peut trancher
/// — une fois par domaine, et la réponse est mémorisée.

export type VerdictDuLien =
  | { statut: "accepte"; lien: string }
  | { statut: "demander"; hote: string; lien: string }
  | { statut: "refuse"; raison: "url-illisible" | "schema-non-chiffre" };

/// `origineDeLApp` est `location.origin` : le seul point de référence que le
/// serveur ne contrôle pas, puisque c'est l'adresse que la personne a ouverte.
export function examinerLienDePartage(
  urlDuServeur: string,
  fragment: string,
  origineDeLApp: string,
  hotesApprouves: readonly string[],
): VerdictDuLien {
  let cible: URL;
  let origine: URL;
  try {
    cible = new URL(urlDuServeur);
    origine = new URL(origineDeLApp);
  } catch {
    return { statut: "refuse", raison: "url-illisible" };
  }

  // `https` exigé, sauf si l'application elle-même est servie en clair — le cas
  // du développement local, où l'imposer rendrait le partage inutilisable sans
  // rien protéger de plus.
  if (cible.protocol !== "https:" && origine.protocol === "https:") {
    return { statut: "refuse", raison: "schema-non-chiffre" };
  }
  if (cible.protocol !== "https:" && cible.protocol !== "http:") {
    return { statut: "refuse", raison: "schema-non-chiffre" };
  }

  const lien = `${cible.href}#${fragment}`;

  // Comparaison sur `host` — nom ET port. `hostname` seul laisserait
  // `ghostpass.example:8443` passer pour `ghostpass.example`.
  if (cible.host === origine.host) return { statut: "accepte", lien };
  if (hotesApprouves.includes(cible.host)) return { statut: "accepte", lien };

  return { statut: "demander", hote: cible.host, lien };
}

/// Les hôtes qu'une personne a approuvés, MÉMORISÉS PAR ORIGINE.
///
/// La clé de stockage porte `location.origin` : approuver `ghostbit.dev` depuis
/// son propre serveur ne doit rien approuver sur l'instance de quelqu'un
/// d'autre. Une liste globale ferait qu'un serveur hostile hériterait de la
/// confiance accordée à un serveur honnête.
const PREFIXE = "gp:hotes-de-partage:";

export function hotesApprouves(): string[] {
  try {
    const brut = localStorage.getItem(PREFIXE + location.origin);
    const liste: unknown = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Stockage indisponible ou contenu abîmé : on retombe sur « rien
    // d'approuvé », donc la question est reposée. Jamais sur « tout accepter ».
    return [];
  }
}

export function approuverLHote(hote: string): void {
  try {
    const liste = hotesApprouves();
    if (liste.includes(hote)) return;
    localStorage.setItem(PREFIXE + location.origin, JSON.stringify([...liste, hote]));
  } catch {
    // Ne pas pouvoir mémoriser n'est pas une raison de ne pas partager : la
    // question sera simplement reposée au prochain partage.
  }
}
