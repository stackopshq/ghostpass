"use client";

// Le verrouillage automatique et l'effacement du presse-papiers.
//
// Deux réglages de l'APPAREIL, pas du compte : un ordinateur partagé au bureau
// et un portable personnel n'appellent pas le même délai. Ils vivent donc dans
// `localStorage`, à côté du thème et de la langue, et ne partent jamais au
// serveur.
//
// 1Password et Dashlane verrouillent après un temps d'inactivité, et 1Password
// vide le presse-papiers 90 secondes après une copie. GhostPass ne faisait ni
// l'un ni l'autre : un coffre ouvert le restait tant que l'onglet vivait, et un
// mot de passe copié restait collable n'importe où, sans limite.

import { useEffect, useRef } from "react";

export const CLE_VERROU = "gp_verrou_minutes";
export const CLE_PRESSE_PAPIERS = "gp_presse_papiers_secondes";

/// En minutes ; 0 veut dire « jamais ».
export const DELAIS_VERROU = [5, 15, 60, 0] as const;
/// En secondes ; 0 veut dire « jamais ».
export const DELAIS_PRESSE_PAPIERS = [30, 90, 0] as const;

export const VERROU_PAR_DEFAUT = 15;
export const PRESSE_PAPIERS_PAR_DEFAUT = 90;

/// Lit un réglage, et retombe sur le défaut pour tout ce qui n'est pas une
/// valeur proposée. Une valeur bricolée à la main dans le stockage (« 0.001 »,
/// « -1 ») ne doit ni verrouiller en boucle ni désactiver le verrou en silence.
export function lireReglage(brut: string | null, permis: readonly number[], defaut: number): number {
  // `Number("")` vaut 0, donc « jamais » : une valeur vide désactiverait le
  // verrou sans que personne l'ait choisi. On n'accepte que des chiffres.
  if (brut === null || !/^\d+$/.test(brut)) return defaut;
  const n = Number(brut);
  return permis.includes(n) ? n : defaut;
}

export function lire(cle: string, permis: readonly number[], defaut: number): number {
  try {
    return lireReglage(localStorage.getItem(cle), permis, defaut);
  } catch {
    // Stockage refusé (navigation privée stricte) : le défaut, qui protège.
    return defaut;
  }
}

export function ecrire(cle: string, valeur: number): void {
  try {
    localStorage.setItem(cle, String(valeur));
  } catch {
    // Le réglage ne survivra pas à la visite ; il vaut pour celle-ci, puisque
    // chaque lecture passe par `lire` au moment d'agir.
  }
}

/// Faut-il verrouiller ? Pure, pour qu'un test tienne les deux sens.
export function doitVerrouiller(maintenant: number, derniereActivite: number, minutes: number): boolean {
  if (minutes <= 0) return false;
  return maintenant - derniereActivite >= minutes * 60_000;
}

