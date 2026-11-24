"use client";

// Le choix du dossier d'un élément.
//
// C'était un champ texte où l'on tapait « Travail/Serveurs », avec des
// suggestions : il fallait connaître ses dossiers par cœur, et une faute de
// frappe créait sans rien dire un dossier en double. On choisit maintenant dans
// la liste des dossiers du coffre, rangée comme l'arbre ; en créer un nouveau
// reste possible, et se fait explicitement.

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Chevron, Dossier, Plus } from "@/components/Icones";

/// Tous les chemins, parents compris, dans l'ordre de l'arbre. Un dossier
/// « Travail/Dev » sans élément directement dans « Travail » doit quand même
/// proposer « Travail ».
export function cheminsDeLArbre(chemins: string[]): string[] {
  const tous = new Set<string>();
  for (const c of chemins) {
    const segments = c.split("/").filter(Boolean);
    for (let i = 1; i <= segments.length; i++) tous.add(segments.slice(0, i).join("/"));
  }
  // Trier segment par segment : un tri de chaînes brut placerait « Travail
  // perso » entre « Travail » et « Travail/Dev ».
  return [...tous].sort((a, b) => {
    const x = a.split("/");
    const y = b.split("/");
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = x[i]!.localeCompare(y[i]!);
      if (c !== 0) return c;
    }
    return x.length - y.length;
  });
}

export function ChoixDossier({
  valeur,
  chemins,
  onChange,
}: {
  valeur: string;
  chemins: string[];
  onChange: (chemin: string) => void;
}) {
  const { t } = useI18n();
  const options = useMemo(
    () => cheminsDeLArbre(valeur ? [...chemins, valeur] : chemins),
    [chemins, valeur],
  );
  // La saisie d'un nouveau dossier part du dossier choisi : on crée presque
  // toujours un sous-dossier de ce qu'on était en train de choisir.
  const [nouveau, setNouveau] = useState<string | null>(null);
  // Le dossier choisi avant d'ouvrir la saisie, que rétablit Échap.
  const [precedent, setPrecedent] = useState("");
  const [ouverte, setOuverte] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative"
        // Un clic ailleurs referme la liste ; un clic DANS la liste déplace le
        // focus d'un de ses boutons à l'autre, et ne doit pas la refermer.
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOuverte(false);
        }}
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={ouverte}
          aria-label={t("app.folder")}
          onClick={() => setOuverte((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOuverte(false);
            if (e.key === "ArrowDown" && !ouverte) {
              e.preventDefault();
              setOuverte(true);
            }
          }}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded border border-border bg-surface-2 px-3 py-2.5 text-left text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        >
          <Dossier className="size-4 shrink-0 text-muted" />
          <span className={`min-w-0 flex-1 truncate ${nouveau === null && !valeur ? "text-muted" : ""}`}>
            {nouveau !== null ? t("app.newFolder") : valeur ? valeur.split("/").join(" / ") : t("app.noFolder")}
          </span>
          <Chevron className={`size-4 shrink-0 text-muted transition-transform ${ouverte ? "-rotate-90" : "rotate-90"}`} />
        </button>
        {ouverte && (
          // UNE LISTE QUI S'OUVRE TOUJOURS VERS LE BAS
          // La liste native de macOS se place pour que l'option choisie
          // recouvre le champ : avec un dossier choisi en bas de liste, elle
          // s'ouvrait vers le haut, par-dessus le nom. Celle-ci se déroule
          // sous le champ, comme l'arbre qu'elle reproduit.
          <ul
            role="listbox"
            aria-label={t("app.folder")}
            className="verre-opaque absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-border p-1 shadow-lg"
          >
            {[{ chemin: "", libelle: t("app.noFolder"), profondeur: 0 }, ...options.map((c) => ({
              chemin: c,
              libelle: c.split("/").pop() ?? c,
              profondeur: c.split("/").length - 1,
            }))].map(({ chemin, libelle, profondeur }) => {
              const actif = nouveau === null && chemin === valeur;
              return (
                <li key={chemin || "\u0000aucun"} role="option" aria-selected={actif}>
                  <button
                    type="button"
                    onClick={() => {
                      setNouveau(null);
                      onChange(chemin);
                      setOuverte(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${actif ? "bg-accent/12 text-accent" : "text-foreground hover:bg-surface"} ${chemin ? "" : "text-muted"}`}
                    style={{ paddingLeft: 8 + profondeur * 16 }}
                  >
                    {chemin && <Dossier className="size-4 shrink-0 opacity-70" />}
                    <span className="truncate">{libelle}</span>
                  </button>
                </li>
              );
            })}
            <li role="option" aria-selected={nouveau !== null} className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  setPrecedent(valeur);
                  setNouveau(valeur ? `${valeur}/` : "");
                  setOuverte(false);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-accent hover:bg-surface"
              >
                <Plus className="size-4 shrink-0" />
                {t("app.newFolder")}
              </button>
            </li>
          </ul>
        )}
      </div>
      {nouveau !== null && (
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            defaultValue={nouveau}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split("/")
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .join("/"),
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setNouveau(null);
                onChange(precedent);
              }
            }}
            placeholder={t("app.folderPh")}
            aria-label={t("app.newFolder")}
            className="w-full rounded border border-accent/60 bg-surface-2 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <p className="text-2xs text-muted">{t("app.newFolderOnSave")}</p>
        </div>
      )}
    </div>
  );
}
