// Partage de lien éphémère.
//
// Le chiffrement se fait dans le cœur Rust, comme tout le reste du produit. C'était
// auparavant le seul endroit où de la crypto vivait ailleurs — un AES-256-GCM appelé
// directement via WebCrypto — et cet écart avait deux coûts : un second algorithme à
// auditer pour une tâche déjà couverte, et l'impossibilité pour l'application iOS d'ouvrir
// un partage créé depuis le navigateur.
//
// La clé est encodée pour le fragment d'URL (#). Les navigateurs ne l'envoient jamais au
// serveur, qui n'héberge donc qu'un chiffre qu'il ne peut pas lire.

import { open_send, seal_send } from "ghostpass-crypto-wasm";

import { ensureCryptoReady } from "@/lib/crypto";

export interface SealedSend {
  ciphertext: string;
  /// Le nonce du chiffre. Le serveur le stocke sous le nom `iv`, hérité de l'AES-GCM.
  iv: string;
  keyFragment: string;
}

/// Le base64 du cœur est standard ; un fragment d'URL réclame la variante sans caractères
/// à échapper. La conversion est purement textuelle, elle ne touche pas à la clé.
function versFragment(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function depuisFragment(fragment: string): string {
  const s = fragment.replace(/-/g, "+").replace(/_/g, "/");
  return s + "=".repeat((4 - (s.length % 4)) % 4);
}

/// Chiffre un texte ; renvoie le chiffré et son nonce (pour le serveur), et la clé (pour le
/// fragment d'URL).
export async function sealSend(plaintext: string): Promise<SealedSend> {
  // ─── Le cœur doit être chargé avant qu'on lui parle ───
  //
  // `seal_send` n'existe pas tant que `init()` n'a pas rendu la main : le module
  // engendré par wasm-bindgen appelle `wasm.seal_send(…)` sur une instance encore
  // vide, d'où « seal_send is not a function » — un message qui accuse la fonction
  // alors que c'est le moment qui est faux.
  //
  // Ces deux fonctions étaient déjà `async` **sans jamais rien attendre** : la
  // signature disait l'intention, le corps l'avait perdue.
  //
  // `ensureCryptoReady` ne charge qu'une fois ; l'appeler ici ne coûte rien quand le
  // coffre est déjà ouvert, et répare le cas où il ne l'est pas — notamment la page
  // publique de lecture d'un partage, qui n'ouvre aucun coffre et n'initialisait donc
  // jamais le cœur.
  await ensureCryptoReady();
  const scelle = JSON.parse(seal_send(plaintext)) as {
    ciphertext: string;
    nonce: string;
    key: string;
  };
  return {
    ciphertext: scelle.ciphertext,
    iv: scelle.nonce,
    keyFragment: versFragment(scelle.key),
  };
}

/// Déchiffre un partage à partir du chiffré et du nonce (serveur) et de la clé (fragment).
export async function openSend(
  ciphertext: string,
  iv: string,
  keyFragment: string,
): Promise<string> {
  // Même raison que pour `sealSend`, et le cas est ici plus certain : la page qui
  // ouvre un partage n'ouvre pas de coffre, donc rien d'autre n'a chargé le cœur.
  await ensureCryptoReady();
  return open_send(depuisFragment(keyFragment), iv, ciphertext);
}
