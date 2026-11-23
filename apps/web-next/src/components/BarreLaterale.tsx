"use client";

// Les briques de la barre latérale : une entrée de navigation, et l'en-tête
// d'une section qui se replie.
//
// La barre est rangée par sections (vues, coffres, dossiers), et chacune se
// replie : un compte avec dix organisations et trente dossiers rendait la
// barre plus haute que l'écran, et les entrées du bas (partages, archives,
// corbeille) passaient sous la ligne de flottaison.

import type { ComponentType, ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { Chevron } from "@/components/Icones";

export function EntreeDeNav({
  icone: Icone,
  pastille,
  libelle,
  compte,
  actif,
  onClick,
}: {
  icone?: ComponentType<{ className?: string }>;
  /// Une couleur à la place de l'icône : celle d'une organisation.
  pastille?: string;
  libelle: string;
  compte?: number;
  actif: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={actif ? "page" : undefined}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${actif ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
    >
      {pastille ? (
        <span className="grid size-4 shrink-0 place-items-center">
          <span className="size-2.5 rounded-pill" style={{ backgroundColor: pastille }} />
        </span>
      ) : Icone ? (
        <Icone className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{libelle}</span>
      {compte !== undefined && <span className="shrink-0 text-2xs tabular-nums">{compte}</span>}
    </button>
  );
}

export function EnTeteDeSection({
  titre,
  ouvert,
  onBasculer,
  action,
}: {
  titre: string;
  ouvert: boolean;
  onBasculer: () => void;
  /// Le geste propre à la section (créer un dossier, gérer les organisations),
  /// à droite du titre.
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 mb-1 flex items-center justify-between pl-1.5 pr-3">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouvert}
        title={t("app.expandCollapse")}
        className="flex cursor-pointer items-center gap-1 rounded px-1 text-2xs uppercase tracking-widest text-muted hover:text-foreground"
      >
        <Chevron className={`size-3 transition-transform ${ouvert ? "rotate-90" : ""}`} />
        {titre}
      </button>
      {action}
    </div>
  );
}
