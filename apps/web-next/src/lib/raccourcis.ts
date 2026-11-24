// Les raccourcis clavier du coffre.
//
// La décision (« cette touche, à cet endroit, veut dire quoi ? ») est pure et
// vit ici, séparée de l'écouteur : c'est elle qui porte les pièges, et elle se
// teste sans navigateur.
//
// LES TOUCHES ÉCARTÉES, ET POURQUOI
// - Ctrl+Maj+C ouvre l'inspecteur dans Chrome et Firefox ; une page ne peut pas
//   le reprendre. La copie de l'identifiant passe donc par Alt+C.
// - Ctrl+N ouvre une fenêtre, et Chrome ne laisse aucune page l'intercepter :
//   « Nouvel élément » reste un bouton.
// - Alt+C se lit par `code` et non par `key` : sur macOS, Option+C produit
//   « ç », et le raccourci n'aurait jamais marché sur un Mac.

export type Action =
  | "chercher"
  | "suivant"
  | "precedent"
  | "copierMotDePasse"
  | "copierIdentifiant"
  | "verrouiller"
  | "echap"
  | "aide";

export interface Touche {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface Contexte {
  /// Le focus est dans un champ de saisie, une zone de texte ou un élément
  /// éditable : les lettres y sont du texte, pas des commandes.
  dansUnChamp: boolean;
  /// Le champ en question est la recherche du coffre, où les flèches
  /// parcourent les résultats au lieu de déplacer un curseur sur une ligne.
  dansLaRecherche: boolean;
  /// Du texte est sélectionné dans la page : Ctrl+C doit alors copier CE texte,
  /// comme partout ailleurs, et non un mot de passe que personne n'a désigné.
  texteSelectionne: boolean;
}

export function quelRaccourci(e: Touche, c: Contexte): Action | null {
  // Ctrl sur Windows et Linux, Cmd sur macOS : on accepte l'un ou l'autre
  // plutôt que de deviner le système depuis une chaîne d'agent.
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") return "chercher";
  if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") return "verrouiller";
  if (e.key === "Escape") return "echap";

  if (c.dansLaRecherche && !mod && !e.altKey) {
    if (e.key === "ArrowDown") return "suivant";
    if (e.key === "ArrowUp") return "precedent";
  }
  if (c.dansUnChamp) return null;

  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
    return c.texteSelectionne ? null : "copierMotDePasse";
  }
  if (e.altKey && !mod && !e.shiftKey && e.code === "KeyC") return "copierIdentifiant";
  if (mod || e.altKey) return null;

  if (e.key === "/") return "chercher";
  if (e.key === "?") return "aide";
  if (e.key === "ArrowDown") return "suivant";
  if (e.key === "ArrowUp") return "precedent";
  return null;
}

/// Le contexte, lu dans le document au moment de la touche.
export function contexteCourant(recherche: HTMLElement | null): Contexte {
  const actif = document.activeElement as HTMLElement | null;
  const balise = actif?.tagName;
  // Une case à cocher ou un bouton ont le focus après un clic : ce ne sont pas
  // des champs, et les flèches doivent continuer de parcourir la liste.
  const saisie =
    balise === "INPUT" &&
    !["checkbox", "radio", "button", "submit", "reset"].includes((actif as HTMLInputElement).type);
  return {
    dansUnChamp: saisie || balise === "TEXTAREA" || balise === "SELECT" || !!actif?.isContentEditable,
    dansLaRecherche: actif !== null && actif === recherche,
    texteSelectionne: (window.getSelection()?.toString() ?? "") !== "",
  };
}

/// Le nom de la touche de commande, pour l'affichage seulement.
export function toucheMod(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}

export function toucheAlt(): string {
  return toucheMod() === "⌘" ? "⌥" : "Alt";
}
