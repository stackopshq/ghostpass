"use client";

// La colonne du milieu : les entrées du dossier choisi, ou les résultats de
// recherche.

import { useI18n } from "@/lib/i18n";
import type { VaultEntry } from "@/lib/vault";
import { Avatar } from "@/components/Avatar";
import { Coffre } from "@/components/Icones";

function sousTitre(item: VaultEntry, t: (k: string) => string): string {
  if (item.kind === "note") return t("app.secureNote");
  if (item.kind === "card" && item.cardNumber) return `•••• ${item.cardNumber.slice(-4)}`;
  return item.username;
}

export function ListeSecrets({
  items,
  total,
  recherche,
  dossier,
  choisi,
  onChoisir,
  selection,
  onBasculerSelection,
  onToutSelectionner,
}: {
  items: VaultEntry[];
  total: number;
  recherche: string;
  dossier: string | null;
  choisi: VaultEntry | null;
  onChoisir: (item: VaultEntry) => void;
  selection: Set<string>;
  onBasculerSelection: (id: string, jusqua?: VaultEntry[]) => void;
  onToutSelectionner: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const tousChoisis = items.length > 0 && items.every((i) => selection.has(i.id));

  const titre = recherche.trim()
    ? t("app.results")
    : dossier === null
      ? t("app.allItems")
      : (dossier.split("/").pop() ?? "");

  return (
    <div className="flex min-h-0 flex-col">
      {/* Un vrai en-tête de page : un titre à sa taille, et le compte en
          sous-titre. L'ancienne version alignait les deux sur la même ligne en
          petit, ce qui ne hiérarchisait rien. */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-foreground">{titre}</h2>
          <p className="text-xs text-muted">{t("app.itemCount", { n: items.length })}</p>
        </div>
        {items.length > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-1 text-2xs text-muted">
            <input
              type="checkbox"
              checked={tousChoisis}
              onChange={() => onToutSelectionner(tousChoisis ? [] : items.map((i) => i.id))}
              className="accent-accent"
            />
            {t("app.selectAll")}
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 ? (
          <div className="grid place-items-center gap-3 px-6 py-16 text-center text-sm text-muted">
            <Coffre className="size-7 opacity-30" />
            <p>
              {/* Trois vides différents, trois phrases : « aucun résultat » sur un
                  coffre vide enverrait chercher un défaut de recherche. */}
              {total === 0 ? (
                <>
                  {t("app.emptyVault")}
                  <br />
                  {t("app.emptyVaultSub")}
                </>
              ) : recherche.trim() ? (
                t("app.noResult")
              ) : (
                t("app.noneInFolder")
              )}
            </p>
          </div>
        ) : (
          items.map((item) => {
            const actif = choisi?.id === item.id;
            const sous = sousTitre(item, t);
            const coche = selection.has(item.id);
            return (
              <div
                key={item.id}
                // Séparation par surface et par espace, pas par un trait : c'est
                // ce qui distingue une liste d'un tableur.
                className={`group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${actif ? "bg-accent/12" : coche ? "bg-surface" : "hover:bg-surface"}`}
              >
                {/* La case est HORS du bouton : imbriquer un contrôle dans un
                    bouton le rend inatteignable — le clic déclenche le bouton,
                    jamais la case. Elle n'apparaît qu'au survol ou dès qu'une
                    sélection existe, pour ne pas alourdir la lecture courante. */}
                <label
                  className={`flex shrink-0 cursor-pointer items-center transition-opacity ${coche || selection.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
                >
                  <input
                    type="checkbox"
                    checked={coche}
                    onChange={(e) =>
                      // Maj enfoncée : on étend depuis la dernière case cochée,
                      // ce qu'on attend d'une liste dès qu'elle dépasse dix
                      // lignes.
                      onBasculerSelection(item.id, (e.nativeEvent as MouseEvent).shiftKey ? items : undefined)
                    }
                    aria-label={t("app.selectItem", { name: item.name })}
                    className="accent-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onChoisir(item)}
                  aria-current={actif ? "true" : undefined}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                >
                  <Avatar nom={item.name} url={item.url} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-sm ${actif ? "text-accent" : "text-foreground"}`}>{item.name}</span>
                    {sous && <span className="truncate text-xs text-muted">{sous}</span>}
                  </span>
                  {/* D'OÙ VIENT CETTE ENTRÉE.
                      La liste mêle le coffre personnel et les collections
                      d'équipe : sans cette marque, rien ne distingue un secret
                      qu'on possède d'un secret que l'équipe partage — et les
                      deux ne se suppriment pas, ne s'exportent pas et ne se
                      modifient pas de la même façon.

                      `block` et non `inline-flex` : `text-overflow: ellipsis`
                      ne s'applique qu'à un conteneur de bloc. Sur `inline-flex`
                      les trois propriétés sont là et aucune n'agit — le nom de
                      collection était coupé net, sans points de suite. */}
                  {item.shared && (
                    <span
                      className="ml-2 hidden max-w-[9rem] shrink-0 truncate rounded-full bg-accent/12 px-2 py-0.5 text-2xs text-accent sm:block"
                      title={`${item.shared.orgName} · ${item.shared.collectionName}`}
                    >
                      {item.shared.collectionName}
                    </span>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
