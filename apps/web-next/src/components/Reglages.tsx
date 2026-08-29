"use client";

// Le petit bloc flottant en bas à droite : thème et langue.
//
// Deux réglages qu'on change rarement mais qu'on doit pouvoir trouver sans
// chercher. Ghostcal les met là ; les mettre ailleurs ferait de GhostPass un
// produit qui se manipule autrement, ce qui est précisément ce qu'on corrige.

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Lune, Soleil } from "@/components/Icones";

const CLE = "gp_theme";

export function Reglages() {
  const { t } = useI18n();
  // Sombre par défaut : c'est le thème de la charte, et celui dans lequel le
  // produit a été dessiné. On ne lit `localStorage` qu'après le montage — au
  // rendu serveur il n'existe pas, et diverger entre les deux produit une
  // hydratation en conflit.
  const [clair, setClair] = useState(false);

  useEffect(() => {
    const veut = localStorage.getItem(CLE) === "light";
    setClair(veut);
    document.documentElement.dataset.theme = veut ? "light" : "dark";
  }, []);

  const basculer = () => {
    const suivant = !clair;
    setClair(suivant);
    localStorage.setItem(CLE, suivant ? "light" : "dark");
    document.documentElement.dataset.theme = suivant ? "light" : "dark";
  };

  return (
    <div className="verre fixed bottom-4 right-4 z-20 flex items-center gap-1 rounded-pill border border-border px-2 py-1.5 shadow-lg">
      <button
        type="button"
        onClick={basculer}
        // `aria-pressed` dit l'état, pas seulement l'action : l'icône seule est
        // ambiguë — un soleil veut-il dire « il fait clair » ou « passer au
        // clair » ?
        aria-pressed={clair}
        aria-label={clair ? t("app.darkMode") : t("app.lightMode")}
        title={clair ? t("app.darkMode") : t("app.lightMode")}
        className="cursor-pointer rounded-pill p-1.5 text-muted transition-colors hover:text-foreground"
      >
        {clair ? <Lune className="size-4" /> : <Soleil className="size-4" />}
      </button>
      <span className="h-4 w-px bg-border" />
      <LanguageSwitcher />
    </div>
  );
}
