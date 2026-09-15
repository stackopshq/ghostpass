// Génération de codes TOTP (RFC 6238) côté client.
// Le secret TOTP est stocké dans l'item chiffré et ne quitte jamais le navigateur (zero-knowledge).

function base32Decode(input: string): ArrayBuffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (const ch of clean) {
    const i = alphabet.indexOf(ch);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out.buffer.slice(0, idx);
}

export interface OtpConfig {
  secret: string;
  period: number;
  digits: number;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
}

/// Accepte un secret base32 brut OU une URI `otpauth://`. Renvoie null si vide/invalide.
export function parseOtp(input: string): OtpConfig | null {
  if (!input) return null;
  let secret = input.trim();
  let period = 30;
  let digits = 6;
  let algorithm: OtpConfig["algorithm"] = "SHA-1";

  if (/^otpauth:\/\//i.test(secret)) {
    try {
      const params = new URL(secret).searchParams;
      secret = params.get("secret") ?? "";
      period = Number(params.get("period")) || 30;
      digits = Number(params.get("digits")) || 6;
      const alg = params.get("algorithm");
      if (alg === "SHA256") algorithm = "SHA-256";
      else if (alg === "SHA512") algorithm = "SHA-512";
    } catch {
      return null;
    }
  }

  secret = secret.replace(/\s/g, "").toUpperCase();
  if (!secret) return null;
  return { secret, period, digits, algorithm };
}

/// Calcule le code courant et le nombre de secondes restantes dans la période.
export async function generateOtp(
  cfg: OtpConfig,
  now: number = Date.now(),
): Promise<{ code: string; remaining: number }> {
  const key = base32Decode(cfg.secret);
  if (key.byteLength === 0) throw new Error("clé TOTP invalide");

  const counter = Math.floor(now / 1000 / cfg.period);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32), false);
  view.setUint32(4, counter >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: cfg.algorithm },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));

  const offset = sig[sig.length - 1]! & 0x0f;
  const bin =
    ((sig[offset]! & 0x7f) << 24) |
    (sig[offset + 1]! << 16) |
    (sig[offset + 2]! << 8) |
    sig[offset + 3]!;
  const code = (bin % 10 ** cfg.digits).toString().padStart(cfg.digits, "0");
  const remaining = cfg.period - Math.floor((now / 1000) % cfg.period);
  return { code, remaining };
}
