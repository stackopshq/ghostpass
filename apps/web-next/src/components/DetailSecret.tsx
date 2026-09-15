"use client";

// La colonne de droite : l'entrée choisie, en lecture.
//
// Toutes les lignes passent par `Ligne` — l'ancienne interface répétait la même
// structure onze fois, avec des variations non voulues : deux boutons de copie
// n'avaient pas d'`aria-label`, et le libellé « Masquer / Afficher » n'était
// traduit dans aucune des deux.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { formatDate, passwordStrength, type VaultEntry } from "@/lib/vault";
import { useCopie } from "@/components/useCopie";
import { Avatar } from "@/components/Avatar";
import { Bouton } from "@/components/champs";
import { Coche, Copier, Oeil, OeilBarre } from "@/components/Icones";

function Ligne({
  label,
  valeur,
  masque,
  cle,
  copie,
  onCopier,
  extra,
  enfant,
}: {
  label: string;
  valeur: string;
  masque?: string;
  cle?: string;
  copie?: string | null;
  onCopier?: (texte: string, cle: string) => void;
  extra?: ReactNode;
  enfant?: ReactNode;
}) {
  const { t } = useI18n();
  const [devoile, setDevoile] = useState(false);
  const secret = masque !== undefined;
  const affiche = secret && !devoile ? masque : valeur;
  const copiee = cle !== undefined && copie === cle;
  return (
    <div className="flex items-center gap-3 px-4 py-3 not-last:border-b not-last:border-border/60">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${valeur ? "text-foreground" : "text-muted"} ${secret && !devoile ? "tracking-widest" : ""}`}>
        {enfant ?? (affiche || t("app.notSet"))}
      </span>
      {extra}
      <span className="flex shrink-0 items-center gap-0.5">
        {secret && (
          <button
            type="button"
            onClick={() => setDevoile((v) => !v)}
            title={devoile ? t("app.hide") : t("app.show")}
            aria-label={devoile ? t("app.hide") : t("app.show")}
            aria-pressed={devoile}
            className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-foreground"
          >
            {devoile ? <OeilBarre className="size-4" /> : <Oeil className="size-4" />}
          </button>
        )}
        {cle && onCopier && valeur && (
          <button
            type="button"
            onClick={() => onCopier(valeur, cle)}
            title={t("app.copy")}
            aria-label={`${t("app.copy")} — ${label}`}
            className={`cursor-pointer rounded p-1 transition-colors ${copiee ? "text-accent" : "text-muted hover:text-foreground"}`}
          >
            {copiee ? <Coche className="size-4" /> : <Copier className="size-4" />}
          </button>
        )}
      </span>
    </div>
  );
}

export function DetailSecret({
  item,
  onModifier,
  onSupprimer,
  onPartager,
  occupe,
}: {
  item: VaultEntry;
  onModifier: () => void;
  onSupprimer: () => void;
  onPartager: () => void;
  occupe: boolean;
}) {
  const { t, locale } = useI18n();
  const { copie, copier } = useCopie();
  const force = useMemo(() => passwordStrength(item.password), [item.password]);

  const genre =
    item.kind === "note"
      ? t("app.secureNote")
      : item.kind === "card"
        ? t("app.encryptedCard")
        : t("app.encryptedLogin");

  const teintes = ["text-danger", "text-danger", "text-warn", "text-success", "text-success"];

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3.5 px-5 pb-4 pt-5">
        <Avatar nom={item.name} url={item.url} grand />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">{item.name}</h2>
          <p className="text-xs text-muted">{genre}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Partager copie le lien dans le presse-papier et range le jeton de
              révocation dans le coffre : le secret, lui, n'y passe jamais. */}
          <Bouton variante="discret" onClick={onPartager} disabled={occupe}>
            {t("app.share")}
          </Bouton>
          <Bouton variante="discret" onClick={onModifier}>
            {t("app.edit")}
          </Bouton>
          <Bouton variante="danger" onClick={onSupprimer} disabled={occupe}>
            {t("app.delete")}
          </Bouton>
        </div>
      </div>

      {/* Les champs vivent dans une carte : une surface posée sur l'aurore, pas
          une suite de lignes séparées par des traits. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="carte overflow-hidden">
        {item.folder && <Ligne label={t("app.folder")} valeur={item.folder} />}

        {item.kind === "note" ? (
          <div className="p-4">
            <div className="relative rounded border border-border bg-surface-2 p-3">
              <button
                type="button"
                onClick={() => copier(item.note, "note")}
                title={t("app.copy")}
                aria-label={`${t("app.copy")} — ${t("app.secureNote")}`}
                className={`absolute right-2 top-2 cursor-pointer rounded p-1 transition-colors ${copie === "note" ? "text-accent" : "text-muted hover:text-foreground"}`}
              >
                {copie === "note" ? <Coche className="size-4" /> : <Copier className="size-4" />}
              </button>
              <pre className="whitespace-pre-wrap break-words pr-8 font-sans text-sm text-foreground">
                {item.note}
              </pre>
            </div>
          </div>
        ) : item.kind === "card" ? (
          <>
            <Ligne label={t("app.cardholder")} valeur={item.cardholder} cle="holder" copie={copie} onCopier={copier} />
            <Ligne
              label={t("app.cardNumber")}
              valeur={item.cardNumber}
              masque="•••• •••• •••• ••••"
              cle="num"
              copie={copie}
              onCopier={copier}
            />
            {item.cardExp && <Ligne label={t("app.expiry")} valeur={item.cardExp} />}
            <Ligne label={t("app.cardCvv")} valeur={item.cardCode} masque="•••" cle="cvv" copie={copie} onCopier={copier} />
          </>
        ) : (
          <>
            {item.url && (
              <Ligne
                label={t("app.website")}
                valeur={item.url}
                cle="url"
                copie={copie}
                onCopier={copier}
                enfant={
                  <a
                    href={item.url.includes("://") ? item.url : `https://${item.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-accent hover:underline"
                  >
                    {item.url}
                  </a>
                }
              />
            )}
            <Ligne label={t("app.kindLogin")} valeur={item.username} cle="user" copie={copie} onCopier={copier} />
            <Ligne
              label={t("app.password")}
              valeur={item.password}
              masque="••••••••••••"
              cle="pw"
              copie={copie}
              onCopier={copier}
              extra={
                item.password ? (
                  <span className={`shrink-0 text-2xs ${teintes[force.niveau]}`} title={t("app.strength")}>
                    {t(force.cle)}
                  </span>
                ) : undefined
              }
            />
          </>
        )}

        {/* La note d'un identifiant ou d'une carte. Un coffre migré depuis un
            autre gestionnaire arrive presque toujours avec des notes : sans cet
            écran elles seraient stockées et jamais montrées, ce qui se lit comme
            une perte. Le type « note » a déjà son propre affichage plus haut. */}
        {item.kind !== "note" && item.note && (
          <div className="border-t border-border p-4">
            <p className="mb-2 text-2xs text-muted">{t("app.secureNote")}</p>
            <div className="relative rounded border border-border bg-surface-2 p-3">
              <button
                type="button"
                onClick={() => copier(item.note, "note")}
                title={t("app.copy")}
                aria-label={`${t("app.copy")} (${t("app.secureNote")})`}
                className={`absolute right-2 top-2 cursor-pointer rounded p-1 transition-colors ${copie === "note" ? "text-accent" : "text-muted hover:text-foreground"}`}
              >
                {copie === "note" ? <Coche className="size-4" /> : <Copier className="size-4" />}
              </button>
              <pre className="whitespace-pre-wrap break-words pr-8 font-sans text-sm text-foreground">
                {item.note}
              </pre>
            </div>
          </div>
        )}

        </div>
        <p className="px-1 pt-3 text-2xs text-muted">{formatDate(item.updatedAt, locale)}</p>
      </div>
    </div>
  );
}
