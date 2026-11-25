// Le coffre, sans React : arborescence, filtrage, force d'un mot de passe.
//
// Ces fonctions étaient mêlées à la vue dans `App.svelte`, donc éprouvables
// seulement en montant l'application entière. Elles ne dépendent de rien —
// ni du DOM, ni du WebAssembly, ni d'un état réactif — et se testent avec
// un tableau en entrée et une valeur en sortie.

import type { DecryptedItem, ItemKind } from "@/lib/crypto";

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

/// Le coffre dont la barre latérale montre l'arborescence : tous confondus,
/// le personnel, ou celui d'une organisation.
export type Portee =
  | { type: "tous" }
  | { type: "personnel" }
  | { type: "organisation"; orgId: string; nom: string };

export const TOUS_LES_COFFRES: Portee = { type: "tous" };

export function dansLaPortee(item: VaultEntry, portee: Portee): boolean {
  if (portee.type === "personnel") return !item.shared;
  if (portee.type === "organisation") return item.shared?.orgId === portee.orgId;
  return true;
}

/// Ce que la barre latérale a choisi de montrer au milieu.
export type Filtre =
  | { type: "tous" }
  | { type: "favoris" }
  | { type: "archives" }
  /// Un coffre : le personnel, ou celui d'une organisation.
  | { type: "personnel" }
  | { type: "organisation"; orgId: string; nom: string }
  /// Un dossier DE la portée : le même chemin peut exister dans deux coffres.
  | { type: "dossier"; chemin: string; portee: Portee };

export const TOUS: Filtre = { type: "tous" };

/// Liste du milieu : ce que le filtre retient, ou les résultats de recherche.
///
/// La recherche est **globale et ignore le filtre courant** : on cherche parce
/// qu'on ne sait plus où la chose est rangée. La restreindre au dossier ouvert
/// rendrait zéro résultat exactement quand la recherche sert.
///
/// Une seule frontière que la recherche ne franchit pas : les archives. Archiver
/// sert à sortir un élément du quotidien ; le voir revenir dans chaque recherche
/// annulerait le geste. Dans la vue des archives, la recherche porte sur elles.
/// La portée qu'implique un filtre. Les vues transversales (tout, favoris,
/// archives) n'ont pas de coffre : l'arborescence revient à celle de tous.
export function porteeDe(filtre: Filtre): Portee {
  if (filtre.type === "personnel") return { type: "personnel" };
  if (filtre.type === "organisation") return { type: "organisation", orgId: filtre.orgId, nom: filtre.nom };
  if (filtre.type === "dossier") return filtre.portee;
  return TOUS_LES_COFFRES;
}