/// Verrouille le coffre après le délai d'inactivité choisi.
///
/// LE TEMPS SE MESURE, IL NE SE MINUTE PAS
/// Un `setTimeout` de quinze minutes serait la forme évidente, et elle est
/// fausse : un navigateur ralentit les minuteurs d'un onglet en arrière-plan,
/// et un ordinateur en veille ne les fait pas avancer du tout. On retient donc
/// l'HEURE de la dernière activité, et on compare à chaque occasion : un tic
/// régulier, et surtout le retour sur l'onglet, qui est le moment où quelqu'un
/// d'autre pourrait trouver le coffre ouvert.
export function useVerrouAuto(verrouiller: () => void): void {
  const derniere = useRef(Date.now());
  const rappel = useRef(verrouiller);
  rappel.current = verrouiller;

  useEffect(() => {
    // UNE SEULE FOIS
    // Le tic, le retour de focus et le geste peuvent tous constater le délai
    // avant que React ait démonté l'écran. Verrouiller deux fois libère deux
    // fois les clés du WebAssembly, qui lève « null pointer passed to rust » :
    // mesuré en avançant l'horloge d'un navigateur de quinze minutes.
    let verrouille = false;
    const verifier = () => {
      if (verrouille) return;
      if (doitVerrouiller(Date.now(), derniere.current, lire(CLE_VERROU, DELAIS_VERROU, VERROU_PAR_DEFAUT))) {
        verrouille = true;
        rappel.current();
      }
    };
    // Vérifier AVANT d'enregistrer l'activité : le premier geste au retour
    // d'une longue absence ne doit pas remettre le compteur à zéro avant
    // d'avoir été comparé.
    const activite = () => {
      verifier();
      derniere.current = Date.now();
    };
    const visibilite = () => {
      if (document.visibilityState === "visible") verifier();
    };
    const evenements = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of evenements) window.addEventListener(e, activite, { passive: true });
    document.addEventListener("visibilitychange", visibilite);
    window.addEventListener("focus", verifier);
    const tic = setInterval(verifier, 15_000);
    return () => {
      for (const e of evenements) window.removeEventListener(e, activite);
      document.removeEventListener("visibilitychange", visibilite);
      window.removeEventListener("focus", verifier);
      clearInterval(tic);
    };
  }, []);
}

// ─── Le presse-papiers ───

let effacementPrevu: ReturnType<typeof setTimeout> | null = null;
let enAttenteDuFocus = false;

/// Vide le presse-papiers si l'onglet a la main, sinon dès qu'il la reprend.
///
/// LE NAVIGATEUR NE LAISSE ÉCRIRE QU'À L'ONGLET ACTIF
/// `clipboard.writeText` échoue si la page n'a pas le focus, et c'est le cas
/// normal : on copie un mot de passe pour aller le coller AILLEURS. L'effacement
/// attend donc le retour sur l'onglet.
///
/// Ce qu'on ne peut pas vérifier : si le presse-papiers contient encore NOTRE
/// texte. Le relire (`readText`) déclencherait une demande d'autorisation à
/// chaque fois. Comme 1Password, on vide sans regarder ; quelqu'un qui a copié
/// autre chose entre-temps le perd, et c'est le prix d'un secret qui ne traîne
/// pas.
function effacer(): void {
  effacementPrevu = null;
  if (document.hasFocus()) {
    enAttenteDuFocus = false;
    navigator.clipboard.writeText("").catch(() => undefined);
    return;
  }
  if (enAttenteDuFocus) return;
  enAttenteDuFocus = true;
  window.addEventListener(
    "focus",
    () => {
      if (!enAttenteDuFocus) return;
      enAttenteDuFocus = false;
      navigator.clipboard.writeText("").catch(() => undefined);
    },
    { once: true },
  );
}

/// Copie, puis programme l'effacement selon le réglage. Toute copie de
/// l'application passe par ici : un identifiant, un code de récupération et un
/// lien de partage (qui porte sa clé) sont tous des secrets une fois collés
/// dans le mauvais champ.
export async function copierPuisEffacer(texte: string): Promise<void> {
  await navigator.clipboard.writeText(texte);
  // Une nouvelle copie remplace la précédente : son délai repart de zéro, et
  // un retour sur l'onglet ne doit plus effacer ce qu'on vient de copier.
  if (effacementPrevu) clearTimeout(effacementPrevu);
  enAttenteDuFocus = false;
  const secondes = lire(CLE_PRESSE_PAPIERS, DELAIS_PRESSE_PAPIERS, PRESSE_PAPIERS_PAR_DEFAUT);
  if (secondes > 0) effacementPrevu = setTimeout(effacer, secondes * 1000);
}

/// Au verrouillage, un effacement prévu n'attend pas son heure : le coffre
/// fermé ne doit pas laisser derrière lui le dernier secret copié.
export function effacerSiPrevu(): void {
  if (effacementPrevu === null && !enAttenteDuFocus) return;
  if (effacementPrevu) clearTimeout(effacementPrevu);
  effacer();
}
