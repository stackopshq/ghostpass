"use client";

// Une ligne de secret : identifiant, mot de passe masqué, code à usage unique.
//
// Écrite une fois et utilisée par le coffre personnel comme par les collections
// d'équipe. Elle l'était deux fois dans le code Svelte — mêmes gestes, deux
// implémentations, donc deux endroits où corriger un défaut.

import { useEffect, useState } from "react";
import type { DecryptedItem } from "@/lib/crypto";
import { faviconUrl } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { generateOtp, parseOtp } from "@/lib/totp";
import { useI18n } from "@/lib/i18n";
import { BoutonIcone } from "@/components/champs";
import { Coche, Copier, Oeil, OeilBarre } from "@/components/Icones";

export type LigneSecret = DecryptedItem & { itemId: string };

export function SecretRow({
  item,
  cle,
  copie,
  onCopier,
  actions,
}: {
  item: LigneSecret;
  cle: string;
  copie: string | null;
  onCopier: (texte: string, cle: string) => void;
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [devoile, setDevoile] = useState(false);
  const [otp, setOtp] = useState<{ code: string; remaining: number } | null>(null);

  // Le code à usage unique se recalcule toutes les secondes, et seulement si
  // l'élément en porte un : monter un minuteur pour chaque ligne d'un coffre de
  // deux cents entrées coûterait deux cents réveils par seconde pour rien.
  //
  // On affiche le temps restant, que l'ancienne interface calculait et jetait.
  // Un code sans compte à rebours se colle parfois une seconde avant d'expirer,
  // et l'échec se lit alors comme « le site refuse mon code ».
  useEffect(() => {
    const secret = item.totp ? parseOtp(item.totp) : null;
    if (!secret) return;
    const tic = () => generateOtp(secret).then(setOtp).catch(() => setOtp(null));
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [item.totp]);

  const { jetonIcone } = useSession();
  // Le favicon de la PREMIÈRE adresse : une pastille de 32 px n'en porte
  // qu'une. Les autres adresses restent dans l'élément et s'affichent au
  // détail — c'est un choix d'affichage, pas une troncature de donnée.
  const favicon = faviconUrl(item.urls[0] ?? "", jetonIcone);

  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-surface-2 text-xs text-muted">
        {favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={favicon} alt="" className="size-5" />
        ) : (
          item.name.slice(0, 1).toUpperCase()
        )}
      </span>

      <div className="min-w-0 grow">
        <div className="truncate text-sm text-foreground">{item.name}</div>
        <div className="flex items-center gap-1 text-xs text-muted">
          {item.username ? (
            <>
              <span className="truncate">{item.username}</span>
              <BoutonIcone
                actif={copie === `user-${cle}`}
                title={t("org.copyUsername")}
                aria-label={t("org.copyUsername")}
                onClick={() => onCopier(item.username, `user-${cle}`)}
              >
                {copie === `user-${cle}` ? <Coche className="size-3.5" /> : <Copier className="size-3.5" />}
              </BoutonIcone>
            </>
          ) : (
            <span>{t("org.noUsername")}</span>
          )}
          {otp && (
            <>
              <span className="ml-2 font-mono tabular-nums">{otp.code}</span>
              <span
                className={`tabular-nums ${otp.remaining <= 5 ? "text-accent" : ""}`}
                title={t("org.totpRemaining")}
              >
                {otp.remaining}s
              </span>
              <BoutonIcone
                actif={copie === `otp-${cle}`}
                title={t("org.copyTotp")}
                aria-label={t("org.copyTotp")}
                onClick={() => onCopier(otp.code, `otp-${cle}`)}
              >
                {copie === `otp-${cle}` ? <Coche className="size-3.5" /> : <Copier className="size-3.5" />}
              </BoutonIcone>
            </>
          )}
        </div>
        {item.note && <div className="mt-1 text-xs whitespace-pre-wrap text-muted">{item.note}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className={`font-mono text-xs ${devoile ? "text-foreground" : "text-muted"}`}>
          {devoile ? item.password : "••••••••"}
        </span>
        <BoutonIcone
          title={devoile ? t("org.hide") : t("org.show")}
          aria-label={t("org.toggleReveal")}
          onClick={() => setDevoile((v) => !v)}
        >
          {devoile ? <OeilBarre className="size-4" /> : <Oeil className="size-4" />}
        </BoutonIcone>
        <BoutonIcone
          actif={copie === `pw-${cle}`}
          title={t("org.copyPassword")}
          aria-label={t("org.copyPassword")}
          onClick={() => onCopier(item.password, `pw-${cle}`)}
        >
          {copie === `pw-${cle}` ? <Coche className="size-4" /> : <Copier className="size-4" />}
        </BoutonIcone>
        {actions}
      </div>
    </li>
  );
}
