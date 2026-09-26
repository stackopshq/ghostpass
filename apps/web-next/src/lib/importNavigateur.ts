// Lire l'export de mots de passe d'un navigateur, sans rien en dire à personne.
//
// CE QUE CE FICHIER GARANTIT
// --------------------------
// 1. Tout se passe ici, dans l'onglet. Ce module ne connaît ni `fetch`, ni le
//    DOM, ni le jeton de session : il transforme une chaîne en entrées, et
//    l'appelant les chiffre AVANT de les envoyer. Un import qui déposerait le
//    fichier sur le serveur pour le découper là-bas donnerait au serveur la
//    liste en clair des mots de passe de la personne, ce que tout le produit
//    est construit pour rendre impossible.
// 2. Aucune valeur ne sort d'ici autrement que dans une entrée à chiffrer. Le
//    compte rendu ne transporte que des NOMBRES et des numéros d'entrée : pas
//    une adresse, pas un identifiant, jamais un mot de passe. C'est ce qui
//    permet d'afficher un motif de rejet, de le lire au support, ou de le
//    laisser filer dans une console, sans conséquence.
//
// Le découpage des colonnes, lui, n'est pas refait : il vit dans
// `lib/export.ts`, partagé avec les imports 1Password / Bitwarden / Proton et
// avec l'application iOS. Un second tableau d'alias aurait divergé du premier.

import { parseCsvDetaille } from "@/lib/csv";
import { depuisLigneCsv } from "@/lib/export";

/// Les familles d'export qu'on sait reconnaître à leurs seuls en-têtes.
///
/// « chromium » et non « chrome » : Chrome, Edge, Brave, Vivaldi et Opera
/// écrivent le MÊME fichier, aux mêmes colonnes anglaises quelle que soit la
/// langue de l'interface. Prétendre distinguer Edge de Chrome serait inventer
/// une information que le fichier ne porte pas, et l'écran d'import n'a pas
/// besoin de la connaître pour faire son travail.
export type Navigateur = "chromium" | "firefox" | "safari" | "autre";

/// Pourquoi une entrée n'est pas entrée dans le coffre.
///
/// Un import qui annonce « 312 entrées importées » quand il en a lu 340 est un
/// import raté qui se présente comme un succès. Chaque rejet a donc un motif,
/// et chaque motif est montré.
export type MotifIgnore =
  /// Nombre de cellules incohérent avec l'en-tête : guillemet non refermé,
  /// fichier tronqué, séparateur exotique.
  | "illisible"
  /// Ni adresse, ni nom, ni identifiant : rien pour retrouver l'entrée ensuite.
  | "sansIdentifiant"
  /// Ni mot de passe, ni code à usage unique, ni note : rien à protéger.
  | "sansSecret"
  /// Strictement identique à une entrée précédente du même fichier.
  | "doublonFichier"
  /// Strictement identique à une entrée déjà présente dans le coffre.
  | "doublonCoffre";

export type Ignoree = { numero: number; motif: MotifIgnore };

export type EntreeImportable = ReturnType<typeof depuisLigneCsv>;

/// Ce qu'on sait d'un fichier avant d'avoir rien écrit dans le coffre.
export type Analyse = {
  navigateur: Navigateur;
  /// Vrai dès qu'une colonne de mot de passe existe. Faux pour un CSV qui n'a
  /// rien à voir : mieux vaut le dire d'un mot que d'égrener trois cents rejets.
  formatReconnu: boolean;
  /// Enregistrements de données lus, en-tête exclue.
  lues: number;
  aImporter: EntreeImportable[];
  ignorees: Ignoree[];
  /// Entrées retenues dont le mot de passe est vide. Elles ne sont PAS rejetées
  /// (une note ou un code peut valoir la peine d'être gardé) mais l'utilisateur
  /// doit l'apprendre au moment de l'import, pas le jour où il en a besoin.
  sansMotDePasse: number;
};

