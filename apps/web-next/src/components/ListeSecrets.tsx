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
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-foreground">{titre}</h2>
        <span className="text-2xs tabular-nums text-muted">{items.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="grid place-items-center gap-2 px-6 py-16 text-center text-sm text-muted">
            <Coffre className="size-8 opacity-40" />
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
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors ${actif ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
              >
                <Avatar nom={item.name} url={item.url} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{item.name}</span>
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
