"use client";

// Le menu du compte, en tête de la barre latérale : qui est connecté, et les
// gestes rares (sécurité du compte, import, export, verrouiller).
//
// Ces gestes occupaient le pied de la barre en permanence : deux boutons
// d'import et d'export, leur avertissement, un badge et un bouton de
// verrouillage. Ils servent quelques fois par an, sauf le dernier ; rangés
// derrière le compte, ils rendent la place aux coffres et aux dossiers.

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Bouclier, Cadenas, Chevron, Televerser } from "@/components/Icones";

export function MenuDuCompte({
  courriel,
  onSecurite,
  onImporter,
  onExporter,
  exportPossible,
  onVerrouiller,
}: {
  courriel: string | null;
  onSecurite: () => void;
  onImporter: () => void;
  onExporter: () => void;
  exportPossible: boolean;
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
    const touche = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
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
    <div ref={racine} className="relative mb-4">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface"
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
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{courriel ?? ""}</span>
          <span className="block text-2xs text-success">{t("app.unlocked")}</span>
        </span>
        <Chevron className={`size-4 shrink-0 text-muted transition-transform ${ouvert ? "-rotate-90" : "rotate-90"}`} />
      </button>

      {ouvert && (
        <div
          role="menu"
          className="verre-opaque absolute left-0 right-0 top-full z-30 mt-1 rounded border border-border p-1 shadow-lg"
        >
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
          <button type="button" role="menuitem" className={entree} onClick={agir(onVerrouiller)}>
            <Cadenas className="size-4 shrink-0 text-muted" />
            {t("app.lock")}
          </button>
        </div>
      )}
    </div>
  );
}