/// Colonnes dont la valeur ne doit jamais être rognée.
///
/// Une espace en tête ou en fin de mot de passe est significative, et la retirer
/// fabrique un secret faux sans le moindre message. La panne se manifeste des
/// semaines plus tard, à une connexion refusée, très loin de l'import.
const NE_PAS_ROGNER = new Set([
  "password",
  "login_password",
  "notes",
  "note",
  "extra",
  "comments",
]);

/// Les colonnes de Chrome et de ses dérivés, au complet.
/// Chrome 106 et au-delà écrit `name,url,username,password,note` ; les versions
/// antérieures s'arrêtaient à `password`.
const CHROMIUM = new Set(["name", "url", "username", "password", "note"]);

/// Safari écrit `Title,URL,Username,Password,Notes,OTPAuth`.
/// Très proche de 1Password (`Title,Url,Username,Password,OTPAuth,Tags,Notes`),
/// dont il ne se distingue QUE par l'absence de `tags`, `favorite`, `archived`.
/// D'où la comparaison par ensemble fermé, et non par colonnes présentes.
const SAFARI = new Set(["title", "url", "username", "password", "notes", "otpauth"]);

/// Colonnes que Firefox est seul à écrire. Son export n'a AUCUNE colonne de nom
/// (`"url","username","password","httpRealm","formActionOrigin","guid",...`) :
/// c'est ce qui rendrait, sans la dérivation plus bas, un coffre entier nommé
/// « (sans nom) ».
const MARQUEURS_FIREFOX = [
  "httprealm",
  "formactionorigin",
  "guid",
  "timecreated",
  "timelastused",
  "timepasswordchanged",
];

/// Toutes les orthographes de la colonne « mot de passe » qu'on sait lire.
const COLONNES_MOT_DE_PASSE = ["password", "login_password"];

export function detecterNavigateur(entetes: string[]): Navigateur {
  const vus = new Set(entetes);
  const a = (h: string) => vus.has(h);
  const base = a("url") && a("username") && a("password");

  // Firefox en premier : ses colonnes techniques ne se retrouvent nulle part
  // ailleurs, donc le test est sûr et dispense d'arbitrer les cas suivants.
  if (base && MARQUEURS_FIREFOX.some(a)) return "firefox";
  if (base && a("name") && entetes.every((h) => CHROMIUM.has(h))) return "chromium";
  if (
    a("title") &&
    a("url") &&
    a("username") &&
    a("password") &&
    (a("notes") || a("otpauth")) &&
    entetes.every((h) => SAFARI.has(h))
  ) {
    return "safari";
  }
  return "autre";
}

