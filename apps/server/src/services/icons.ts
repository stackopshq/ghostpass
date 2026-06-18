// Proxy de favicons auto-hébergé : le serveur récupère l'icône du site pour le client.
// Objectif privacy : aucun tiers ne voit les domaines présents dans le coffre de l'utilisateur.
//
// ⚠️ Récupérer une URL fournie par l'utilisateur côté serveur est un vecteur SSRF. Défenses :
//   - on n'accepte qu'un *domaine* (jamais une URL/chemin arbitraire), on construit l'URL nous-mêmes ;
//   - HTTPS uniquement ; pas d'IP littérale (même sur redirection) ;
//   - DNS résolu via un `lookup` validant passé à la connexion : l'IP utilisée pour se connecter
//     EST celle validée (rejet privé/loopback/link-local), ce qui ferme la fenêtre TOCTOU /
//     DNS-rebinding (pas de seconde résolution non contrôlée) ; revalidé à chaque saut ;
//   - timeout, taille de réponse bornée EN STREAMING, content-type image obligatoire ;
//   - cache positif et négatif pour limiter les appels sortants.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpsGet } from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

const MAX_BYTES = 100 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
const MAX_REDIRECTS = 3;

// Domaine DNS valide (labels, TLD alphabétique d'au moins 2 caractères). Pas d'IP, pas de port.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export type FaviconResult = { data: Buffer; contentType: string } | null;

interface CacheSlot {
  value: FaviconResult;
  expires: number;
}
const cache = new Map<string, CacheSlot>();

/// Extrait et valide un domaine depuis une saisie (domaine nu ou URL complète).
export function normalizeDomain(input: string): string | null {
  let d = (input ?? "").trim().toLowerCase();
  if (!d) return null;
  if (d.includes("/") || d.includes("://")) {
    try {
      d = new URL(d.includes("://") ? d : `https://${d}`).hostname;
    } catch {
      return null;
    }
  }
  if (d.startsWith("www.")) d = d.slice(4);
  if (isIP(d)) return null; // pas d'IP littérale (anti-SSRF)
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

/// Rejette les plages d'adresses non routables publiquement (anti-SSRF).
function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const a = p[0]!;
    const b = p[1]!;
    if (a === 0 || a === 10 || a === 127) return true; // this-host, privé, loopback
    if (a === 169 && b === 254) return true; // link-local (métadonnées cloud)
    if (a === 172 && b >= 16 && b <= 31) return true; // privé
    if (a === 192 && b === 168) return true; // privé
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // IETF / protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + réservé
    return false;
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase();
    if (ip6 === "::1" || ip6 === "::") return true; // loopback / non spécifié
    if (ip6.startsWith("fe80") || ip6.startsWith("fc") || ip6.startsWith("fd")) return true; // link-local / ULA
    if (ip6.startsWith("ff")) return true; // multicast
    // IPv4 mappé/compatible : revalide la partie v4.
    const v4 = ip6.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1];
    if (v4 && (ip6.startsWith("::ffff:") || ip6.startsWith("::"))) return isBlockedAddress(v4);
    return false;
  }
  return true; // forme inconnue → bloqué
}

/// `lookup` validant : ne renvoie que des adresses publiquement routables. Comme c'est CE lookup
/// qui sert à la connexion réelle, l'IP contactée est exactement celle validée → pas de TOCTOU.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    const ok = addresses.filter((a) => !isBlockedAddress(a.address));
    if (ok.length === 0) return callback(new Error("blocked address"), "", 0);
    if (typeof options === "object" && options.all) {
      return callback(null, ok as unknown as string, 0);
    }
    callback(null, ok[0]!.address, ok[0]!.family);
  });
};

/// Une requête HTTPS GET, connexion bornée par le `safeLookup`. Renvoie la réponse brute (stream).
function httpsRequest(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      {
        lookup: safeLookup,
        headers: { "user-agent": "GhostPass-Icon/1.0", accept: "image/*" },
        timeout: FETCH_TIMEOUT_MS,
      },
      resolve,
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/// Lit le corps en streaming en abandonnant dès que MAX_BYTES est dépassé (anti-DoS mémoire).
function readStreamCapped(res: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    res.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        res.destroy();
        resolve(null);
      } else {
        chunks.push(chunk);
      }
    });
    res.on("end", () => resolve(total > 0 ? Buffer.concat(chunks) : null));
    res.on("error", () => resolve(null));
  });
}

/// Récupère le favicon en suivant manuellement les redirections (chaque saut revalidé via safeLookup).
async function fetchFavicon(domain: string): Promise<FaviconResult> {
  let url = `https://${domain}/favicon.ico`;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (isIP(parsed.hostname)) return null; // pas d'IP littérale, même après redirection

    const res = await httpsRequest(url);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const loc = res.headers.location;
      res.resume(); // draine la réponse de redirection
      if (!loc) return null;
      url = new URL(loc, url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      return null;
    }
    const contentType = (res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      res.resume();
      return null;
    }
    const data = await readStreamCapped(res);
    return data ? { data, contentType } : null;
  }
  return null;
}

/// Point d'entrée : renvoie le favicon (avec cache positif/négatif), ou null.
export async function resolveFavicon(domain: string): Promise<FaviconResult> {
  const hit = cache.get(domain);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: FaviconResult = null;
  try {
    value = await fetchFavicon(domain);
  } catch {
    value = null;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest: string | undefined = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(domain, { value, expires: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}
