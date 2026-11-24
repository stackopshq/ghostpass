"use client";

// Le menu de tri de la liste : un critère et un sens, chacun coché.
//
// POURQUOI UN MENU ICI
// La charte veut des boutons pour un choix à deux ou trois valeurs, qui reste
// ainsi visible sans clic. Le tri en a quatre (deux critères, deux sens), et
// les quatre boutons ne tiennent pas dans la colonne de la liste. Le critère
// choisi reste écrit sur le bouton, ce qui garde l'état visible.
//
// Le menu est en `absolute` sous son bouton, sans portail : il s'ouvre en tête
// de liste, vers le bas, dans le panneau. Rien ne le rogne, contrairement au
// menu d'une ligne (`MenuEntree.tsx`).

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CRITERES, sensNaturel, type Ordre, type Sens } from "@/lib/vault";
import { Coche, Tri } from "@/components/Icones";

const LIBELLE_CRITERE = { nom: "app.sortName", modification: "app.sortModified" } as const;
const LIBELLE_SENS = {
  nom: { asc: "app.sortAZ", desc: "app.sortZA" },
  modification: { desc: "app.sortNewest", asc: "app.sortOldest" },
} as const;

export function MenuTri({ ordre, onOrdre }: { ordre: Ordre; onOrdre: (o: Ordre) => void }) {
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const fermer = (rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) bouton.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return;
    // Le focus va sur l'option cochée : au clavier, on part de l'état actuel.
    menu.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [ouvert]);

  const auClavier = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      // Prise ici : sans `preventDefault`, les raccourcis du coffre fermeraient
      // aussi la fiche ouverte.
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const pas = e.key === "ArrowDown" ? 1 : -1;
      items[(i + pas + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOuvert(false);
    }
  };

  const choisir = (o: Ordre) => {
    onOrdre(o);
    fermer(true);
  };

  const option = (coche: boolean, libelle: string, agir: () => void) => (
    <button
      key={libelle}
      type="button"
      role="menuitemradio"
      aria-checked={coche}
      onClick={agir}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface focus:bg-surface focus:outline-none"
    >
      {/* La coche garde sa place même absente : sans elle, les libellés
          sauteraient d'un cran à chaque choix. */}
      <Coche className={`size-4 shrink-0 text-accent ${coche ? "" : "invisible"}`} />
      {libelle}
    </button>
  );

  const titreDeGroupe = "px-2.5 pb-1 pt-1.5 text-2xs text-muted";

  return (
    <div ref={racine} className="relative shrink-0">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={`${t("app.sortBy")} : ${t(LIBELLE_CRITERE[ordre.critere])}, ${t(LIBELLE_SENS[ordre.critere][ordre.sens])}`}
        title={t("app.sortBy")}
        className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-2xs transition-colors hover:bg-surface hover:text-foreground ${ouvert ? "bg-surface text-foreground" : "text-muted"}`}
      >
        <Tri className="size-3.5" />
        {t(LIBELLE_CRITERE[ordre.critere])}
      </button>
      {ouvert && (
        <div
          ref={menu}
          role="menu"
          aria-label={t("app.sortBy")}
          onKeyDown={auClavier}
          className="verre-opaque absolute right-0 top-full z-30 mt-1 min-w-56 rounded border border-border p-1 shadow-lg"
        >
          <div role="group" aria-labelledby="tri-critere">
            <p id="tri-critere" className={titreDeGroupe}>
              {t("app.sortBy")}
            </p>
            {CRITERES.map((c) =>
              option(ordre.critere === c, t(LIBELLE_CRITERE[c]), () =>
                choisir(c === ordre.critere ? ordre : { critere: c, sens: sensNaturel(c) }),
              ),
            )}
          </div>
          <div className="my-1 border-t border-border" />
          <div role="group" aria-labelledby="tri-sens">
            <p id="tri-sens" className={titreDeGroupe}>
              {t("app.sortOrder")}
            </p>
            {(Object.keys(LIBELLE_SENS[ordre.critere]) as Sens[]).map((s) =>
              option(ordre.sens === s, t(LIBELLE_SENS[ordre.critere][s]), () =>
                choisir({ critere: ordre.critere, sens: s }),
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
