"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Copier dans le presse-papiers, avec un accusé qui s'efface.
 *
 * La clé sert à savoir QUEL bouton a été pressé : sans elle, copier un mot de
 * passe ferait clignoter la coche de tous les autres. Le minuteur est annulé au
 * démontage — un `setTimeout` qui survit à son composant écrit dans un état
 * disparu, et React s'en plaint à raison.
 */
export function useCopie() {
  const [copie, setCopie] = useState<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copier = useCallback(async (texte: string, cle: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(cle);
      if (minuteur.current) clearTimeout(minuteur.current);
      minuteur.current = setTimeout(() => setCopie((c) => (c === cle ? null : c)), 1200);
    } catch {
      /* presse-papiers indisponible — rien de plus à dire à l'utilisateur */
    }
  }, []);

  return { copie, copier };
}
