import path from "node:path";

import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/// Où le serveur de dev relaie l'API. Même nom que la variable du gabarit nginx
/// (`nginx.conf.template`), pour qu'un seul réglage désigne le serveur partout.
const API_DE_DEVELOPPEMENT = process.env.GHOSTPASS_API ?? "http://localhost:3000";

const base: NextConfig = {
  reactStrictMode: true,
  // Le module WASM est servi depuis `public/` (voir src/lib/crypto.ts) : aucune
  // extension d'empaqueteur n'est nécessaire, donc rien à déclarer ici.

  // EXPORT STATIQUE — ET POURQUOI CE N'EST PAS UN RENONCEMENT
  // ---------------------------------------------------------
  // Toute l'application est cliente : elle déchiffre avec une clé que le
  // serveur n'a pas, donc il n'y a rien qu'un rendu serveur pourrait produire.
  // L'export tombe juste, et il préserve la forme déjà éprouvée en production —
  // un nginx qui sert le lot ET relaie `/api` depuis la MÊME origine, ce dont
  // dépendent les clés WebAuthn (voir apps/web-next/Containerfile).
  //
  // L'export est posé plus bas, hors du serveur de dev : voir `config`.

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

/// En construction : l'export statique. En dev : le même relais que nginx.
///
/// L'interface appelle `/api/…` par des chemins relatifs. Sous Vite, un proxy
/// les relayait ; au passage à Next, ce relais n'a pas suivi et `next dev`
/// servait une interface dont chaque appel tombait en 404. `rewrites` le
/// rétablit, mais Next ne l'accepte pas avec `output: "export"` : d'où une
/// configuration par phase plutôt qu'un objet unique.
///
/// Les chemins relayés sont ceux de `nginx.conf.template`, pas seulement
/// `/api` : `/.well-known/webauthn` appartient au serveur, et l'oublier ferait
/// échouer l'enrôlement d'une clé en dev sans que la production le montre.
///
/// Le port, 5173, est fixé dans `package.json` : c'est l'origine que le serveur
/// accepte par défaut pour WebAuthn (`ORIGINE_DE_DEVELOPPEMENT`).
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return { ...base, output: "export" };
  return {
    ...base,
    async rewrites() {
      return ["/api/:chemin*", "/health", "/.well-known/webauthn"].map((source) => ({
        source,
        destination: `${API_DE_DEVELOPPEMENT}${source}`,
      }));
    },
  };
}
