"use client";

// La liste des raccourcis, ouverte par « ? » ou par le menu du compte.
//
// Un raccourci que rien n'annonce n'existe que pour qui lit le code. Le menu
// du compte en donne l'accès à la souris, et la fenêtre se ferme comme les
// autres : Échap, clic sur le fond ou bouton.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { toucheAlt, toucheMod } from "@/lib/raccourcis";
import { Croix } from "@/components/Icones";

export function AideRaccourcis({ onFermer }: { onFermer: () => void }) {
  const { t } = useI18n();
  const fermer = useRef<HTMLButtonElement>(null);
  const rappel = useRef(onFermer);
  rappel.current = onFermer;

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    fermer.current?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      rappel.current();
    };
    window.addEventListener("keydown", touche, true);
    return () => {
      window.removeEventListener("keydown", touche, true);
      avant?.focus();
    };
  }, []);

  const mod = toucheMod();
  const alt = toucheAlt();
  const lignes: [string[][], string][] = [
    [[["/"], [mod, "K"]], "app.shortcut.search"],
    [[["↑"], ["↓"]], "app.shortcut.navigate"],
    [[[mod, "C"]], "app.shortcut.copyPassword"],
    [[[alt, "C"]], "app.shortcut.copyUsername"],
    [[["esc"]], "app.shortcut.escape"],
    [[[mod, "⇧", "L"]], "app.shortcut.lock"],
    [[["?"]], "app.shortcut.help"],
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-raccourcis"
        onClick={(e) => e.stopPropagation()}
        className="verre-dense max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border p-6"
      >
        <div className="mb-4 flex items-center gap-3">
          <h2 id="titre-raccourcis" className="flex-1 text-lg font-semibold text-foreground">
            {t("app.shortcuts")}
          </h2>
          <button
            ref={fermer}
            type="button"
            onClick={onFermer}
            aria-label={t("app.close")}
            title={t("app.close")}
            className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <Croix className="size-5" />
          </button>
        </div>
        <dl className="divide-y divide-border/60">
          {lignes.map(([combinaisons, cle]) => (
            <div key={cle} className="flex items-center gap-4 py-2.5">
              <dt className="flex-1 text-sm text-foreground">{t(cle)}</dt>
              <dd className="flex shrink-0 items-center gap-1.5 text-2xs text-muted">
                {combinaisons.map((touches, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="px-0.5">{t("app.shortcut.or")}</span>}
                    {touches.map((k) => (
                      <kbd
                        key={k}
                        className="min-w-6 rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-foreground"
                      >
                        {k === "esc" ? t("app.shortcut.escKey") : k}
                      </kbd>
                    ))}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
