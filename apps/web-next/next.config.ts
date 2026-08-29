import path from "node:path";

import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Le module WASM est servi depuis `public/` (voir src/lib/crypto.ts) : aucune
  // extension d'empaqueteur n'est nécessaire, donc rien à déclarer ici.

  // EXPORT STATIQUE — ET POURQUOI CE N'EST PAS UN RENONCEMENT
  // ---------------------------------------------------------
  // Toute l'application est cliente : elle déchiffre avec une clé que le
  // serveur n'a pas, donc il n'y a rien qu'un rendu serveur pourrait produire.
  // L'export tombe juste, et il préserve la forme déjà éprouvée en production —
  // un nginx qui sert le lot ET relaie `/api` depuis la MÊME origine, ce dont
  // dépendent les clés WebAuthn (voir apps/web/Containerfile).
  output: "export",

  // `output: export` interdit l'optimiseur d'images, qui est un service. Aucune
  // conséquence ici : l'interface n'utilise pas `next/image`.
  images: { unoptimized: true },

  turbopack: {
    // Le cœur crypto est une dépendance `file:` : `node_modules/ghostpass-
    // crypto-wasm` est un LIEN SYMBOLIQUE vers `crates/…/pkg`, deux niveaux
    // au-dessus de ce dossier. Webpack le suivait sans rien demander ; Turbopack,
    // moteur par défaut depuis Next 16, refuse de résoudre hors de la racine
    // qu'il devine — et il devine ce dossier-ci, faute d'espace de travail npm
    // déclaré à la racine du dépôt. Sans cette ligne : « Can't resolve
    // 'ghostpass-crypto-wasm' », à la construction seulement.
    root: path.join(__dirname, "..", ".."),
  },
};

export default config;
