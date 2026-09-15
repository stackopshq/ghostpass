// Proxy de favicons auto-hébergé : le serveur récupère l'icône du site pour le client.
//
// Ce que ça donne, et ce que ça ne donne pas. Aucun tiers ne voit la LISTE des
// domaines d'un coffre — c'est le but, et il est atteint. Mais deux fuites
// subsistaient sous un commentaire qui affirmait le contraire :
//
//   1. Le site visité reçoit une requête, donc apprend qu'un utilisateur de
//      cette instance a une entrée chez lui. Inhérent à un proxy : la seule
//      façon de le supprimer est de ne pas chercher d'icône du tout, d'où
//      `ICONS_ENABLED` — voir plus bas.
//   2. Le cache était indexé sur le seul domaine et la route était PUBLIQUE :
//      n'importe qui pouvait demander `?domain=banque-x.example` et lire, dans
//      le temps de réponse, si le serveur l'avait récemment cherché — donc si
//      QUELQU'UN D'AUTRE avait cette entrée. C'est un oracle inter-locataires
//      sur un coffre-fort, et c'est ce que cette version ferme : la route
//      demande un jeton dérivé de la session, et le cache est cloisonné par
//      utilisateur. Un succès de cache ne renseigne plus que sur soi-même.
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

/// Chemins tentés, dans l'ordre. `/favicon.ico` seul ne suffit pas : la plupart
/// des sites modernes déclarent leur icône par un `<link rel="icon">` et ne
/// gardent aucun fichier à ce nom, et beaucoup de domaines apex ne servent rien
/// alors que leur `www.` sert tout. Jusqu'au 2026-08-28 le proxy s'arrêtait au
/// premier échec, d'où des entrées sans logo sans que rien ne le signale.
///
/// On ne lit PAS le HTML pour y chercher le `<link>` : ce serait plus complet,
/// mais cela veut dire récupérer du HTML arbitraire depuis une cible fournie par
/// l'utilisateur, sur un chemin dont les défenses sont calibrées pour des images
/// (content-type imposé, taille bornée). À décider séparément, après avoir mesuré
/// ce que ces chemins statiques rattrapent déjà.
export function candidateUrls(domain: string): string[] {
  const urls = [`https://${domain}/favicon.ico`];
  if (!domain.startsWith("www.")) urls.push(`https://www.${domain}/favicon.ico`);
  urls.push(`https://${domain}/apple-touch-icon.png`);
  urls.push(`https://${domain}/favicon.svg`);
  // Puis le site lui-même, quand l'hôte est un sous-domaine. Ces candidats viennent en
  // dernier : on préfère toujours l'icône de l'hôte exact quand il en a une.
  for (const parent of domainesParents(domain)) {
    urls.push(`https://${parent}/favicon.ico`);
  }
  return urls;
}

/// Les domaines parents d'un hôte, du plus proche au plus lointain.
///
/// Un coffre contient des adresses de *connexion*, pas des pages d'accueil :
/// `app.indy.fr`, `manager.infomaniak.com`, `login.example.com`. Ces sous-domaines ne
/// servent presque jamais d'icône — mesuré le 2026-08-29 : `app.indy.fr` répond 404 sur
/// les quatre chemins quand `indy.fr` rend une image. Les quatre chemins ajoutés la veille
/// ne rattrapaient pas ce cas, puisqu'ils portent tous sur l'hôte exact.
///
/// Deux parents au plus : c'est un bornage des appels sortants.
///
/// La borne « au moins deux étiquettes » ne suffit pas à éviter les suffixes publics, et
/// c'est un piège dans lequel on est tombé des deux côtés du projet : `example.co.uk` en
/// compte trois, donc elle laisse passer `co.uk`, qui n'appartient à personne. Ce n'est
/// pas une faille — une requête sortante garantie inutile, sur chaque domaine britannique,
/// australien ou japonais.
///
/// D'où le garde ci-dessous. C'est une heuristique, pas la Public Suffix List : elle
/// écarte `<sld>.<ccTLD de deux lettres>` pour une poignée de `sld` courants. Ce qu'elle
/// rate coûte une requête, jamais une faille ; la vraie liste compte plusieurs milliers
/// d'entrées à tenir à jour, pour un gain qui reste une requête.
const SLD_PUBLICS = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

function estUnSuffixePublic(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length !== 2) return false;
  return SLD_PUBLICS.has(labels[0]!) && labels[1]!.length === 2;
}

