"use client";

// Un secret en grands caractères, pour le recopier à la main : sur une
// télévision, une console, le téléphone de quelqu'un d'autre, partout où le
// presse-papiers ne va pas.
//
// Chaque caractère a sa case et son rang. « l », « I » et « 1 », « O » et
// « 0 » se confondent dans la plupart des polices ; la couleur sépare les
// chiffres et les symboles des lettres, et le rang permet de reprendre après
// une erreur sans tout relire. C'est ce que fait 1Password, et pour la même
// raison.
//
// Portail vers `body`, comme la fenêtre d'import : la fiche vit sous un
// `backdrop-filter` qui enfermerait un `position: fixed` dans son panneau.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { Croix } from "@/components/Icones";

export type Genre = "lettre" | "chiffre" | "symbole";

/// Pure, pour le test : ce qui décide de la couleur d'un caractère.
export function genreDe(c: string): Genre {
  if (/\p{Nd}/u.test(c)) return "chiffre";
  if (/\p{L}/u.test(c)) return "lettre";
  return "symbole";
}

const TEINTE: Record<Genre, string> = {
  lettre: "text-foreground",
  chiffre: "text-accent",
  symbole: "text-warn",
};

export function AffichageEnGrand({
  titre,
  valeur,
  onFermer,
}: {
  titre: string;
  valeur: string;
  onFermer: () => void;
}) {
  const { t } = useI18n();
  const fermer = useRef<HTMLButtonElement>(null);
  // Le parent passe une fonction recréée à chaque rendu ; l'effet ne doit pas
  // se rejouer pour autant, sous peine de reprendre le focus à chaque fois.
  const rappel = useRef(onFermer);
  rappel.current = onFermer;
  // Découpé par point de code et non par unité UTF-16 : un émoji ou un
  // caractère hors du plan de base occuperait sinon deux cases, chacune
  // illisible.
  const caracteres = [...valeur];

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    fermer.current?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Prise ici : les raccourcis du coffre fermeraient sinon aussi la fiche.
      e.preventDefault();
      rappel.current();
    };
    window.addEventListener("keydown", touche, true);
    return () => {
      window.removeEventListener("keydown", touche, true);
      // Rendre le focus là où il était : au clavier, on reprend sa lecture de
      // la fiche au bouton qu'on avait pressé.
      avant?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        onClick={(e) => e.stopPropagation()}
        className="verre-dense max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          <h2 className="flex-1 truncate text-base font-semibold text-foreground">{titre}</h2>
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
        <div className="flex flex-wrap justify-center gap-1.5">
          {caracteres.map((c, i) => (
            <span
              key={i}
              className="flex w-10 flex-col items-center rounded bg-surface-2 pb-1 pt-2"
            >
              {/* La plus haute marche de la charte, en chasse fixe : un « l » et
                  un « 1 » y prennent la même place et ne se confondent plus. */}
              <span className={`font-mono text-2xl font-semibold leading-tight ${TEINTE[genreDe(c)]}`}>
                {/* Une espace en fin ou en tête de mot de passe existe et doit
                    se voir : la case reste, marquée d'un point médian discret. */}
                {c === " " ? <span className="text-muted/50">·</span> : c}
              </span>
              <span className="text-2xs text-muted">{i + 1}</span>
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
