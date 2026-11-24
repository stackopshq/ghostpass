// La surveillance du coffre : ce qui affaiblit les identifiants, calculé dans l'onglet.
//
// Rien ne part au serveur, qui ne pourrait de toute façon rien en lire : il ne
// voit que du chiffré. L'annuaire des sites (second facteur, clés d'accès) est
// une copie servie avec l'interface et lue en entier ; l'interroger site par
// site apprendrait à son éditeur la liste des comptes du coffre.

import { passwordStrength, type VaultEntry } from "@/lib/vault";

/// La copie de l'annuaire produite par `tools/annuaire/actualiser.py`.
export interface Annuaire {
  genere: string;
  sources: { nom: string; url: string; licence: string }[];
  /// Domaine → méthodes de second facteur (`totp`, `sms`, `u2f`…).
  tfa: Record<string, string[]>;
  /// Domaine → usages de la clé d'accès (`passwordless`, `mfa`).
  cles: Record<string, string[]>;
  documentation: Record<string, string>;
}

/// L'hôte d'une adresse saisie, sans `www.`. Une saisie sans schéma
/// (« github.com/login ») est lue comme une adresse https : c'est ainsi que
/// les gens les tapent.
export function hoteDe(adresse: string): string | null {
  const brut = adresse.trim();
  if (!brut) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(brut) ? brut : `https://${brut}`);
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!h.includes(".")) return null;
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/// L'entrée de l'annuaire qui couvre cet hôte : lui-même, ou le domaine dont il
/// est un sous-domaine (`accounts.google.com` → `google.com`). On remonte
/// étiquette par étiquette plutôt que de deviner le domaine enregistrable :
/// sans liste des suffixes publics, « co.uk » ne se distingue pas de
/// « github.io », et c'est l'annuaire qui sait ce qu'il référence.
export function dansLAnnuaire<T>(table: Record<string, T>, hote: string): T | undefined {
  const etiquettes = hote.split(".");
  for (let i = 0; i < etiquettes.length - 1; i++) {
    const trouve = table[etiquettes.slice(i).join(".")];
    if (trouve !== undefined) return trouve;
  }
  return undefined;
}

/// Une adresse en clair : le mot de passe y voyage lisible par quiconque est
/// sur le chemin. `localhost` et les adresses privées n'en sont pas : un
/// routeur ou un NAS de la maison ne sert souvent rien d'autre.
export function estNonSecurisee(adresse: string): boolean {
  if (!/^http:\/\//i.test(adresse.trim())) return false;
  const h = hoteDe(adresse);
  if (!h) return false;
  return !(
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".lan") ||
    /^(10|127)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/// Le dernier mois de validité d'une carte, lu dans « MM/AA » ou « MM/AAAA ».
///
/// Les deux formes arrivent réellement : la saisie demande « 12/30 », un
/// export Bitwarden importé donne l'année sur quatre chiffres. Une saisie
/// qu'on ne sait pas lire rend `null` : la surveillance se tait plutôt que de
/// déclarer expirée une carte dont elle ne comprend pas la date.
export function lireExpiration(brut: string | undefined): { annee: number; mois: number } | null {
  const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})\s*$/.exec(brut ?? "");
  if (!m) return null;
  const mois = Number(m[1]);
  const annee = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (mois < 1 || mois > 12) return null;
  return { annee, mois };
}

/// Le délai avant expiration à partir duquel une carte est signalée : le
/// temps de recevoir la nouvelle et de la reporter partout où l'ancienne est
/// enregistrée (abonnements, boutiques).
export const PREAVIS_CARTE_JOURS = 60;

/// « expiree », « bientot », ou `null` quand il n'y a rien à dire. Une carte
/// est valable jusqu'au DERNIER jour de son mois : « 11/26 » sert encore le
/// 30 novembre 2026, et n'expire qu'au premier décembre, heure locale.
export function etatExpiration(
  brut: string | undefined,
  maintenant: number,
): "expiree" | "bientot" | null {
  const e = lireExpiration(brut);
  if (!e) return null;
  // `new Date(annee, mois, 1)` : le mois est compté de 0, c'est donc le
  // premier jour du mois SUIVANT, premier instant où la carte ne vaut plus.
  const fin = new Date(e.annee, e.mois, 1).getTime();
  if (maintenant >= fin) return "expiree";
  if (fin - maintenant <= PREAVIS_CARTE_JOURS * 86_400_000) return "bientot";
  return null;
}

