// Une couleur par organisation, la même sur tous les clients.
//
// Le repère visuel n'a d'intérêt que s'il est stable : si le web et iOS
// dérivent différemment, la même organisation prend deux couleurs selon
// l'appareil et le repère devient un piège. Le contrat ci-dessous est donc
// figé, vérifié des deux côtés (`ContractTests.swift`), et ne se change pas
// sans changer les deux clients ensemble.
//
// Deux mécanismes, à ne pas confondre :
//
//   — la COULEUR ATTRIBUÉE, dérivée de l'identifiant. Elle existe toujours,
//     n'est stockée nulle part, et suffit tant que personne n'a rien choisi ;
//   — la COULEUR CHOISIE, rangée dans un registre chiffré du coffre. Une clé
//     absente signifie « rien de choisi », pas « noir ».
//
// Le registre est partagé par le web, iOS et l'extension. C'est donc au
// LECTEUR d'être robuste : il finira par contenir ce qu'un seul des trois
// comprend, et une valeur incomprise doit retomber sur la couleur attribuée —
// jamais se rendre en noir, ce qui ferait passer une donnée illisible pour un
// choix délibéré.

/// Nom réservé de l'entrée qui porte le registre, dans le coffre personnel.
///
/// FIGÉ avec le client iOS : le changer ferait perdre à chacun les choix de
/// l'autre, sans erreur nulle part — les deux registres coexisteraient, chacun
/// invisible à l'autre.
///
/// Le NUL est ÉCHAPPÉ et non littéral, pour la raison notée sur ses deux
/// voisins dans `crypto.ts` : un octet nul brut fait classer le fichier comme
/// binaire et `grep` le saute alors sans rien dire.
///
/// Il vit ICI et non auprès d'eux parce que `crypto.ts` charge le WASM à
/// l'import et n'entre dans aucun harnais de test : la partie du contrat la
/// plus facile à casser en silence serait alors la seule non vérifiée.
export const ORG_COLORS_ITEM_NAME = "\u0000gp:orgcolors";

/// Les huit teintes du contrat, dans CET ordre : l'index est ce que la somme
/// des octets sélectionne. Réordonner la palette repeindrait toutes les
/// organisations de tous les clients.
export const PALETTE_ORG = [
  "#4C8DFF",
  "#B57BFF",
  "#00C2A8",
  "#FF8A3D",
  "#E75480",
  "#3FBF5F",
  "#FFC53D",
  "#7A8CFF",
] as const;

/// Le registre tel qu'il vit dans le coffre : un objet PLAT `{ orgId: "#RRGGBB" }`.
/// Pas d'enveloppe, pas de champ de version, pas de tableau — c'est la forme
/// qu'iOS écrit et la seule qu'il lit.
export type RegistreCouleurs = Record<string, string>;

const FORME = /^#[0-9a-fA-F]{6}$/;

/// Une couleur exploitable, c'est un `#RRGGBB` à six chiffres et rien d'autre.
///
/// La forme courte `#ABC` est refusée bien que CSS la comprenne : iOS ne la
/// produit pas et ne la lit pas, et l'accepter ici créerait une valeur qu'un
/// seul client saurait rendre.
export function estCouleurValide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && FORME.test(valeur);
}

/// Une seule orthographe, décidée à la frontière.
///
/// `#4c8dff` et `#4C8DFF` sont la même couleur ; garder les deux obligerait
/// chaque écran à le savoir pour cocher la bonne pastille. On tolère les deux
/// en lecture — un autre client peut écrire en minuscules — et on n'en garde
/// qu'une en mémoire. La couleur affichée est inchangée.
function normaliser(couleur: string): string {
  return couleur.toUpperCase();
}

/// La couleur attribuée à un identifiant, à défaut de choix.
///
/// Somme des OCTETS UTF-8 de l'identifiant, modulo la taille de la palette.
/// Bien les octets, pas les points de code : la différence est invisible sur
/// tout identifiant ASCII — donc invisible sur les quatre vecteurs du contrat —
/// et n'apparaît que sur un identifiant accentué, où un client écrit avec
/// `charCodeAt` rendrait une autre couleur qu'iOS sans que rien ne l'annonce.
export function couleurAttribuee(orgId: string): string {
  const octets = new TextEncoder().encode(orgId);
  let somme = 0;
  for (const octet of octets) somme += octet;
  return PALETTE_ORG[somme % PALETTE_ORG.length]!;
}

/// Normalise ce qui sort du registre déchiffré, quoi que ce soit.
///
/// Tout ce qui n'est pas une paire `identifiant → #RRGGBB` est écarté en
/// silence : un registre à moitié compréhensible reste utile, alors qu'une
/// erreur ferait échouer le chargement des organisations pour une question
/// de teinte.
export function lireRegistreCouleurs(brut: unknown): RegistreCouleurs {
  if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return {};
  const registre: RegistreCouleurs = {};
  for (const [orgId, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (estCouleurValide(valeur)) registre[orgId] = normaliser(valeur);
  }
  return registre;
}

/// La couleur à afficher : celle qui a été choisie, sinon celle qui est attribuée.
export function couleurOrg(registre: RegistreCouleurs, orgId: string): string {
  const choisie = registre[orgId];
  return estCouleurValide(choisie) ? normaliser(choisie) : couleurAttribuee(orgId);
}

/// Enregistre un choix. Rend un NOUVEAU registre — l'appelant tient le sien
/// dans un état React, et le muter en place ne redessinerait rien.
///
/// Une valeur invalide est ignorée : l'écrivain n'a pas à être parfait, mais
/// il n'a aucune raison d'ajouter sciemment ce que les autres clients devront
/// écarter.
export function definirCouleur(
  registre: RegistreCouleurs,
  orgId: string,
  couleur: string,
): RegistreCouleurs {
  if (!estCouleurValide(couleur)) return { ...registre };
  return { ...registre, [orgId]: normaliser(couleur) };
}

/// Retire un choix : l'organisation revient à sa couleur attribuée.
export function effacerCouleur(registre: RegistreCouleurs, orgId: string): RegistreCouleurs {
  const suivant = { ...registre };
  delete suivant[orgId];
  return suivant;
}
