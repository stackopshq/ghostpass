/**
 * Toute taille et tout rayon de l'interface viennent de la charte de la suite.
 *
 * La charte (`ghostsuite`, `tools/brand/emit_theme.py`) fixe sept marches typographiques et
 * quatre rayons. Tailwind en propose bien plus, et ses marches en trop ne sont pas neutres :
 * elles ne sont PAS pontées dans `globals.css`, donc un `text-3xl` prend silencieusement le
 * 1,875 rem de Tailwind plutôt qu'une valeur que la suite aurait décidée. Un `text-[11px]`
 * arbitraire saute l'échelle entièrement.
 *
 * Mesuré le 2026-09-26, avant l'adoption de `ghost-theme.css` : ce produit était déjà presque
 * propre — aucune taille hors charte, et seulement 2 × `rounded-full`. Ce qu'il avait en
 * revanche, et qu'aucun balayage de ce genre n'attrape, c'est ses CHAMPS sur `rounded-lg`,
 * c'est-à-dire la marche des cartes : une valeur de la charte, posée sur le mauvais objet.
 * Ce contrôle ne remplace donc pas le coup d'œil ; il garde ce que le coup d'œil a corrigé.
 *
 * Cette suite ne rend aucun composant : ce qui vit dans le JSX est hors de portée d'un test
 * normal. Lire la source est la seule forme qui l'atteigne — et la seule qui sera encore là
 * pour le prochain écran que quelqu'un ajoutera.
 *
 * ATTENTION : ce fichier CITE les classes qu'il interdit. Tailwind v4 découvre ses sources tout
 * seul, fichiers de test compris, et il les émettrait donc dans la feuille livrée — le document
 * qui interdit ferait livrer, et quiconque auditerait le CSS conclurait l'inverse de la vérité.
 * C'est `@source not "../../test/**\/*.test.ts"` dans `globals.css` qui l'empêche, et c'est la
 * raison de cette ligne.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** `test/` est à CÔTÉ de `src/`, pas dedans : on remonte d'un cran. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Les sept marches de la charte. `2xs` est la nôtre — Tailwind n'a pas ce nom. */
const MARCHES_TYPO = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl"];

/** Les quatre rayons de la charte. Le nom nu est la marche qu'elle appelle DEFAULT. */
const MARCHES_RAYON = new Set(["", "sm", "lg", "pill"]);

/** `text-*` porte aussi la couleur et l'alignement ; seules les longueurs sont des tailles. */
const LONGUEUR_ARBITRAIRE = /^\[[0-9.]+(px|rem|em|pt|%)\]$/;

function fichiersSource(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin);
    if (!/\.tsx?$/.test(nom) || /\.test\.tsx?$/.test(nom)) return [];
    return [chemin];
  });
}

/** Chaque jeton `text-…` et `rounded…` de l'arbre, avec l'endroit où il a été trouvé. */
function jetons(): { fichier: string; jeton: string }[] {
  return fichiersSource(SRC).flatMap((fichier) => {
    const texte = readFileSync(fichier, "utf8");
    return [...texte.matchAll(/\b(?:text|rounded)(?:-[A-Za-z0-9[\]%.]+)*/g)].map((m) => ({
      fichier: fichier.slice(SRC.length + 1),
      jeton: m[0],
    }));
  });
}

test("le balayage lit bien l'arbre des sources", () => {
  // Un balayage qui ne trouve rien passe toutes les assertions ci-dessous en ne prouvant
  // rien. Si la racine bouge, c'est ce test qui le dit plutôt que la suite qui verdit.
  assert.ok(fichiersSource(SRC).length > 30, `seulement ${fichiersSource(SRC).length} fichiers lus`);
  assert.ok(jetons().length > 150, `seulement ${jetons().length} jetons trouvés`);
});

test("l'interface n'emploie aucune taille que la charte ne définit pas", () => {
  const egarees = jetons()
    .filter(({ jeton }) => jeton.startsWith("text-"))
    .filter(({ jeton }) => {
      const reste = jeton.slice("text-".length);
      if (LONGUEUR_ARBITRAIRE.test(reste)) return true;
      // Les tailles de Tailwind au-dessus du plafond de la charte. Les plus basses
      // partagent ses noms.
      return /^(3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(reste);
    });

  assert.deepEqual(
    egarees.map((s) => `${s.fichier}: ${s.jeton}`),
    [],
    "ces tailles ne sont pas sur l'échelle de la suite : les nommées retombent sur la valeur " +
      "propre à Tailwind, les arbitraires sautent l'échelle. Les marches de la charte sont " +
      MARCHES_TYPO.map((s) => `text-${s}`).join(", "),
  );
});

test("l'interface n'emploie aucun rayon que la charte ne définit pas", () => {
  const egares = jetons()
    .filter(({ jeton }) => jeton === "rounded" || jeton.startsWith("rounded-"))
    .filter(({ jeton }) => {
      // Les variantes directionnelles (`rounded-t`, `rounded-tl`) portent les mêmes
      // marches ; on retire le côté.
      const reste = jeton
        .slice("rounded".length)
        .replace(/^-(t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee)(?=$|-)/, "");
      const marche = reste.replace(/^-/, "");
      if (LONGUEUR_ARBITRAIRE.test(marche)) return true;
      return !MARCHES_RAYON.has(marche);
    });

  assert.deepEqual(
    egares.map((s) => `${s.fichier}: ${s.jeton}`),
    [],
    "ces rayons ne sont pas sur l'échelle de la suite. Les marches de la charte sont rounded, " +
      "rounded-sm, rounded-lg, rounded-pill",
  );
});
