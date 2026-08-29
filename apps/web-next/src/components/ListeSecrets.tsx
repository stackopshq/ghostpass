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
}: {
  items: VaultEntry[];
  total: number;
  recherche: string;
  dossier: string | null;
  choisi: VaultEntry | null;
  onChoisir: (item: VaultEntry) => void;
}) {
  const { t } = useI18n();

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
      <div className="px-4 pb-3 pt-5">
        <h2 className="truncate text-lg font-semibold text-foreground">{titre}</h2>
        <p className="text-xs text-muted">{t("app.itemCount", { n: items.length })}</p>
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
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChoisir(item)}
                aria-current={actif ? "true" : undefined}
                // Séparation par surface et par espace, pas par un trait : c'est
                // ce qui distingue une liste d'un tableur.
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${actif ? "bg-accent/12 text-accent" : "hover:bg-surface"}`}
              >
                <Avatar nom={item.name} url={item.url} />
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate text-sm ${actif ? "text-accent" : "text-foreground"}`}>{item.name}</span>
                  {sous && <span className="truncate text-xs text-muted">{sous}</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
