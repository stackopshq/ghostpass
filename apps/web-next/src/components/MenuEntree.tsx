"use client";

// Le menu « … » d'une ligne de la liste : les gestes courants sur un élément
// sans avoir à l'ouvrir. Copier un mot de passe demandait deux clics et un
// changement de fiche ; 1Password et Dashlane le font depuis la liste.
//
// RENDU HORS DE LA LISTE
// La liste vit dans un panneau `verre-dense`, donc sous un `backdrop-filter`,
// qui capture les éléments en `position: fixed` (voir `ImportNavigateur.tsx`).
// Le menu passe par un portail et se place d'après le bouton qui l'ouvre.
// Un menu en `absolute` dans la ligne aurait été rogné par le défilement de la
// liste sur les dernières lignes, précisément celles où il s'ouvre vers le bas.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { PointsDeSuite } from "@/components/Icones";

export interface EntreeDeMenu {
  cle: string;
  libelle: string;
  icone: ReactNode;
  agir: () => void;
  danger?: boolean;
}

export function MenuEntree({
  nom,
  entrees,
  libelle,
}: {
  nom: string;
  entrees: EntreeDeMenu[];
  /// Le nom du menu pour un lecteur d'écran ; « Actions pour <nom> » sinon.
  libelle?: string;
}) {
  const { t } = useI18n();
  const nomDuMenu = libelle ?? t("app.itemActions", { name: nom });
  const [ouvert, setOuvert] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const fermer = (rendreLeFocus: boolean) => {
    setOuvert(false);
    setPlace(null);
    if (rendreLeFocus) bouton.current?.focus();
  };

  // La place se calcule une fois le menu rendu, quand sa hauteur est connue :
  // sous le bouton s'il y tient, au-dessus sinon.
  useLayoutEffect(() => {
    if (!ouvert || !bouton.current || !menu.current) return;
    const b = bouton.current.getBoundingClientRect();
    const h = menu.current.offsetHeight;
    const dessous = b.bottom + 4 + h <= window.innerHeight - 8;
    setPlace({
      top: dessous ? b.bottom + 4 : Math.max(8, b.top - 4 - h),
      right: window.innerWidth - b.right,
    });
  }, [ouvert]);

  // Le focus attend que le menu soit placé : tant qu'il est mesuré, il est en
  // `visibility: hidden`, et un élément caché ne prend pas le focus. Le donner
  // dans l'effet de mesure le perdait sans erreur (vu au navigateur).
  useEffect(() => {
    if (place) menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [place]);

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (!menu.current?.contains(cible) && !bouton.current?.contains(cible)) fermer(false);
    };
    // Le menu est placé une fois pour toutes : si la liste défile, il
    // resterait suspendu loin de sa ligne. Il se ferme plutôt.
    const defile = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) fermer(false);
    };
    document.addEventListener("mousedown", dehors);
    window.addEventListener("scroll", defile, true);
    window.addEventListener("resize", defile);
    return () => {
      document.removeEventListener("mousedown", dehors);
      window.removeEventListener("scroll", defile, true);
      window.removeEventListener("resize", defile);
    };
  }, [ouvert]);

  const auClavier = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      // `preventDefault` dit aux raccourcis du coffre que la touche est prise :
      // sans lui, la même Échap fermerait aussi la fiche ouverte derrière.
      e.preventDefault();
      e.stopPropagation();
      fermer(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const pas = e.key === "ArrowDown" ? 1 : -1;
      items[(i + pas + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      fermer(false);
    }
  };

  if (entrees.length === 0) return null;

  return (
    <>
      <button
        ref={bouton}
        type="button"
        onClick={() => (ouvert ? fermer(false) : setOuvert(true))}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={nomDuMenu}
        title={nomDuMenu}
        // Discret comme la case à cocher : visible au survol, au focus, et
        // tant que le menu est ouvert.
        className={`shrink-0 cursor-pointer rounded-lg p-1.5 text-muted transition-opacity hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 ${ouvert ? "bg-surface-2 text-foreground opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <PointsDeSuite className="size-4" />
      </button>
      {ouvert &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={nomDuMenu}
            onKeyDown={auClavier}
            style={place ? { top: place.top, right: place.right } : { top: 0, right: 0, visibility: "hidden" }}
            className="verre-opaque fixed z-50 min-w-52 rounded border border-border p-1 shadow-lg"
          >
            {entrees.map((e) => (
              <button
                key={e.cle}
                type="button"
                role="menuitem"
                onClick={() => {
                  fermer(true);
                  e.agir();
                }}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface focus:bg-surface focus:outline-none ${e.danger ? "text-danger" : "text-foreground"}`}
              >
                <span className={`shrink-0 ${e.danger ? "" : "text-muted"}`}>{e.icone}</span>
                {e.libelle}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
