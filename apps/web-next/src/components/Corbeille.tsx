"use client";

// La corbeille : ce qui a été supprimé du coffre personnel, et n'est pas encore
// parti.
//
// Elle existe parce qu'une suppression faite par erreur est le genre d'erreur
// qu'on remarque après coup. Les éléments d'équipe, eux, n'en ont pas — leur
// confirmation le dit, plutôt que de laisser croire à un filet.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { decryptVaultItem } from "@/lib/crypto";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { formatDate, type VaultEntry } from "@/lib/vault";
import { Avatar } from "@/components/Avatar";
import { Bouton } from "@/components/champs";
import { Corbeille as IconeCorbeille } from "@/components/Icones";

export function Corbeille({ onRestaure }: { onRestaure: () => void }) {
  const { t, locale } = useI18n();
  const { token, account } = useSession();
  const [items, setItems] = useState<VaultEntry[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!token || !account) return;
    try {
      const { items: dtos } = await api.listTrash(token);
      const entrees: VaultEntry[] = [];
      for (const d of dtos) {
        const r = decryptVaultItem(account, d.encryptedKey, d.encryptedData);
        // Le registre de dossiers passe par la même liste : il n'a rien à faire
        // dans une corbeille, il n'est pas un secret.
        if (r.kind === "item") entrees.push({ ...r.item, id: d.id, updatedAt: d.updatedAt });
      }
      setItems(entrees);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [token, account]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (fn: () => Promise<unknown>, rafraichirCoffre: boolean) => {
    setOccupe(true);
    try {
      await fn();
      await charger();
      if (rafraichirCoffre) onRestaure();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-lg font-semibold text-foreground">{t("app.trash")}</h2>
        <p className="text-xs text-muted">{t("app.trashHint")}</p>
      </div>

      {erreur && (
        <p role="alert" className="mx-5 mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {erreur}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {items.length === 0 ? (
          <div className="grid place-items-center gap-3 py-16 text-center">
            <IconeCorbeille className="size-7 text-muted opacity-30" />
            <p className="text-sm text-muted">{t("app.trashEmpty")}</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="carte flex items-center gap-3 px-4 py-3">
              <Avatar nom={item.name} url={item.url} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{item.name}</p>
                <p className="truncate text-2xs text-muted">{formatDate(item.updatedAt, locale)}</p>
              </div>
              <Bouton
                variante="discret"
                disabled={occupe}
                onClick={() => agir(() => api.restoreItem(token!, item.id), true)}
              >
                {t("app.restore")}
              </Bouton>
              <Bouton
                variante="danger"
                disabled={occupe}
                onClick={() => {
                  // Ici la suppression est vraiment définitive : le dire, plutôt
                  // que de reprendre le mot « supprimer » qui a déjà servi pour
                  // un geste réversible.
                  if (!confirm(t("app.confirmPurge", { name: item.name }))) return;
                  void agir(() => api.purgeItem(token!, item.id), false);
                }}
              >
                {t("app.delete")}
              </Bouton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
