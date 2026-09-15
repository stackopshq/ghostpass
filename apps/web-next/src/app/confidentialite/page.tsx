// La politique de confidentialité, servie par l'application elle-même.
//
// POURQUOI CETTE PAGE EXISTE
// --------------------------
// L'article 13 du RGPD veut que l'information soit remise AU MOMENT de la
// collecte. Jusqu'ici le texte existait, il était bon, et il était rangé dans
// un dépôt Git qu'on ne montrait à personne : l'application n'avait que deux
// routes, le coffre et l'ouverture d'un lien partagé. Une personne qui créait
// un compte n'avait aucun chemin vers ce que la loi lui doit — et le juriste
// d'un acheteur professionnel le cherche sur l'URL du produit, pas dans une
// forge.
//
// LA SOURCE RESTE `docs/legal/`, ET IL N'EN EXISTE PAS DE COPIE
// -------------------------------------------------------------
// Le fichier est LU AU MOMENT DE LA CONSTRUCTION, pas recopié dans `src/`.
// Une copie serait un second original qui dérive en silence ; ici, un texte
// modifié dans `docs/legal/` change la page à la construction suivante, sans
// geste à ne pas oublier. Si le fichier venait à manquer, `next build`
// échouerait bruyamment — ce qui est le bon comportement pour un document
// dont l'absence est une non-conformité.
//
// TROIS ENDROITS À TENIR ENSEMBLE, ET C'EST LE PIÈGE DE CETTE PAGE
// -----------------------------------------------------------------
// L'image ne copie que `out/`. Pour que cette page existe en production il
// faut donc, ensemble :
//
//   1. cette route, pré-rendue par l'export statique en `out/confidentialite.html` ;
//   2. `docs/legal/` présent dans l'étage de construction de l'image
//      (`Containerfile`) — sans quoi la lecture ci-dessous échoue ;
//   3. un bloc `location` dans `nginx.conf.template` — sans quoi `/confidentialite`
//      tombe dans le repli `try_files … /index.html` et rend LE COFFRE, en 200.
//
// Le troisième est le plus sournois : la page serait bien dans l'image, la
// revue serait passée, et l'URL rendrait l'écran de connexion.

import fs from "node:fs";
import path from "node:path";

import type { Metadata } from "next";

import { rendreMarkdown } from "@/lib/renduMarkdown";

export const metadata: Metadata = {
  title: "Politique de confidentialité — GhostPass",
  description:
    "Ce que GhostPass détient, ce qu'il ne peut pas lire, combien de temps il le garde, et à qui écrire.",
};

// `process.cwd()` vaut `apps/web-next` pendant `next build`, dans le dépôt
// comme dans l'image (`WORKDIR /src/apps/web-next`).
const SOURCE = path.join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "legal",
  "politique-de-confidentialite.md",
);

export default function Page() {
  const document = fs.readFileSync(SOURCE, "utf8");

  return (
    <main className="mx-auto w-full max-w-[52rem] px-4 py-10">
      <nav className="mb-8 flex items-center justify-between gap-4">
        <a
          href="/"
          className="flex items-center gap-2.5 text-foreground transition hover:opacity-80"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={28} height={28} className="size-7" />
          <span className="font-semibold tracking-tight">GhostPass</span>
        </a>
        <a
          href="/"
          className="rounded-pill border border-border px-3.5 py-1.5 text-xs text-muted transition hover:border-border-strong hover:text-foreground"
        >
          Retour au coffre
        </a>
      </nav>

      {/* `verre-dense` et non `verre` : cette carte porte du texte à lire au
          long, et l'aurore qui traverse la matière légère fatigue la lecture.
          C'est la variante prévue pour ça dans `globals.css`. */}
      <article className="verre-dense rounded-lg border border-border px-5 py-6 sm:px-8 sm:py-8">
        {rendreMarkdown(document)}
      </article>

      <p className="mt-6 text-center text-xs text-muted">
        Ce texte est versionné dans le dépôt public du produit — son historique complet est
        consultable.
      </p>
    </main>
  );
}