/// Un nom lisible tiré d'une adresse, quand le fichier n'en fournit pas.
///
/// Firefox n'exporte pas de nom. Sans cette dérivation, un coffre importé depuis
/// Firefox est une liste de plusieurs centaines d'entrées toutes appelées
/// « (sans nom) » : techniquement un import réussi, pratiquement un coffre
/// inutilisable, et le genre de résultat qui fait revenir en arrière.
///
/// Écrit à la main plutôt qu'avec `new URL()` : les identifiants d'application
/// Android exportés par Chrome (`android://<empreinte>@com.exemple/`) ne sont
/// pas des URL valides pour le navigateur, et sont pourtant de vraies entrées.
export function nomDepuisUrl(url: string): string {
  let s = url.trim();
  if (s === "") return "";
  const schema = s.indexOf("://");
  if (schema !== -1) s = s.slice(schema + 3);
  // L'hôte s'arrête au premier chemin, paramètre ou ancre.
  s = s.split(/[/?#]/)[0] ?? "";
  // `utilisateur:motdepasse@hote` et `<empreinte>@com.exemple` : ce qui compte
  // est après le dernier `@`.
  const arobase = s.lastIndexOf("@");
  if (arobase !== -1) s = s.slice(arobase + 1);
  // Le port, mais pas les deux-points d'une IPv6 entre crochets.
  if (!s.startsWith("[")) s = s.split(":")[0] ?? "";
  return s.replace(/^www\./i, "");
}

/// La clé qui fait qu'une entrée est « la même » qu'une autre.
///
/// Le mot de passe EN FAIT PARTIE, et c'est délibéré : deux lignes de même
/// adresse et même identifiant mais de mots de passe différents sont deux
/// informations distinctes, dont l'une est peut-être la seule à jour. Les
/// confondre ferait perdre silencieusement un secret, ce qu'un doublon n'est
/// jamais censé coûter. On ne rejette donc que le strictement redondant.
///
/// Les adresses comptent TOUTES dans la clé, et dans l'ordre où elles sont
/// écrites. Ne retenir que la première ferait passer pour un doublon une entrée
/// qui porte une adresse de plus — et la rejeter perdrait cette adresse-là,
/// c'est-à-dire exactement ce que ce changement entier vient fermer.
function cle(e: { urls?: readonly string[]; username?: string; password?: string }): string {
  const adresses = (e.urls ?? [])
    .map((u) => u.trim().toLowerCase().replace(/\/+$/, ""))
    .join(" ");
  return `${adresses} ${e.username ?? ""} ${e.password ?? ""}`;
}

/// Lire le fichier et dire, entrée par entrée, ce qui entrera et ce qui non.
///
/// Rien n'est écrit ici : la fonction ne fait que décider. C'est ce qui permet
/// de montrer le compte rendu AVANT de toucher au coffre, et donc de refuser
/// un import dont le bilan ne plaît pas.
export function analyser(
  texte: string,
  dejaPresentes: readonly { urls?: readonly string[]; username?: string; password?: string }[],
  sansNom: string,
): Analyse {
  const { entetes, lignes } = parseCsvDetaille(texte);
  const navigateur = detecterNavigateur(entetes);
  const formatReconnu = COLONNES_MOT_DE_PASSE.some((c) => entetes.includes(c));

  const connues = new Set(dejaPresentes.map(cle));
  const vues = new Set<string>();
  const aImporter: EntreeImportable[] = [];
  const ignorees: Ignoree[] = [];
  let sansMotDePasse = 0;

  for (const ligne of lignes) {
    if (!ligne.conforme) {
      ignorees.push({ numero: ligne.numero, motif: "illisible" });
      continue;
    }

    const champs: Record<string, string> = {};
    for (const [k, v] of Object.entries(ligne.champs)) {
      champs[k] = NE_PAS_ROGNER.has(k) ? v : v.trim();
    }
    const brut = depuisLigneCsv(champs, "");

    if (brut.urls.length === 0 && brut.name === "" && brut.username === "") {
      ignorees.push({ numero: ligne.numero, motif: "sansIdentifiant" });
      continue;
    }
    if (brut.password === "" && brut.totp === "" && brut.note === "") {
      ignorees.push({ numero: ligne.numero, motif: "sansSecret" });
      continue;
    }

    const k = cle(brut);
    if (vues.has(k)) {
      ignorees.push({ numero: ligne.numero, motif: "doublonFichier" });
      continue;
    }
    if (connues.has(k)) {
      ignorees.push({ numero: ligne.numero, motif: "doublonCoffre" });
      continue;
    }
    vues.add(k);

    if (brut.password === "") sansMotDePasse++;
    // Le nom se dérive de la PREMIÈRE adresse : c'est une étiquette pour la
    // liste, pas une donnée à conserver. Les autres adresses restent dans
    // l'entrée, elles n'ont simplement rien à faire dans son nom.
    aImporter.push({ ...brut, name: brut.name || nomDepuisUrl(brut.urls[0] ?? "") || sansNom });
  }

  return { navigateur, formatReconnu, lues: lignes.length, aImporter, ignorees, sansMotDePasse };
}

/// Le décompte par motif, dans un ordre stable, pour l'affichage.
export function parMotif(ignorees: readonly Ignoree[]): { motif: MotifIgnore; n: number }[] {
  const ordre: MotifIgnore[] = [
    "doublonCoffre",
    "doublonFichier",
    "sansSecret",
    "sansIdentifiant",
    "illisible",
  ];
  return ordre
    .map((motif) => ({ motif, n: ignorees.filter((i) => i.motif === motif).length }))
    .filter((x) => x.n > 0);
}
