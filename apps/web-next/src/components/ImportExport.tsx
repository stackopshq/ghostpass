"use client";

// Sortir le coffre, et y faire entrer un autre.
//
// Deux gestes rares mais décisifs : l'export est le seul endroit du produit où
// des secrets quittent le chiffré, l'import est souvent le tout premier contact
// avec le produit, on arrive de Chrome, de Firefox, de 1Password ou de
// Bitwarden avec un fichier.
//
// L'import a quitté ce composant. Il tenait ici en une boucle : découper,
// chiffrer, envoyer, annoncer un nombre. Ça marchait pour qui savait déjà
// produire le fichier et se moquait de ce qui n'entrait pas, c'est-à-dire pour
// nous, et pour personne d'autre. Il vit maintenant dans `ImportNavigateur`,
// qui explique d'abord comment obtenir le fichier et rend compte ensuite de ce
// qu'il a écarté.

import { useState } from "react";
import { versCsv } from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import type { VaultEntry } from "@/lib/vault";
import { ImportNavigateur } from "@/components/ImportNavigateur";
import { Televerser } from "@/components/Icones";

export function ImportExport({
  personnels,
  onImporte,
}: {
  // Le nom du champ porte la garantie : on n'exporte que le coffre personnel.
  // Voir `lib/export.ts` : un membre ne décide pas seul de sortir les secrets
  // de son équipe.
  personnels: VaultEntry[];
  onImporte: () => void;
}) {
  const { t } = useI18n();
  const [importe, setImporte] = useState(false);

  const exporter = () => {
    const blob = new Blob([versCsv(personnels)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ghostpass-export.csv";
    a.click();
    // Libérer tout de suite : l'URL garde le contenu déchiffré en mémoire de
    // l'onglet tant qu'elle vit, et personne ne pense à la révoquer plus tard.
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      {/* Deux actions rares : elles se lisent comme des liens outillés, pas
          comme des boutons pleins qui rivaliseraient avec l'action principale
          du rail. Un rail où tout crie ne hiérarchise plus rien. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={exporter}
          disabled={personnels.length === 0}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Televerser className="size-3.5 rotate-180" />
          {t("app.exportCsv")}
        </button>
        <button
          type="button"
          onClick={() => setImporte(true)}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-2xs text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <Televerser className="size-3.5" />
          {t("app.importCsv")}
        </button>
      </div>
      {/* La portée de l'export reste visible : c'est une affirmation de
          sécurité, et un fichier qui ne contient pas ce qu'on croyait se
          découvre trop tard. */}
      <p className="px-1 text-2xs leading-snug text-muted">{t("app.exportPersonalOnly")}</p>

      {importe && (
        <ImportNavigateur
          personnels={personnels}
          onFerme={() => setImporte(false)}
          onImporte={onImporte}
        />
      )}
    </div>
  );
}
