import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/// Re-hachage côté serveur du hash d'authentification fourni par le client.
///
/// Le client envoie déjà un hash dérivé de son mot de passe maître (jamais le mot de passe).
/// Le serveur le re-hache avec scrypt + salt avant stockage : une fuite de la base ne révèle
/// donc pas la valeur utile à un attaquant. `scrypt` est fourni par `node:crypto` (intégré).
const SCRYPT_KEYLEN = 64;

export function hashServerSecret(clientAuthHash: string): {
  hash: string;
  salt: string;
} {
  const salt = randomBytes(16);
  const derived = scryptSync(clientAuthHash, salt, SCRYPT_KEYLEN);
  return { hash: derived.toString("hex"), salt: salt.toString("hex") };
}

export function verifyServerSecret(
  clientAuthHash: string,
  storedHashHex: string,
  saltHex: string,
): boolean {
  const salt = Buffer.from(saltHex, "hex");
  const derived = scryptSync(clientAuthHash, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(storedHashHex, "hex");
  // Comparaison à temps constant.
  return derived.length === stored.length && timingSafeEqual(derived, stored);
}

/// Génère un token de session opaque et son empreinte (seule l'empreinte est stockée).
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

/// Normalise un email pour le stockage et le lookup (évite les doublons de casse / espaces).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/// Cible factice précalculée pour le scrypt « à vide ».
const DUMMY_TARGET = hashServerSecret("ghostpass-dummy-verification-target");

/// Exécute un scrypt à vide pour égaliser le temps de réponse quand le compte n'existe pas
/// (empêche l'énumération de comptes par timing). Le résultat est volontairement ignoré.
export function dummyVerify(clientAuthHash: string): void {
  verifyServerSecret(clientAuthHash, DUMMY_TARGET.hash, DUMMY_TARGET.salt);
}