export function filtrerVisibles(
  items: VaultEntry[],
  search: string,
  filtre: Filtre,
  favoris: ReadonlySet<string> = new Set(),
  archives: ReadonlySet<string> = new Set(),
): VaultEntry[] {
  const q = search.trim().toLowerCase();
  const dansLesArchives = filtre.type === "archives";
  return items
    .filter((it) => {
      if (archives.has(it.id) !== dansLesArchives) return false;
      if (q) return it.name.toLowerCase().includes(q) || it.username.toLowerCase().includes(q);
      switch (filtre.type) {
        case "tous":
        case "archives":
          return true;
        case "favoris":
          return favoris.has(it.id);
        case "personnel":
          return !it.shared;
        case "organisation":
          return it.shared?.orgId === filtre.orgId;
        case "dossier":
          return dansLaPortee(it, filtre.portee) && it.folder === filtre.chemin;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/// L'ordre de la liste : un critère et un sens.
///
/// Pas de date de création : le serveur ne la garde pas, et un tri « par date
/// de création » qui trierait en réalité par modification mentirait sur ce
/// qu'il fait.
export type Critere = "nom" | "modification";
export type Sens = "asc" | "desc";
export interface Ordre {
  critere: Critere;
  sens: Sens;
}
export const CRITERES: readonly Critere[] = ["nom", "modification"];

/// Le sens qu'on attend en choisissant un critère : l'alphabet de A à Z, et
/// les dates les plus récentes d'abord. Garder le sens précédent en changeant
/// de critère donnerait « Z à A » en passant aux dates, puis les plus anciens
/// en premier, ce que personne ne demande.
export function sensNaturel(critere: Critere): Sens {
  return critere === "nom" ? "asc" : "desc";
}

export const ORDRE_PAR_DEFAUT: Ordre = { critere: "nom", sens: "asc" };

/// L'ordre tel qu'il se range dans le navigateur, et sa relecture. Toute
/// valeur inattendue, y compris l'ancien format (« nom », « recent »),
/// retombe sur le défaut.
export function ecrireOrdre(o: Ordre): string {
  return `${o.critere}:${o.sens}`;
}

export function lireOrdre(brut: string | null): Ordre {
  const [critere, sens] = (brut ?? "").split(":");
  if ((CRITERES as readonly string[]).includes(critere) && (sens === "asc" || sens === "desc")) {
    return { critere: critere as Critere, sens };
  }
  return ORDRE_PAR_DEFAUT;
}

/// Le type d'élément que la liste montre : le menu « Afficher » de Keeper.
///
/// Il s'ajoute au choix de la barre latérale au lieu de le remplacer : on veut
/// « les cartes de l'équipe », pas choisir entre les cartes et l'équipe.
export type Genre = "tous" | ItemKind;
export const GENRES: readonly Genre[] = ["tous", "login", "card", "note"];

export function duGenre<T extends { kind: ItemKind }>(items: readonly T[], genre: Genre): T[] {
  return genre === "tous" ? [...items] : items.filter((i) => i.kind === genre);
}

/// La disposition de la liste. « dossiers » n'a de sens que dans la vue d'un
/// coffre ; ailleurs (recherche, favoris, archives) elle se lit comme une liste.
export type Vue = "dossiers" | "liste" | "tuiles";
export const VUES: readonly Vue[] = ["dossiers", "liste", "tuiles"];

export function lireVue(brut: string | null): Vue {
  return (VUES as readonly string[]).includes(brut ?? "") ? (brut as Vue) : "dossiers";
}

/// Trie sans toucher au tableau reçu : `visibles` est mémoïsé, le trier en
/// place réordonnerait aussi ce que d'autres vues lisent.
///
/// Par date, les égalités se départagent par le nom, toujours de A à Z : un
/// import pose des dizaines d'éléments à la même milliseconde, et un ordre qui
/// change d'un rendu à l'autre ferait sauter la ligne qu'on s'apprête à cliquer.
export function trierEntrees(items: readonly VaultEntry[], ordre: Ordre): VaultEntry[] {
  const signe = ordre.sens === "asc" ? 1 : -1;
  const parNom = (a: VaultEntry, b: VaultEntry) => a.name.localeCompare(b.name);
  return [...items].sort(
    ordre.critere === "nom"
      ? (a, b) => signe * parNom(a, b)
      : (a, b) => signe * (a.updatedAt - b.updatedAt) || parNom(a, b),
  );
}

/// L'adresse à ouvrir pour une URL du coffre, ou `null` si elle ne doit pas
/// l'être.
///
/// Une adresse saisie à la main n'a souvent pas de schéma : on lui donne
/// `https://`. Tout ce qui n'est pas http ou https est refusé, et c'est le
/// point : un membre d'équipe peut déposer `javascript://%0a…` dans une
/// collection partagée, et `window.open` l'exécuterait dans l'origine du
/// coffre déverrouillé d'un autre.
export function adresseOuvrable(url: string): string | null {
  const brute = url.trim();
  if (!brute) return null;
  try {
    const u = new URL(brute.includes("://") ? brute : `https://${brute}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
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

/// Le coffre commun d'un lot d'éléments, s'il y en a un où l'on peut écrire.
///
/// RANGER EN LOT N'A DE SENS QUE DANS UN SEUL COFFRE
/// Les dossiers d'un coffre d'équipe ne sont pas ceux du coffre personnel, ni
/// ceux d'une autre équipe : un même chemin « Travail » désigne trois dossiers
/// différents. Un lot mêlé n'a donc pas de dossier commun à proposer, et le
/// geste n'est offert que s'il peut aboutir pour TOUS les éléments. Un seul
/// élément d'équipe en lecture seule suffit à l'écarter : sinon l'envoi
/// échouerait après le choix, ce qui est la pire façon de le dire.
export type CoffreDuLot = { type: "personnel" } | { type: "organisation"; orgId: string };

export function coffreDuLot(lot: VaultEntry[]): CoffreDuLot | null {
  if (lot.length === 0) return null;
  if (lot.every((i) => !i.shared)) return { type: "personnel" };
  const orgId = lot[0]!.shared?.orgId;
  if (!orgId) return null;
  const memeEquipe = lot.every((i) => i.shared?.orgId === orgId);
  const ecriture = lot.every((i) => i.shared?.permission === "write" || i.shared?.permission === "manage");
  return memeEquipe && ecriture ? { type: "organisation", orgId } : null;
}

/// Une ligne de la liste en vue arborescente : un dossier, ou un élément.
export type LigneArbre =
  | {
      type: "dossier";
      chemin: string;
      nom: string;
      profondeur: number;
      /// Les éléments du dossier et de ses sous-dossiers.
      total: number;
      deplie: boolean;
      aDesSousDossiers: boolean;
    }
  | { type: "element"; item: VaultEntry; profondeur: number };

/// Les lignes de la liste quand les dossiers y sont montrés en arbre.
///
/// LES DOSSIERS DANS LA LISTE, ET NON DANS LA BARRE
/// L'arbre vivait dans la barre latérale : une colonne étroite, où un nom de
/// dossier se tronquait vite et où trente dossiers repoussaient « Archives »
/// et « Corbeille » sous l'écran. Il passe dans la liste, comme chez Keeper :
/// un dossier est une ligne qui se déplie sur place, avec son compte.
///
/// À chaque niveau, les dossiers d'abord, puis les éléments : c'est l'ordre
/// d'un explorateur de fichiers, et un dossier noyé entre deux éléments ne se
/// retrouve plus. Les dossiers suivent l'ordre alphabétique (inversé quand la
/// liste est triée par nom de Z à A) ; les éléments suivent le tri choisi.
/// Un dossier replié ne rend que sa propre ligne.
export function lignesDeLArbre(racine: TreeNode, deplies: ReadonlySet<string>, ordre: Ordre): LigneArbre[] {
  const lignes: LigneArbre[] = [];
  const signe = ordre.critere === "nom" && ordre.sens === "desc" ? -1 : 1;
  const parcourir = (noeud: TreeNode, profondeur: number) => {
    const dossiers = [...noeud.children].sort((a, b) => signe * a.name.localeCompare(b.name));
    for (const d of dossiers) {
      const deplie = deplies.has(d.path);
      lignes.push({
        type: "dossier",
        chemin: d.path,
        nom: d.name,
        profondeur,
        total: countItems(d),
        deplie,
        aDesSousDossiers: d.children.length > 0,
      });
      if (deplie) parcourir(d, profondeur + 1);
    }
    for (const item of trierEntrees(noeud.items, ordre)) lignes.push({ type: "element", item, profondeur });
  };
  parcourir(racine, 0);
  return lignes;
}
