import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Le module WASM est servi depuis `public/` (voir src/lib/crypto.ts) : aucune
  // extension d'empaqueteur n'est nécessaire, donc rien à déclarer ici.
};

export default config;
