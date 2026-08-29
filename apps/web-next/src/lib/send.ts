// Partage de lien éphémère : chiffrement AES-256-GCM côté client. La clé est encodée pour le
// fragment d'URL (#) — elle n'est jamais envoyée au serveur, qui ne stocke que le chiffré.

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): ArrayBuffer {
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): ArrayBuffer {
  return fromB64(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export interface SealedSend {
  ciphertext: string;
  iv: string;
  keyFragment: string;
}

/// Chiffre un texte ; renvoie le chiffré + IV (pour le serveur) et la clé (pour le fragment d'URL).
export async function sealSend(plaintext: string): Promise<SealedSend> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv), keyFragment: toB64Url(raw) };
}

/// Déchiffre un Send à partir du chiffré/IV (serveur) et de la clé (fragment d'URL).
export async function openSend(
  ciphertext: string,
  iv: string,
  keyFragment: string,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromB64Url(keyFragment), { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ciphertext));
  return new TextDecoder().decode(pt);
}
