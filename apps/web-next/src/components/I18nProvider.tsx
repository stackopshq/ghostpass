"use client";

// Le fournisseur d'i18n. Il est « client » parce que la langue se détecte dans
// le navigateur — `localStorage` et `navigator` n'existent pas au rendu serveur.
// Voir l'en-tête de `lib/i18n.ts` : il démarre en anglais et corrige APRÈS le
// montage, sous peine de discordance d'hydratation.

import { I18nContext, useI18nValue } from "@/lib/i18n";
import { SessionContext, useSessionValue } from "@/lib/session";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={useI18nValue()}>
      <SessionContext.Provider value={useSessionValue()}>{children}</SessionContext.Provider>
    </I18nContext.Provider>
  );
}
