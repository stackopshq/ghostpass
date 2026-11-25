"use client";

// Un petit menu déroulant de choix cochés, en tête de liste : le tri et le
// filtre « Afficher ». Les deux avaient le même besoin (une valeur écrite sur
// le bouton, des options cochées, Échap et les flèches), donc un seul menu.
//
// POURQUOI UN MENU ICI
// La charte veut des boutons pour un choix à deux ou trois valeurs, qui reste
// ainsi visible sans clic. Le tri en a quatre (deux critères, deux sens), le
// filtre quatre aussi, et les boutons ne tiennent pas dans la colonne de la
// liste. La valeur choisie reste écrite sur le bouton, ce qui garde l'état
// visible.
//
// Le menu est en `absolute` sous son bouton, sans portail : il s'ouvre en tête
// de liste, vers le bas, dans le panneau. Rien ne le rogne, contrairement au
// menu d'une ligne (`MenuEntree.tsx`).

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Coche } from "@/components/Icones";

export interface OptionDeMenu {
  libelle: string;
  coche: boolean;
  agir: () => void;
}

export interface GroupeDeMenu {
  /// Absent : un groupe sans titre, quand le bouton dit déjà de quoi il s'agit.
  titre?: string;
  options: OptionDeMenu[];
}

export function MenuChoix({
  icone,
  valeur,
  nom,
  groupes,
  enAvant = false,
}: {
  icone: ReactNode;
  /// Ce que le bouton écrit : la valeur choisie.
  valeur: string;
  /// Le nom du menu, pour le lecteur d'écran et l'infobulle.
  nom: string;
  groupes: GroupeDeMenu[];
  /// Un choix qui n'est pas le défaut, et qui cache donc des éléments : le
  /// bouton prend la couleur d'accent pour qu'on ne l'oublie pas.
  enAvant?: boolean;
}) {
  const id = useId();
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

  const option = (o: OptionDeMenu) => (
    <button
      key={o.libelle}
      type="button"
      role="menuitemradio"
      aria-checked={o.coche}
      onClick={() => {
        o.agir();
        fermer(true);
      }}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface focus:bg-surface focus:outline-none"
    >
      {/* La coche garde sa place même absente : sans elle, les libellés
          sauteraient d'un cran à chaque choix. */}
      <Coche className={`size-4 shrink-0 text-accent ${o.coche ? "" : "invisible"}`} />
      {o.libelle}
    </button>
  );

  return (
    <div ref={racine} className="relative shrink-0">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={`${nom} : ${valeur}`}
        title={nom}
        className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-2xs transition-colors hover:bg-surface ${ouvert ? "bg-surface text-foreground" : enAvant ? "bg-accent/12 text-accent" : "text-muted hover:text-foreground"}`}
      >
        {icone}
        {valeur}
      </button>
      {ouvert && (
        <div
          ref={menu}
          role="menu"
          aria-label={nom}
          onKeyDown={auClavier}
          className="verre-opaque absolute right-0 top-full z-30 mt-1 min-w-56 rounded border border-border p-1 shadow-lg"
        >
          {groupes.map((g, n) => (
            <div key={n}>
              {n > 0 && <div className="my-1 border-t border-border" />}
              <div role="group" aria-labelledby={g.titre ? `${id}-${n}` : undefined} aria-label={g.titre ? undefined : nom}>
                {g.titre && (
                  <p id={`${id}-${n}`} className="px-2.5 pb-1 pt-1.5 text-2xs text-muted">
                    {g.titre}
                  </p>
                )}
                {g.options.map(option)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
