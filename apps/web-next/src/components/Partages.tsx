"use client";

// Les liens de partage en cours, et de quoi les révoquer.
//
// La liste vit dans le coffre, chiffrée : le serveur ne sait pas qui partage
// quoi ni quand, et ne détient aucun jeton de révocation. C'est la décision de
// Clara quand la question s'est posée, et le `delete_token` de ghostbit s'y
// range mieux que ce que je proposais — révoquer exige le jeton, pas
// l'identifiant, donc un destinataire qui détient le lien ne peut rien annuler.

import { useI18n } from "@/lib/i18n";
import type { PartageEnCours } from "@/lib/crypto";
import { formatDate } from "@/lib/vault";
import { Bouton } from "@/components/champs";
import { useCopie } from "@/components/useCopie";
import { Coche, Copier, Partage } from "@/components/Icones";

export function Partages({
  partages,
  occupe,
  onRevoquer,
}: {
  partages: PartageEnCours[];
  occupe: boolean;
  onRevoquer: (p: PartageEnCours) => void;
}) {
  const { t, locale } = useI18n();
  const { copie, copier } = useCopie();

  return (
    <div className="min-h-0 overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-lg font-semibold text-foreground">{t("app.shares")}</h2>
        <p className="mb-5 text-xs text-muted">{t("app.sharesSub")}</p>

        {partages.length === 0 ? (
          <div className="carte grid place-items-center gap-3 py-12 text-center">
            <Partage className="size-7 text-muted opacity-30" />
            <p className="text-sm text-muted">{t("app.noShares")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {partages.map((p) => (
              <li key={p.id} className="carte flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{p.name}</p>
                  <p className="truncate text-2xs text-muted">
                    {p.expiresAt
                      ? t("app.expiresOn", { date: formatDate(p.expiresAt * 1000, locale) })
                      : t("app.noExpiry")}
                  </p>
                </div>
                {/* Recopier le lien sans le révéler en entier : il porte la clé
                    dans son fragment, et l'afficher au complet dans une liste
                    le met sous les yeux de qui passe derrière l'épaule. */}
                <Bouton
                  variante="discret"
                  aria-label={`${t("app.copyLink")} — ${p.name}`}
                  onClick={() => copier(p.url, p.id)}
                >
                  <span className="flex items-center gap-1.5">
                    {copie === p.id ? <Coche className="size-4" /> : <Copier className="size-4" />}
                    {t("app.copyLink")}
                  </span>
                </Bouton>
                <Bouton
                  variante="danger"
                  disabled={occupe}
                  aria-label={`${t("app.revoke")} — ${p.name}`}
                  onClick={() => onRevoquer(p)}
                >
                  {t("app.revoke")}
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
