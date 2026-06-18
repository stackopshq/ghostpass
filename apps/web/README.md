# @ghostpass/web

Web app **SPA Svelte** du coffre humain. **Zero-knowledge** : tout le chiffrement se fait dans
le navigateur via le module WASM (`ghostpass-crypto-wasm`) ; le serveur ne voit que du chiffré.

SPA pure (pas de SSR) par choix de sécurité : aucun rendu serveur ne touche aux secrets.

## Parcours couvert (MVP)
- Créer un compte (génère les clés localement, n'envoie que des blobs chiffrés).
- Se connecter (`prelogin` → dérivation du hash → `login` → déverrouillage local du coffre).
- Ajouter un identifiant (chiffré côté client avant envoi).
- Lister le coffre (déchiffré côté client à l'affichage).

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

## Validation end-to-end
Le flux complet (crypto WASM + backend + déchiffrement) est vérifié automatiquement par
`apps/server/scripts/e2e.ts` (`node --import tsx scripts/e2e.ts`).
