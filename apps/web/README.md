# @ghostpass/web

Web app **SPA Svelte** du coffre humain. **Zero-knowledge** : tout le chiffrement se fait dans
le navigateur via le module WASM (`ghostpass-crypto-wasm`) ; le serveur ne voit que du chiffré.

SPA pure (pas de SSR) par choix de sécurité : aucun rendu serveur ne touche aux secrets.

## Parcours couvert (MVP)
- Créer un compte (génère les clés localement, n'envoie que des blobs chiffrés).
- Se connecter (`prelogin` → dérivation du hash → `login` → déverrouillage local du coffre).
- Ajouter un identifiant (chiffré côté client avant envoi).
- Lister le coffre (déchiffré côté client à l'affichage).
- MFA TOTP (configuration + code au login) et kit de récupération.
- **Organisations** (onglet dédié) : créer une org, inviter des membres (distribution
  authentifiée de l'Org Key), accepter, collections, partager et lire des secrets — l'Org Key
  ne quitte jamais le module WASM.

## Lancer en local

Prérequis : le package WASM doit être construit (`cd ../../crates/ghostpass-crypto-wasm && wasm-pack build --target web`).

```bash
# Terminal 1 — backend (port 3000)
cd ../server && npm run dev

# Terminal 2 — web app (port 5173, /api relayé vers le backend)
npm run dev
```

## Scripts
```bash
npm run dev      # serveur de dev Vite
npm run build    # build de production (bundle le WASM)
npm run check    # svelte-check (typage)
```

## Direction artistique

Tout tient dans `src/app.css`, en jetons CSS. Même grammaire que **ghostcal**, avec les
teintes de GhostPass.

**Les trois teintes font autorité et ne se choisissent pas ici.** Elles sont déclarées dans
`tools/brand/ghost_suite.py` (dépôt `apollo/apollo-platform`) :
`claire #9CC3FF` · `primaire #2E7DFF` · `profonde #143F8F`. Cette feuille a porté `#5394f5`
et `#2e5cc5` pendant des mois — deux bleus que rien ne dérivait de la charte, et qui
faisaient de GhostPass le seul produit de la suite à ne pas ressembler à ses frères.

Trois traits, empruntés à ghostcal :

| Trait | Où | Ce que ça fait |
|---|---|---|
| **Aurore** | `body` | Un dégradé radial de l'accent à 10 %, `background-attachment: fixed`. Il ne se voit **que** parce que les surfaces au-dessus sont translucides. |
| **Verre fumé** | `.glass`, `.panel`, `.kv`, `.topbar`, `.sidebar`, `.content` | `color-mix(… , transparent)` + `backdrop-filter: blur()`. Rendre une de ces surfaces opaque éteint l'aurore sur toute la page. |
| **Lueur** | `.btn-primary`, `.icon-add` | Une ombre colorée (`--glow`), pas une animation : gratuite à la frappe, et insensible à `prefers-reduced-motion`. |

Deux jetons d'accent, à ne pas confondre :

- `--accent` — les **remplis** (boutons, pastilles, anneau OTP).
- `--accent-text` — l'accent employé comme **texte ou icône**. Sur fond sombre, la primaire
  pleine n'atteint que 3,2:1 : elle est illisible en petit corps. La teinte claire y est à
  6,8:1. En thème clair, les deux valent la profonde.

`--accent-ink` est le texte **posé sur** l'accent : bleu nuit sur la primaire allumée, blanc sur la profonde.

### Deux ruptures, une exigence : zéro défilement horizontal

- **≤ 1040 px** — la barre latérale devient un rail d'icônes. Le rail masque *aussi* l'arbre
  de dossiers : « Dossiers » rendu dans 62 px de large donnait « DOSS ».
- **≤ 760 px** — plus de rail. La barre latérale devient un **tiroir** hors-écran (bouton
  hamburger, voile cliquable, fermeture à chaque navigation), la liste et le détail
  s'empilent, l'en-tête passe sur deux lignes.

Trois pièges rencontrés, qui ne se voient pas en lisant la feuille :

1. Le bouton « + » n'était pas coupé par une largeur fixe mais par la **somme des largeurs
   incompressibles** d'un en-tête à quatre éléments sur une seule ligne. `flex-wrap` règle la
   cause ; élargir la fenêtre masquait le symptôme.
2. Les champs à moins de **16 px** font zoomer Safari iOS à la mise au point — et c'est ce
   zoom, pas la mise en page, qui produit le défilement horizontal.
3. Le tiroir est en `position: fixed`. Il fonctionne **parce qu'aucun de ses ancêtres ne
   porte `transform`, `filter` ni `backdrop-filter`** : un seul suffirait à en faire un
   élément positionné dans la colonne, et il resterait invisible. Le verre fumé est posé sur
   `.topbar`, `.content` et le tiroir lui-même — jamais sur `.layout` ni sur `.body`.

## Validation end-to-end
Le flux complet (crypto WASM + backend + déchiffrement) est vérifié automatiquement par
`apps/server/scripts/e2e.ts` (`node --import tsx scripts/e2e.ts`).
