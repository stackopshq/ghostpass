// Les registres « liste d'identifiants » : favoris et archives.
//
// Tous deux sont un CHOIX DE LA PERSONNE, pas une propriété de l'élément. Ils
// vivent donc dans son coffre, sous un nom réservé, et non dans l'élément
// chiffré : celui d'une collection d'équipe est partagé, et y écrire « favori »
// l'imposerait à tous les membres. Le contrat (`assets/vecteurs/contrat.json`,
// bloc `registries`) fixe les noms et la forme ; iOS et Android lisent déjà les
// favoris sous ce nom.

/// Le préfixe de tout registre. Un NUL : aucun clavier ne le produit, donc aucun
/// nom saisi ne peut l'usurper. Écrit échappé, pour que `grep` ne prenne pas ce
/// fichier pour du binaire.
export const REGISTRY_PREFIX = "\u0000gp:";

export const FAVORITES_ITEM_NAME = "\u0000gp:favorites";
export const ARCHIVED_ITEM_NAME = "\u0000gp:archived";

/// Lit un registre écrit par n'importe quel client.
///
/// C'est au lecteur d'être robuste : illisible vaut vide, pas panne. Ces
/// registres ne contiennent aucun secret, et faire échouer le chargement du
/// coffre pour un favori serait hors de proportion. Un identifiant qui n'est pas
/// une chaîne est écarté plutôt que de faire échouer le reste.
export function lireListeDIdentifiants(contenu: string | undefined): string[] {
  let brut: unknown;
  try {
    brut = JSON.parse(contenu ?? "");
  } catch {
    return [];
  }
  if (!Array.isArray(brut)) return [];
  return [...new Set(brut.filter((x): x is string => typeof x === "string" && x !== ""))];
}

/// Ajoute l'identifiant s'il manque, le retire s'il y est.
export function basculer(ids: ReadonlySet<string>, id: string): Set<string> {
  const s = new Set(ids);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  return s;
}

/// Ce qui s'écrit au registre : trié, pour qu'une écriture sans changement
/// produise le même contenu, et élagué des éléments qui n'existent plus.
///
/// L'élagage n'a lieu que si la lecture du coffre a été COMPLÈTE. Les
/// collections d'équipe se chargent en silence quand elles échouent ; un
/// élément d'équipe absent de la liste n'est alors pas supprimé, seulement
/// illisible ce jour-là, et l'élaguer effacerait un choix encore valable.
export function aEcrire(
  ids: ReadonlySet<string>,
  vivants: ReadonlySet<string>,
  lectureComplete: boolean,
): string[] {
  const retenus = lectureComplete ? [...ids].filter((id) => vivants.has(id)) : [...ids];
  return retenus.sort();
}