export function domainesParents(domain: string): string[] {
  const labels = domain.split(".");
  const parents: string[] = [];
  for (let i = 1; labels.length - i >= 2 && parents.length < 2; i++) {
    const parent = labels.slice(i).join(".");
    if (estUnSuffixePublic(parent)) break;
    parents.push(parent);
  }
  return parents;
}

/// Budget TOTAL de la résolution, tous candidats confondus. Sans lui, quatre
/// tentatives à FETCH_TIMEOUT_MS feraient attendre 16 s quelqu'un qui est en
/// train d'ajouter une entrée. On préfère renoncer tôt : un logo manquant est
/// bénin, une interface qui se fige ne l'est pas.
const TOTAL_BUDGET_MS = 6000;

/// Récupère une URL en suivant manuellement les redirections (chaque saut revalidé via safeLookup).
async function fetchOne(startUrl: string): Promise<FaviconResult> {
  let url = startUrl;
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

/// Essaie les candidats dans l'ordre et rend le premier qui donne une image.
/// Le cache négatif de l'appelant ne s'applique donc qu'après épuisement de la
/// liste — sinon un premier échec figerait l'absence pour une heure alors qu'un
/// autre chemin aurait répondu.
async function fetchFavicon(domain: string): Promise<FaviconResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const url of candidateUrls(domain)) {
    if (Date.now() >= deadline) break;
    try {
      const found = await fetchOne(url);
      if (found) return found;
    } catch {
      // Un candidat qui échoue n'empêche pas d'essayer le suivant : c'est tout
      // l'objet du changement.
    }
  }
  return null;
}

/// Point d'entrée : renvoie le favicon (avec cache positif/négatif), ou null.
///
/// `userId` n'est pas décoratif : il est la clé du cloisonnement. Sans lui, le
/// temps de réponse répondait à la question « quelqu'un d'autre a-t-il ce
/// domaine dans son coffre ? ». Le coût est une requête sortante par
/// utilisateur et par domaine sur la période, au lieu d'une pour tous : c'est
/// le prix exact de la fermeture de l'oracle, et il est assumé.
export async function resolveFavicon(userId: string, domain: string): Promise<FaviconResult> {
  const cle = `${userId}\u0000${domain}`;
  const hit = cache.get(cle);
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
  cache.set(cle, { value, expires: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}


// ─── Le jeton d'icône ───
//
// Une balise `<img>` ne porte pas d'en-tête d'autorisation : c'est la raison
// pour laquelle cette route était publique, et c'est un vrai obstacle, pas un
// oubli. On mint donc un jeton court, dérivé de la session, que le client
// accroche à l'URL.
//
// Il ne remplace pas le jeton de session et ne lui donne accès à rien d'autre :
// il ne sert qu'à nommer l'utilisateur pour le cloisonnement du cache. Le mettre
// dans une URL est acceptable pour cette raison — et parce que le journal
// n'écrit plus les chaînes de requête.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/// Clé de signature. Fournie par l'exploitant si les jetons doivent survivre à
/// un redémarrage ; sinon tirée au démarrage, auquel cas les clients
/// redemandent simplement un jeton. Pas de valeur par défaut en dur : une clé
/// partagée par toutes les installations ne signe rien.
const CLE_JETON = process.env.ICON_TOKEN_SECRET || randomBytes(32).toString("hex");

const DUREE_JETON_MS = 12 * 60 * 60 * 1000;

/// Le proxy peut être éteint : c'est la seule façon de supprimer la requête
/// sortante vers le site visité, qui est inhérente au principe même.
export const ICONS_ACTIVES = process.env.ICONS_ENABLED !== "false";

export function creerJetonIcone(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + DUREE_JETON_MS;
  const charge = `${userId}.${expiresAt}`;
  const signature = createHmac("sha256", CLE_JETON).update(charge).digest("base64url");
  return { token: `${Buffer.from(charge).toString("base64url")}.${signature}`, expiresAt };
}

/// Renvoie l'identifiant d'utilisateur si le jeton est valide et non expiré.
export function lireJetonIcone(token: string): string | null {
  const sep = token.lastIndexOf(".");
  if (sep <= 0) return null;
  const charge = Buffer.from(token.slice(0, sep), "base64url").toString();
  const attendue = createHmac("sha256", CLE_JETON).update(charge).digest("base64url");
  const fournie = token.slice(sep + 1);
  // Comparaison à temps constant, et sur des longueurs égales : `timingSafeEqual`
  // lève si elles diffèrent, ce qui serait un canal en soi.
  const a = Buffer.from(attendue);
  const b = Buffer.from(fournie);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const point = charge.lastIndexOf(".");
  if (point <= 0) return null;
  const expiresAt = Number(charge.slice(point + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return charge.slice(0, point);
}
