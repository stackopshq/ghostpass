import path from "node:path";

import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Le module WASM est servi depuis `public/` (voir src/lib/crypto.ts) : aucune
  // extension d'empaqueteur n'est nécessaire, donc rien à déclarer ici.

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