export interface Constat {
  reutilises: VaultEntry[];
  faibles: VaultEntry[];
  nonSecurises: VaultEntry[];
  /// Le site propose un code à usage unique et l'élément n'en a pas.
  totpDisponible: VaultEntry[];
  /// Le site accepte une clé d'accès.
  clesDisponibles: VaultEntry[];
  /// Les cartes expirées puis celles qui expirent bientôt, les plus urgentes
  /// d'abord. Elles ne pèsent pas sur le score, qui note les mots de passe.
  cartes: { item: VaultEntry; etat: "expiree" | "bientot" }[];
  /// Le coffre contient au moins une carte : sinon la carte de surveillance
  /// qui en parle n'a pas lieu d'être.
  aDesCartes: boolean;
  /// Nombre de mots de passe par niveau de force, de 0 (très faible) à 4.
  repartition: [number, number, number, number, number];
  /// Les identifiants examinés : ceux qui portent un mot de passe.
  examines: number;
}

/// Ce que la surveillance retient, sur les identifiants qui ne sont pas archivés.
///
/// L'archive est exclue comme partout ailleurs : un élément qu'on a sorti du
/// quotidien n'a pas à faire baisser le score de ce qu'on utilise.
export function constater(
  items: VaultEntry[],
  annuaire: Annuaire | null,
  maintenant: number = Date.now(),
): Constat {
  const identifiants = items.filter((i) => i.kind === "login" && i.password);
  const occurrences = new Map<string, number>();
  for (const i of identifiants) occurrences.set(i.password, (occurrences.get(i.password) ?? 0) + 1);

  const repartition: Constat["repartition"] = [0, 0, 0, 0, 0];
  const constat: Constat = {
    reutilises: [],
    faibles: [],
    nonSecurises: [],
    totpDisponible: [],
    clesDisponibles: [],
    cartes: [],
    aDesCartes: false,
    repartition,
    examines: identifiants.length,
  };
  for (const i of items) {
    if (i.kind !== "card") continue;
    constat.aDesCartes = true;
    const etat = etatExpiration(i.cardExp, maintenant);
    if (etat) constat.cartes.push({ item: i, etat });
  }
  constat.cartes.sort((a, b) => (a.etat === b.etat ? 0 : a.etat === "expiree" ? -1 : 1));
  for (const i of identifiants) {
    const force = passwordStrength(i.password).niveau;
    repartition[force]++;
    if ((occurrences.get(i.password) ?? 0) > 1) constat.reutilises.push(i);
    if (force <= 1) constat.faibles.push(i);
    if (i.urls.some(estNonSecurisee)) constat.nonSecurises.push(i);
    if (annuaire) {
      const hotes = i.urls.map(hoteDe).filter((h): h is string => h !== null);
      if (!i.totp && hotes.some((h) => dansLAnnuaire(annuaire.tfa, h)?.includes("totp"))) {
        constat.totpDisponible.push(i);
      }
      if (hotes.some((h) => dansLAnnuaire(annuaire.cles, h) !== undefined)) {
        constat.clesDisponibles.push(i);
      }
    }
  }
  return constat;
}

/// Le score, sur 100 : la part des identifiants sans problème, pondérée.
///
/// Un mot de passe réutilisé, faible, envoyé en clair ou retrouvé dans une
/// fuite est un défaut ; un second facteur disponible et absent n'en est
/// qu'un demi, parce que le mot de passe peut être bon. Les clés d'accès
/// disponibles ne comptent pas : c'est une suggestion, pas un défaut.
///
/// Un coffre sans identifiant n'a rien à noter : `null`, pas 100.
export function score(c: Constat, compromis: ReadonlySet<string> = new Set()): number | null {
  if (c.examines === 0) return null;
  const penalite = new Map<string, number>();
  const ajouter = (l: VaultEntry[], poids: number) => {
    for (const i of l) penalite.set(i.id, Math.min(1, (penalite.get(i.id) ?? 0) + poids));
  };
  ajouter(c.reutilises, 1);
  ajouter(c.faibles, 1);
  ajouter(c.nonSecurises, 1);
  ajouter(c.totpDisponible, 0.5);
  for (const id of compromis) penalite.set(id, 1);
  let total = 0;
  for (const p of penalite.values()) total += p;
  return Math.round(100 * (1 - total / c.examines));
}

/// Le mot qui accompagne le score.
export function appreciation(s: number): "excellent" | "bon" | "moyen" | "faible" {
  if (s >= 90) return "excellent";
  if (s >= 75) return "bon";
  if (s >= 50) return "moyen";
  return "faible";
}
