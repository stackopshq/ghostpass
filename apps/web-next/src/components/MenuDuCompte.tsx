"use client";

// Le menu du compte, en haut à droite : qui est connecté, et les gestes rares
// (sécurité du compte, import, export, verrouiller). Il était en tête de la
// barre latérale ; il est passé à droite de la barre du haut le 2026-11-24,
// là où Keeper et la plupart des applications le placent, et la barre
// latérale garde « Nouvel élément » à sa place.
//
// Ces gestes occupaient le pied de la barre en permanence : deux boutons
// d'import et d'export, leur avertissement, un badge et un bouton de
// verrouillage. Ils servent quelques fois par an, sauf le dernier ; rangés
// derrière le compte, ils rendent la place aux coffres et aux dossiers.

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Bouclier, Cadenas, Chevron, Clavier, Televerser } from "@/components/Icones";

export function MenuDuCompte({
  courriel,
  onSecurite,
  onImporter,
  onExporter,
  exportPossible,
  onRaccourcis,
  onVerrouiller,
}: {
  courriel: string | null;
  onSecurite: () => void;
  onImporter: () => void;
  onExporter: () => void;
  exportPossible: boolean;
  onRaccourcis: () => void;
  onVerrouiller: () => void;
}) {
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    const touche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Prise ici : sans `preventDefault`, les raccourcis du coffre
      // fermeraient aussi la fiche ouverte derrière le menu.
      e.preventDefault();
      setOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", touche);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", touche);
    };
  }, [ouvert]);

  const agir = (f: () => void) => () => {
    setOuvert(false);
    f();
  };

  const entree =
    "flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={racine} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        // L'adresse se cache sur un écran étroit : le nom accessible la garde,
        // avec l'état du coffre que dit la pastille.
        aria-label={`${courriel ?? ""} · ${t("app.unlocked")}`}
        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface"
      >
        {/* La pastille verte remplace le badge « Coffre déverrouillé » du pied
            de barre : elle reste visible en permanence, ce qui était sa raison
            d'être, sans prendre une ligne. */}
        <span className="relative grid size-8 shrink-0 place-items-center rounded-pill bg-accent/15 text-sm font-semibold text-accent">
          {(courriel ?? "?").charAt(0).toUpperCase()}
          <span
            className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-pill border-2 border-base bg-success"
            title={t("app.unlocked")}
          />
        </span>
        <span className="hidden max-w-56 truncate text-sm font-medium text-foreground lg:block">{courriel ?? ""}</span>
        <Chevron className={`size-4 shrink-0 text-muted transition-transform ${ouvert ? "-rotate-90" : "rotate-90"}`} />
      </button>

      {ouvert && (
        <div
          role="menu"
          className="verre-opaque absolute right-0 top-full z-50 mt-1 w-72 rounded border border-border p-1 shadow-lg"
        >
          {/* L'adresse en entier, et l'état du coffre : le bouton n'en montre
              qu'une partie, et rien du tout sur un écran étroit. */}
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium text-foreground">{courriel ?? ""}</p>
            <p className="text-2xs text-success">{t("app.unlocked")}</p>
          </div>
          <div className="mb-1 border-t border-border" />
          <button type="button" role="menuitem" className={entree} onClick={agir(onSecurite)}>
            <Bouclier className="size-4 shrink-0 text-muted" />
            {t("app.security")}
          </button>
          <div className="my-1 border-t border-border" />
          <button type="button" role="menuitem" className={entree} onClick={agir(onImporter)}>
            <Televerser className="size-4 shrink-0 text-muted" />
            {t("app.importCsv")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={entree}
            onClick={agir(onExporter)}
            disabled={!exportPossible}
          >
            <Televerser className="size-4 shrink-0 rotate-180 text-muted" />
            {t("app.exportCsv")}
          </button>
          {/* La portée de l'export reste dite à côté du geste : un fichier qui
              ne contient pas ce qu'on croyait se découvre trop tard. */}
          <p className="px-2.5 pb-1.5 text-2xs leading-snug text-muted">{t("app.exportPersonalOnly")}</p>
          <div className="my-1 border-t border-border" />
          <button type="button" role="menuitem" className={entree} onClick={agir(onRaccourcis)}>
            <Clavier className="size-4 shrink-0 text-muted" />
            {t("app.shortcuts")}
          </button>
          <button type="button" role="menuitem" className={entree} onClick={agir(onVerrouiller)}>
            <Cadenas className="size-4 shrink-0 text-muted" />
            {t("app.lock")}
          </button>
        </div>
      )}
    </div>
  );
}
