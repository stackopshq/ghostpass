// Générateur de mots de passe — aléa cryptographique (WebCrypto), 100 % client.

export interface GenOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export const DEFAULT_GEN_OPTIONS: GenOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
};

const SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

/// Entier uniforme dans [0, max) via rejection sampling (pas de biais modulo).
function randomIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x = 0;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return x % max;
}

/// Génère un mot de passe respectant les options ; garantit ≥1 caractère de chaque jeu activé.
export function generatePassword(opts: GenOptions): string {
  const active: string[] = [];
  if (opts.lowercase) active.push(SETS.lowercase);
  if (opts.uppercase) active.push(SETS.uppercase);
  if (opts.digits) active.push(SETS.digits);
  if (opts.symbols) active.push(SETS.symbols);
  if (active.length === 0) active.push(SETS.lowercase);

  const length = Math.max(active.length, Math.min(128, Math.floor(opts.length) || 20));
  const pool = active.join("");
  const chars: string[] = [];

  // Au moins un caractère de chaque jeu actif.
  for (const set of active) chars.push(set[randomIndex(set.length)]!);
  // Le reste, depuis le pool complet.
  for (let i = chars.length; i < length; i++) chars.push(pool[randomIndex(pool.length)]!);

  // Mélange Fisher-Yates pour ne pas figer la position des caractères garantis.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
