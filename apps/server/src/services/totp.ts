// TOTP (RFC 6238) implémenté avec `node:crypto` — aucune dépendance externe.
// Le secret TOTP est un second facteur d'AUTHENTIFICATION : le serveur le connaît pour
// vérifier les codes. Il ne déchiffre rien du coffre (zero-knowledge préservé).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of str.replace(/=+$/, "").toUpperCase()) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const truncated = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (truncated % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/// Génère un nouveau secret TOTP (base32, 20 octets).
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/// URI `otpauth://` à présenter en QR code à l'application d'authentification.
export function otpauthUri(secretB32: string, email: string): string {
  const label = encodeURIComponent(`GhostPass:${email}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer: "GhostPass",
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/// Calcule le code TOTP courant (utile pour les tests).
export function generateTOTP(secretB32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretB32), counter);
}

/// Vérifie un code avec une fenêtre de ±1 période (tolérance d'horloge).
export function verifyTOTP(secretB32: string, code: string, atMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  const candidate = Buffer.from(code);
  for (let w = -1; w <= 1; w++) {
    const expected = Buffer.from(hotp(secret, counter + w));
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return true;
    }
  }
  return false;
}
