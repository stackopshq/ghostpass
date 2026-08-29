"use client";

import { LOCALES, useI18n } from "@/lib/i18n";

/**
 * Deux boutons plutôt qu'un menu déroulant : à deux langues, le menu coûte un
 * clic de plus et cache l'état courant. Même forme que ghostcal.
 *
 * La langue active se lit à la couleur d'accent ET à `aria-pressed` — la
 * couleur seule ne dit rien à un lecteur d'écran.
 */
export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="inline-flex items-center gap-0.5 text-2xs">
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={locale === l.code}
          onClick={() => setLocale(l.code)}
          className={`cursor-pointer rounded-sm px-1.5 py-0.5 transition-colors ${
            locale === l.code ? "text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
