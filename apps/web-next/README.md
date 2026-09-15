# GhostPass — interface Next + Tailwind

Le portage de l'interface Svelte vers Next, avec Tailwind branché sur le thème
généré de la suite. **`apps/web` reste en service tant que ce portage n'est pas
complet** : rien ne casse, le Containerfile n'a pas bougé.

## Ce qui est fait

| | |
|---|---|
| bibliothèques TypeScript (`api`, `crypto`, `totp`, `csv`, `send`, `webauthn`…) | déplacées **sans modification**, sauf une ligne |
| `i18n` | porté des runes Svelte vers un contexte React, 444 entrées intactes |
| WebAssembly | **prouvé au navigateur** — `init()` aboutit, zéro erreur de console |
| Tailwind sur le thème généré | **prouvé au navigateur** — voir ci-dessous |
| `LanguageSwitcher`, `SendView`, route `/s/[id]` | portés, rendus vérifiés |

## Ce qui reste

`Organizations.svelte` (780 lignes) et `App.svelte` (2 230). C'est le gros du
travail, et il n'est pas commencé.

## La seule ligne changée dans les bibliothèques

Vite acceptait `import wasmUrl from "….wasm?url"` — un suffixe qui lui est
propre. Webpack ne le connaît pas. Le module est donc servi depuis `public/` et
récupéré par `fetch`, ce qui ne demande rien à l'empaqueteur. La copie est une
étape `prebuild`, pas un geste d'opérateur : faite à la main elle serait périmée
au premier `cargo build`.

## Pourquoi le thème n'est pas éditable ici

`src/app/ghost-theme.css` est **copié depuis ghostsuite**. Il est produit par
`tools/brand/emit_theme.py` à partir de `PRODUITS`, qui porte déjà les couleurs
des logos : un accent changé là traverse les icônes ET l'interface, ou aucune des
deux. La CI de ghostsuite refuse un fichier généré qui a dérivé.

Le pont `@theme` de `globals.css` ne répète aucune valeur — il pointe sur les
propriétés personnalisées. Vérifié dans un navigateur, sur ce que le moteur
calcule et non sur ce que la feuille déclare :

    --text-sm = 0.875rem      ->  bouton rendu à 14 px
    --color-accent = #2e7dff  ->  fond rgb(46, 125, 255)
    --color-accent-ink        ->  encre rgb(4, 18, 43)
    --color-base              ->  fond du corps rgb(11, 15, 25)

Sans cette mesure, un pont mal écrit aurait laissé Tailwind rendre ses propres
valeurs par défaut : la page aurait été jolie et fausse, et rien ne l'aurait dit.
