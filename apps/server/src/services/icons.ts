// Proxy de favicons auto-hébergé : le serveur récupère l'icône du site pour le client.
// Objectif privacy : aucun tiers ne voit les domaines présents dans le coffre de l'utilisateur.
//
// ⚠️ Récupérer une URL fournie par l'utilisateur côté serveur est un vecteur SSRF. Défenses :
//   - on n'accepte qu'un *domaine* (jamais une URL/chemin arbitraire), on construit l'URL nous-mêmes ;
//   - HTTPS uniquement ; pas d'IP littérale ;
//   - résolution DNS + rejet de toute adresse privée/loopback/link-local, à CHAQUE saut de redirection ;
//   - timeout, taille de réponse bornée, content-type image obligatoire ;
//   - cache positif et négatif pour limiter les appels sortants.
import { lookup } from "node:dns/promises";
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

/// Vérifie que TOUTES les adresses résolues du domaine sont publiquement routables.
async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) throw new Error("ip literal");
  const addrs = await lookup(hostname, { all: true });
  if (addrs.length === 0) throw new Error("dns empty");
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) throw new Error("blocked address");
  }
}

async function fetchManual(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "user-agent": "GhostPass-Icon/1.0", accept: "image/*" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response): Promise<Buffer | null> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 0 && buf.length <= MAX_BYTES ? buf : null;
}

/// Récupère le favicon en suivant manuellement les redirections, en revalidant chaque saut.
async function fetchFavicon(domain: string): Promise<FaviconResult> {
  let url = `https://${domain}/favicon.ico`;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    await assertPublicHost(parsed.hostname); // garde SSRF à chaque saut

    const res = await fetchManual(url);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const data = await readCapped(res);
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
