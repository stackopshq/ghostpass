"use client";

// Le petit bloc flottant en bas à droite : thème et langue.
//
// Deux réglages qu'on change rarement mais qu'on doit pouvoir trouver sans
// chercher. Ghostcal les met là ; les mettre ailleurs ferait de GhostPass un
// produit qui se manipule autrement, ce qui est précisément ce qu'on corrige.

import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Lune, Soleil } from "@/components/Icones";

export const CLE_THEME = "gp_theme";

/**
 * La bascule de thème, **sans état React**.
 *
 * Elle en avait un, lu depuis `localStorage` dans un effet. Deux conséquences, dont
 * la seconde ne se voyait que chez les gens en thème clair :
 *
 * - le serveur rendait toujours le thème sombre, puisqu'il n'a pas de `localStorage`,
 *   et le client basculait après le premier rendu — **la page apparaissait sombre
 *   puis devenait claire**, à chaque chargement ;
 * - l'état ne servait qu'à choisir l'icône et le libellé, ce que le CSS sait faire.
 *
 * Le thème est donc posé sur `<html>` avant le premier rendu par le script du layout,
 * et le CSS choisit l'icône depuis `data-theme`. C'est la mécanique de ghostcal,
 * reprise telle quelle.
 *
 * Le libellé accessible suit le même chemin : chaque porteuse contient son texte
 * `sr-only`, et celle qui est en `display: none` sort de l'arbre d'accessibilité avec
 * son texte. Le nom du bouton change donc avec le thème sans une ligne de JavaScript —
 * ce qui remplace l'`aria-pressed` d'avant, lequel exigeait l'état qu'on vient de
 * supprimer.
 */
export function Reglages() {
  const { t } = useI18n();

  const basculer = () => {
    const racine = document.documentElement;
    const suivant = racine.dataset.theme === "light" ? "dark" : "light";
    racine.dataset.theme = suivant;
    try {
      localStorage.setItem(CLE_THEME, suivant);
    } catch {
      // Un navigateur qui refuse le stockage garde quand même le thème pour la
      // session : l'attribut est déjà posé. Seule la mémoire d'une visite à l'autre
      // est perdue, ce qui vaut mieux qu'une bascule qui échoue.
    }
  };

  return (
    <div className="verre fixed bottom-4 right-4 z-20 flex items-center gap-1 rounded-pill border border-border px-2 py-1">
      <button
        type="button"
        onClick={basculer}
        className="cursor-pointer rounded-pill p-1.5 text-muted transition-colors hover:text-foreground"
      >
        {/* Le soleil en thème sombre : l'icône dit où l'on va, pas où l'on est. */}
        <span className="icone-soleil">
          <Soleil className="size-4" />
          <span className="sr-only">{t("app.lightMode")}</span>
        </span>
        <span className="icone-lune">
          <Lune className="size-4" />
          <span className="sr-only">{t("app.darkMode")}</span>
        </span>
      </button>
      <span className="h-4 w-px bg-border" />
      <LanguageSwitcher />
    </div>
  );
}
