# GhostPass : l'interface web

L'interface de GhostPass : Next 16 en **export statique**, Tailwind branché sur le thème
généré de la suite. Elle a remplacé l'interface Svelte (`apps/web`) le 2026-08-29 ; c'est
elle que construit `Containerfile` et que sert l'image `…-web`.

## Construire et lancer

Le cœur crypto est une dépendance `file:` vers `crates/ghostpass-crypto-wasm/pkg`, qui
n'existe qu'une fois construit. Sans lui, l'installation réussit et la compilation échoue
sur des erreurs de type qui semblent sans rapport.

```bash
(cd ../../crates/ghostpass-crypto-wasm && wasm-pack build --target web)
npm install
npm run dev         # :5173, /api relayé vers le serveur (:3000)
npm run typecheck   # tsc --noEmit
npm test            # tests node:test (test/*.test.ts, test/*.test.tsx)
npm run build       # export statique dans out/
```

La CI (job `web`) lance `typecheck`, `test` et `build`, dans cet ordre.

En dev, `next dev` tourne sur `:5173`, l'origine que le serveur accepte par défaut pour
WebAuthn (`ORIGINE_DE_DEVELOPPEMENT`), et relaie les mêmes chemins que nginx en production
(`/api`, `/health`, `/.well-known/webauthn`) vers `GHOSTPASS_API`, par défaut
`http://localhost:3000`. Le relais n'existe qu'en dev : Next refuse `rewrites` avec
`output: "export"`, d'où la configuration par phase de `next.config.ts`.

## Pourquoi un export statique

Toute l'application est cliente : elle déchiffre avec une clé que le serveur n'a pas, donc
aucun rendu serveur n'aurait rien à produire. En production, un nginx sert le lot et relaie
`/api` depuis la **même origine**, ce dont dépendent les clés WebAuthn (voir `Containerfile`
et `nginx.conf.template`).

## Le module WebAssembly

Il est copié dans `public/` par les scripts `predev` et `prebuild`, puis récupéré par `fetch`
(`src/lib/crypto.ts`), ce qui ne demande rien à l'empaqueteur. La copie est une étape du
script, pas un geste d'opérateur : faite à la main, elle serait périmée au premier
`cargo build`.

`next.config.ts` fixe `turbopack.root` à la racine du dépôt : `node_modules/ghostpass-crypto-wasm`
est un lien symbolique vers `crates/…/pkg`, hors de la racine que Turbopack devine, et sans
cette ligne la construction échoue sur « Can't resolve 'ghostpass-crypto-wasm' ».

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
