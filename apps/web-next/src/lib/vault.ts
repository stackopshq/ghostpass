// Le coffre, sans React : arborescence, filtrage, force d'un mot de passe.
//
// Ces fonctions étaient mêlées à la vue dans `App.svelte`, donc éprouvables
// seulement en montant l'application entière. Elles ne dépendent de rien —
// ni du DOM, ni du WebAssembly, ni d'un état réactif — et se testent avec
// un tableau en entrée et une valeur en sortie.

import type { DecryptedItem } from "@/lib/crypto";

/// Une entrée déchiffrée, plus les métadonnées que le serveur garde en clair.
export interface VaultEntry extends DecryptedItem {
  id: string;
  updatedAt: number;
  /// Présent uniquement sur les éléments qui viennent d'une collection
  /// d'équipe. Son absence signifie « personnel », et c'est ce que teste tout
  /// ce qui ne doit toucher que le coffre de la personne — l'export CSV en
  /// premier, qui déposerait sinon les secrets de toute l'organisation en clair
  /// sur l'appareil d'un seul de ses membres.
  shared?: {
    orgId: string;
    orgName: string;
    collectionId: string;
    collectionName: string;
    permission: string;
  };
}

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  items: VaultEntry[];
}

function ensureFolder(root: TreeNode, path: string): TreeNode {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  let node = root;
  let acc = "";
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    let child = node.children.find((c) => c.name === seg);
    if (!child) {
      child = { name: seg, path: acc, children: [], items: [] };
      node.children.push(child);
    }
    node = child;
  }
  return node;
}

/// Déduit l'arborescence des chemins « A/B/C » portés par chaque entrée.
///
/// Les dossiers vides ne se déduisent d'aucune entrée : ils viennent du
/// registre chiffré, sinon créer un dossier avant d'y ranger quoi que ce soit
/// serait un geste sans effet visible.
export function buildTree(list: VaultEntry[], extraFolders: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: [], items: [] };
  for (const item of list) ensureFolder(root, item.folder || "").items.push(item);
  for (const f of extraFolders) ensureFolder(root, f);
  const sortNode = (n: TreeNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.items.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export function countItems(node: TreeNode): number {
  return node.items.length + node.children.reduce((sum, c) => sum + countItems(c), 0);
}

/// Liste du milieu : le dossier choisi, ou les résultats de recherche.
///
/// La recherche est **globale et ignore le dossier courant** : on cherche parce
/// qu'on ne sait plus où la chose est rangée. La restreindre au dossier ouvert
/// rendrait zéro résultat exactement quand la recherche sert.
export function filtrerVisibles(
  items: VaultEntry[],
  search: string,
  selectedFolder: string | null,
): VaultEntry[] {
  const q = search.trim().toLowerCase();
  return items
    .filter((it) => {
      if (q) return it.name.toLowerCase().includes(q) || it.username.toLowerCase().includes(q);
      return selectedFolder === null || it.folder === selectedFolder;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/// Chemins existants, pour l'autocomplétion du formulaire.
export function folderPaths(items: VaultEntry[], emptyFolders: string[]): string[] {
  return [...new Set([...items.map((i) => i.folder).filter(Boolean), ...emptyFolders])].sort((a, b) =>
    a.localeCompare(b),
  );
}

/// Estimation locale — longueur et variété. Aucun appel réseau : juger un mot
/// de passe en l'envoyant quelque part contredirait la promesse du produit.
export function passwordStrength(pw: string): { niveau: number; cle: string } {
  if (!pw) return { niveau: 0, cle: "strength.empty" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (pw.length >= 20) score++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes >= 2) score++;
  if (classes >= 3) score++;
  const niveau = Math.min(4, Math.round((score / 5) * 4));
  return { niveau, cle: ["strength.veryWeak", "strength.weak", "strength.fair", "strength.good", "strength.veryGood"][niveau]! };
}

/// Santé du coffre, calculée entièrement dans l'onglet.
export function sante(items: VaultEntry[]) {
  const counts = new Map<string, number>();
  for (const i of items) if (i.password) counts.set(i.password, (counts.get(i.password) ?? 0) + 1);
  return {
    faibles: items.filter((i) => i.password && passwordStrength(i.password).niveau <= 1),
    reutilises: items.filter((i) => i.password && (counts.get(i.password) ?? 0) > 1),
    sansTotp: items.filter((i) => !i.totp),
  };
}

const AVATAR_COLORS = [
  "#e0533f", "#e0892f", "#3f9e6b", "#3f86e0",
  "#7c5cf0", "#d9528a", "#2fa3a3", "#9a7b3f",
];

/// Couleur d'avatar déterministe, pour que la même entrée garde la sienne d'une
/// session à l'autre — un hasard la ferait changer à chaque chargement.
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/// La date suit la langue choisie dans l'application, pas celle du navigateur :
/// l'ancienne interface écrivait « fr-FR » en dur, donc une session en anglais
/// affichait des dates françaises.
export function formatDate(ms: number, locale: string): string {
  try {
    return new Date(ms).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });
  } catch {
    return "";
  }
}

/// Vingt versions d'un mot de passe remplacé, et la règle vit ici.
///
/// Elle vivait en dur dans l'écran du coffre personnel, avec son plafond écrit
/// en chiffre. Les deux écrans d'équipe ne la portaient pas — ils ne
/// transportaient même pas l'historique — et **l'effaçaient** à chaque
/// modification. C'est le même mécanisme que la troncature des adresses : une
/// règle recopiée dans un écran sur trois, et le formulaire qui la perd est
/// celui qui n'en a jamais entendu parler.
///
/// Sans plafond, l'entrée chiffrée grossit sans fin ; vingt est ce que le
/// coffre personnel appliquait déjà, et changer ce nombre ici le change partout.
export const VERSIONS_DE_MOT_DE_PASSE_GARDEES = 20;

/// Rend l'historique à écrire. `ancien` est le mot de passe tel qu'il est
/// enregistré, `nouveau` celui que le formulaire propose.
///
/// Un mot de passe inchangé n'ajoute rien : sans ce test, ouvrir une entrée et
/// la réenregistrer sans y toucher empilerait vingt fois la même valeur et
/// chasserait le véritable historique.
export function historiqueApresModification(
  ancien: string | undefined,
  nouveau: string,
  historique: string[] | undefined,
): string[] {
  const actuel = historique ?? [];
  if (!ancien || ancien === nouveau) return actuel;
  return [ancien, ...actuel].slice(0, VERSIONS_DE_MOT_DE_PASSE_GARDEES);
}
