// Couche crypto côté client : encapsule le module WASM.
// Les clés en clair restent DANS le WASM ; ce module n'expose que des données chiffrées.
import init, { Account, type EmergencyVault, type Org } from "ghostpass-crypto-wasm";
import { lireRegistreCouleurs, ORG_COLORS_ITEM_NAME, type RegistreCouleurs } from "./couleursOrg";
// Le module WASM est servi depuis `public/`, pas importé par le empaqueteur.
//
// Vite acceptait `import wasmUrl from "….wasm?url"` — un suffixe qui lui est
// propre, que webpack ne connaît pas. Plutôt que de dépendre d'une extension
// d'empaqueteur, on sert le fichier comme une ressource statique et on donne son
// chemin : `init()` le récupère par `fetch`, ce qui ne demande rien à personne et
// marche identiquement en développement, à la construction et derrière un cache.
//
// La contrepartie est qu'une copie du .wasm doit atterrir dans `public/` — c'est
// le rôle du script `prebuild` de package.json, et non un geste manuel : une
// copie faite à la main devient périmée au premier `cargo build`.
const wasmUrl = "/ghostpass_crypto_wasm_bg.wasm";

let ready: Promise<unknown> | null = null;

/// Initialise le module WASM une seule fois.
export function ensureCryptoReady(): Promise<unknown> {
  if (!ready) ready = init({ module_or_path: wasmUrl });
  return ready;
}

export interface RegistrationData {
  email: string;
  masterPasswordHash: string;
  kdfParams: string;
  encryptedUserKey: string;
  encryptedPrivateKey: string;
  publicKey: string;
}

export interface LoginBlobs {
  kdfParams: string;
  encryptedUserKey: string;
  encryptedPrivateKey: string;
}

export type ItemKind = "login" | "note" | "card";

export interface LoginInput {
  name: string;
  username: string;
  password: string;
  url?: string;
  folder?: string;
  totp?: string;
  notes?: string;
  passwordHistory?: string[];
}

/// Entrée générique du coffre perso (login / note / carte).
export interface ItemInput {
  kind: ItemKind;
  name: string;
  folder?: string;
  // login
  username?: string;
  password?: string;
  url?: string;
  totp?: string;
  passwordHistory?: string[];
  // note
  note?: string;
  // carte
  cardholder?: string;
  cardNumber?: string;
  cardExp?: string; // "MM/AA"
  cardCode?: string;
}

export interface DecryptedItem {
  kind: ItemKind;
  name: string;
  folder: string;
  // login
  username: string;
  password: string;
  url: string;
  totp: string;
  passwordHistory: string[];
  // note
  note: string;
  // carte
  cardholder: string;
  cardNumber: string;
  cardExp: string;
  cardCode: string;
}

/// Valeurs par défaut (tous champs vides) pour construire un DecryptedItem.
function emptyItem(kind: ItemKind, name: string, folder: string): DecryptedItem {
  return {
    kind,
    name,
    folder,
    username: "",
    password: "",
    url: "",
    totp: "",
    passwordHistory: [],
    note: "",
    cardholder: "",
    cardNumber: "",
    cardExp: "",
    cardCode: "",
  };
}

/// Nom sentinelle de l'item « registre des dossiers » (item de métadonnées masqué dans l'UI).
// Le NUL est ÉCHAPPÉ et non littéral : un octet nul brut fait classer le
// fichier comme binaire, et `grep` le saute alors sans rien dire — sur la
// couche cryptographique, c'est le pire endroit où être invisible aux outils
// d'analyse. La valeur à l'exécution est identique, et un test la verrouille.
export const FOLDERS_ITEM_NAME = "\u0000gp:folders";

/// Le registre des partages en cours, rangé comme celui des dossiers : une note
/// sécurisée à nom réservé, chiffrée par la clé du coffre.
///
/// C'est là que vivent les jetons de révocation rendus par ghostbit. Le serveur
/// ne les voit pas — les lui confier ferait de lui le détenteur d'un pouvoir de
/// révocation sur des partages qu'il ne peut pas lire, et l'existence même de la
/// liste lui apprendrait qui partage quoi et quand. C'est la décision du
/// 2026-08-29 : le registre est chiffré, côté client.
export const SHARES_ITEM_NAME = "\u0000gp:shares";

/// Le registre des couleurs d'organisation, rangé comme les deux précédents :
/// une note sécurisée à nom réservé, chiffrée par la clé du coffre.
///
/// Il ne contient aucun secret — seulement des teintes — mais il vit là parce
/// que c'est le seul endroit que le web, iOS et l'extension lisent tous les
/// trois.
///
/// Le nom lui-même est déclaré dans `couleursOrg`, avec le reste du contrat
/// partagé avec iOS, et réexporté ici pour se lire auprès de ses deux voisins.
export { ORG_COLORS_ITEM_NAME };

/// Un partage en cours, tel que son créateur le retient.
export interface PartageEnCours {
  id: string;
  /// L'URL COMPLÈTE rendue par le serveur, fragment compris. On ne la
  /// reconstruit pas depuis l'identifiant : c'est l'erreur qui aurait produit
  /// des liens morts sur iOS quand le paste a déménagé chez ghostbit.
  url: string;
  deleteToken: string;
  /// Le nom de l'entrée partagée, pour que la liste soit lisible — jamais le
  /// secret. Le registre dit ce qui circule, pas ce qu'il contient.
  name: string;
  /// SECONDES depuis l'époque, comme `expiresAt` et comme le serveur.
  ///
  /// Ce champ valait des MILLISECONDES jusqu'au 2026-08-30, parce que
  /// `Date.now()` en rend et que personne ne s'était demandé si l'autre champ
  /// faisait pareil — il ne le faisait pas : ghostbit calcule
  /// `now = int(time.time())`. Deux unités dans une même structure partagée
  /// entre le web, iOS et l'extension, c'est une erreur d'affichage qui attend
  /// son heure, du genre qu'on découvre en voyant une date en 1970 ou en 57000.
  ///
  /// Corrigé pendant que c'était encore gratuit : aucun registre n'existait
  /// nulle part. Un lecteur qui trouverait une valeur à treize chiffres lit un
  /// enregistrement écrit par une version antérieure à cette correction ; il
  /// n'y en a pas.
  createdAt: number;
  /// SECONDES depuis l'époque — rendu tel quel par ghostbit, jamais converti.
  /// Deux clients qui convertiraient différemment afficheraient deux échéances
  /// pour le même partage.
  expiresAt: number | null;
}

/// Crée un compte localement et renvoie les données à transmettre au serveur + l'objet `Account`.
export function register(email: string, password: string): {
  data: RegistrationData;
  account: Account;
} {
  const reg = Account.register(password, email);
  const blob = JSON.parse(reg.blob);
  const account = reg.account();
  return {
    account,
    data: {
      email,
      masterPasswordHash: blob.master_password_hash,
      kdfParams: JSON.stringify(blob.kdf_params),
      encryptedUserKey: blob.encrypted_user_key,
      encryptedPrivateKey: blob.encrypted_private_key,
      publicKey: account.public_key,
    },
  };
}

/// Construit l'URL du proxy de favicons, ou null si la saisie n'est pas exploitable.
///
/// Le favicon est servi par NOTRE serveur : aucun tiers ne voit la liste des
/// domaines du coffre. Il en voit UN, le sien, quand l'icône est cherchée — cette
/// requête-là est inhérente au principe, et l'exploitant peut l'éteindre.
///
/// `jeton` est requis depuis que la route n'est plus publique : son cache est
/// cloisonné par utilisateur, faute de quoi le temps de réponse répondait à
/// « quelqu'un d'autre a-t-il ce domaine ? ». Sans jeton, pas d'icône — on rend
/// null plutôt qu'une URL qui ferait un 401 par image.
export function faviconUrl(raw: string, jeton: string | null): string | null {
  if (!raw || !jeton) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    if (!host.includes(".")) return null;
    return `/api/icons?domain=${encodeURIComponent(host)}&t=${encodeURIComponent(jeton)}`;
  } catch {
    return null;
  }
}

/// Calcule le hash d'authentification à envoyer au serveur lors d'une connexion.
export function computeLoginHash(email: string, password: string, kdfParams: string): string {
  return Account.master_password_hash(password, email, kdfParams);
}

/// Reconstruit l'objet `Account` (les clés) à partir des blobs renvoyés par le serveur.
export function unlock(email: string, password: string, blobs: LoginBlobs): Account {
  return Account.unlock(
    password,
    email,
    blobs.kdfParams,
    blobs.encryptedUserKey,
    blobs.encryptedPrivateKey,
  );
}

/// Chiffre un login en item de coffre. Renvoie les deux blobs à stocker côté serveur.
export function encryptLogin(
  account: Account,
  login: LoginInput,
): { encryptedKey: string; encryptedData: string } {
  const item = {
    name: login.name,
    notes: login.notes ?? null,
    folder: login.folder || null,
    data: {
      kind: "Login",
      data: {
        username: login.username,
        password: login.password,
        uris: login.url ? [login.url] : [],
        totp: login.totp || null,
        password_history: login.passwordHistory ?? [],
      },
    },
  };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

export interface RecoveryKit {
  recoveryKey: string;
  recoveryAuthHash: string;
  encryptedUserKeyRecovery: string;
}

/// Génère un kit de récupération pour le compte déverrouillé.
export function createRecovery(account: Account): RecoveryKit {
  const a = JSON.parse(account.create_recovery());
  return {
    recoveryKey: a.recovery_key,
    recoveryAuthHash: a.recovery_auth_hash,
    encryptedUserKeyRecovery: a.encrypted_user_key_recovery,
  };
}

export interface ResetData {
  masterPasswordHash: string;
  recoveryAuthHash: string;
  encryptedUserKey: string;
}

/// Récupère un compte via sa clé de récupération et prépare le blob de réinitialisation.
export function recoverAccount(
  recoveryKey: string,
  email: string,
  newPassword: string,
  kdfParams: string,
  encryptedUserKeyRecovery: string,
  encryptedPrivateKey: string,
): ResetData {
  const res = Account.recover(
    recoveryKey,
    email,
    newPassword,
    kdfParams,
    encryptedUserKeyRecovery,
    encryptedPrivateKey,
  );
  const reset = JSON.parse(res.reset);
  return {
    masterPasswordHash: reset.master_password_hash,
    recoveryAuthHash: reset.recovery_auth_hash,
    encryptedUserKey: reset.encrypted_user_key,
  };
}

/// Déchiffre un item stocké côté serveur.
export function decryptItem(
  account: Account,
  encryptedKey: string,
  encryptedData: string,
): DecryptedItem {
  const json = account.decrypt_item(
    JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData }),
  );
  const item = JSON.parse(json);
  return {
    ...emptyItem("login", item.name, item.folder ?? ""),
    username: item.data.data.username,
    password: item.data.data.password,
    url: item.data.data.uris?.[0] ?? "",
    totp: item.data.data.totp ?? "",
    // La charge chiffree ecrit `notes` (schema d'item), le modele dechiffre
    // expose `note` -- asymetrie reelle, a respecter des deux cotes. Ce champ
    // etait chiffre par encryptOrgLogin et jamais relu ici : une note saisie
    // sur un secret d'organisation partait dans le coffre et n'en ressortait
    // plus. Perte silencieuse, sans message ni champ vide visible.
    note: item.notes ?? "",
    passwordHistory: item.data.data.password_history ?? [],
  };
}

/// Déchiffre un item du coffre perso : soit une entrée (login/note/carte), soit le registre de dossiers.
export type VaultDecryptResult =
  | { kind: "item"; item: DecryptedItem }
  | { kind: "shares"; shares: PartageEnCours[] }
  | { kind: "folders"; paths: string[] }
  | { kind: "orgcolors"; couleurs: RegistreCouleurs };

export function decryptVaultItem(
  account: Account,
  encryptedKey: string,
  encryptedData: string,
): VaultDecryptResult {
  const raw = JSON.parse(
    account.decrypt_item(
      JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData }),
    ),
  );
  const d = raw.data ?? {};
  const folder = raw.folder ?? "";

  if (raw.name === SHARES_ITEM_NAME && d.kind === "SecureNote") {
    let partages: unknown = [];
    try {
      partages = JSON.parse(d.data.content);
    } catch {
      // Un registre illisible vaut vide, pas panne : il ne contient aucun
      // secret, seulement des jetons de révocation. Faire échouer le
      // chargement du coffre pour lui priverait de tout pour préserver un
      // confort.
      partages = [];
    }
    return { kind: "shares", shares: Array.isArray(partages) ? (partages as PartageEnCours[]) : [] };
  }

  if (raw.name === ORG_COLORS_ITEM_NAME && d.kind === "SecureNote") {
    let couleurs: unknown = {};
    try {
      couleurs = JSON.parse(d.data.content);
    } catch {
      // Comme les deux registres voisins : illisible vaut vide, pas panne. Ce
      // fichier ne porte que des teintes, et faire échouer le chargement du
      // coffre pour une teinte serait hors de proportion.
      couleurs = {};
    }
    // La normalisation vit dans `couleursOrg` : ce qui entre ici a pu être
    // écrit par iOS, par l'extension, ou par une version qu'on ne connaît pas.
    return { kind: "orgcolors", couleurs: lireRegistreCouleurs(couleurs) };
  }

  if (raw.name === FOLDERS_ITEM_NAME && d.kind === "SecureNote") {
    let paths: unknown = [];
    try {
      paths = JSON.parse(d.data.content);
    } catch {
      paths = [];
    }
    return { kind: "folders", paths: Array.isArray(paths) ? (paths as string[]) : [] };
  }

  if (d.kind === "SecureNote") {
    return { kind: "item", item: { ...emptyItem("note", raw.name, folder), note: d.data?.content ?? "" } };
  }
  if (d.kind === "Card") {
    const c = d.data ?? {};
    return {
      kind: "item",
      item: {
        ...emptyItem("card", raw.name, folder),
        // La charge chiffrée écrit `notes`, le modèle déchiffré expose `note` :
        // asymétrie réelle du schéma d'item, à respecter des deux côtés. La
        // relire ici est ce qui rend la note visible après un aller-retour ;
        // `decryptItem`, côté organisations, la relit depuis toujours.
        note: raw.notes ?? "",
        cardholder: c.cardholder ?? "",
        cardNumber: c.number ?? "",
        cardExp: [c.exp_month, c.exp_year].filter(Boolean).join("/"),
        cardCode: c.code ?? "",
      },
    };
  }
  const l = d.data ?? {};
  return {
    kind: "item",
    item: {
      ...emptyItem("login", raw.name, folder),
      // Même asymétrie que pour la carte : `notes` chiffré, `note` déchiffré.
      note: raw.notes ?? "",
      username: l.username ?? "",
      password: l.password ?? "",
      url: l.uris?.[0] ?? "",
      totp: l.totp ?? "",
      passwordHistory: l.password_history ?? [],
    },
  };
}

/// Chiffre une entrée générique du coffre perso (login / note / carte).
export function encryptItem(
  account: Account,
  input: ItemInput,
): { encryptedKey: string; encryptedData: string } {
  let data: unknown;
  if (input.kind === "note") {
    data = { kind: "SecureNote", data: { content: input.note ?? "" } };
  } else if (input.kind === "card") {
    const [m, y] = (input.cardExp ?? "").split("/");
    data = {
      kind: "Card",
      data: {
        cardholder: input.cardholder ?? "",
        number: input.cardNumber ?? "",
        exp_month: (m ?? "").trim(),
        exp_year: (y ?? "").trim(),
        code: input.cardCode ?? "",
      },
    };
  } else {
    data = {
      kind: "Login",
      data: {
        username: input.username ?? "",
        password: input.password ?? "",
        uris: input.url ? [input.url] : [],
        totp: input.totp || null,
        password_history: input.passwordHistory ?? [],
      },
    };
  }
  // `notes` porte la note d'un identifiant ou d'une carte, comme le fait déjà
  // `encryptOrgLogin` pour les secrets d'équipe. Ce champ valait `null` en dur :
  // le formulaire et l'import CSV passaient bien une note, elle était jetée ici.
  // Silencieux des deux côtés : l'import annonçait le bon nombre d'entrées, et
  // aucune n'avait gardé sa note.
  //
  // Un item de type « note » range la sienne dans `data.content`, pas ici : l'y
  // répéter en ferait deux copies, dont une qu'aucun écran ne lit.
  const notes = input.kind === "note" ? null : input.note || null;
  const item = { name: input.name, notes, folder: input.folder || null, data };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

/// Chiffre le registre des dossiers (liste de chemins) en item de métadonnées (SecureNote).
export function encryptShares(
  account: Account,
  partages: PartageEnCours[],
): { encryptedKey: string; encryptedData: string } {
  const item = {
    name: SHARES_ITEM_NAME,
    notes: null,
    folder: null,
    data: { kind: "SecureNote", data: { content: JSON.stringify(partages) } },
  };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

/// Chiffre le registre des couleurs d'organisation.
///
/// L'objet est écrit PLAT, tel quel : ni enveloppe, ni champ de version. iOS
/// lit exactement cette forme, et l'entourer de quoi que ce soit reviendrait à
/// lui faire lire un registre vide.
export function encryptOrgColors(
  account: Account,
  couleurs: RegistreCouleurs,
): { encryptedKey: string; encryptedData: string } {
  const item = {
    name: ORG_COLORS_ITEM_NAME,
    notes: null,
    folder: null,
    data: { kind: "SecureNote", data: { content: JSON.stringify(couleurs) } },
  };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

export function encryptFolders(
  account: Account,
  paths: string[],
): { encryptedKey: string; encryptedData: string } {
  const item = {
    name: FOLDERS_ITEM_NAME,
    notes: null,
    folder: null,
    data: { kind: "SecureNote", data: { content: JSON.stringify(paths) } },
  };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

// ─── Passkey passwordless (PRF) ───
/// (Enrôlement) Enveloppe l'USK avec le secret PRF (base64) de la passkey.
export function wrapUserKeyForPasskey(account: Account, prfSecretB64: string): string {
  return account.wrap_user_key_for_passkey(prfSecretB64);
}

/// (Login) Déverrouille un compte sans mot de passe à partir du secret PRF et des blobs serveur.
export function unlockWithPasskey(
  prfSecretB64: string,
  prfWrappedUserKey: string,
  encryptedPrivateKey: string,
): Account {
  return Account.unlock_with_passkey(prfSecretB64, prfWrappedUserKey, encryptedPrivateKey);
}

// ─── Accès d'urgence ───
export type EmergencyHandle = EmergencyVault;

export interface EmergencyItem {
  name: string;
  username: string;
  password: string;
  url: string;
}

/// (Grantor) Scelle son USK pour la clé publique d'un contact de confiance.
export function sealUserKeyFor(account: Account, contactPublicKey: string): string {
  return account.seal_user_key_for(contactPublicKey);
}

/// (Contact) Ouvre l'accès d'urgence reçu (vérifie l'émetteur) → handle détenant l'USK du grantor.
export function openEmergency(account: Account, grantorPublicKey: string, sealed: string): EmergencyVault {
  return account.open_emergency(grantorPublicKey, sealed);
}

/// (Contact) Déchiffre un item du coffre du grantor via le handle d'urgence.
export function decryptEmergencyItem(
  vault: EmergencyVault,
  encryptedKey: string,
  encryptedData: string,
): EmergencyItem {
  const item = JSON.parse(
    vault.decrypt_item(JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData })),
  );
  const d = item.data?.data ?? {};
  return {
    name: item.name,
    username: d.username ?? "",
    password: d.password ?? "",
    url: d.uris?.[0] ?? "",
  };
}

/// (Contact, takeover) Prépare la réinitialisation du mot de passe maître du grantor.
export function emergencyTakeover(
  vault: EmergencyVault,
  grantorEmail: string,
  grantorKdfParams: string,
  newPassword: string,
): { masterPasswordHash: string; encryptedUserKey: string } {
  const r = JSON.parse(vault.takeover(grantorEmail, grantorKdfParams, newPassword));
  return { masterPasswordHash: r.master_password_hash, encryptedUserKey: r.encrypted_user_key };
}

// ─── Partage / organisations ───
export type OrgHandle = Org;

/// Crée une organisation : renvoie le contexte `Org` + l'Org Key scellée pour soi (au serveur).
export function createOrg(account: Account): { org: Org; sealedForSelf: string } {
  const creation = account.create_org();
  const sealedForSelf = creation.sealed_for_self;
  return { org: creation.org(), sealedForSelf };
}

/// Ouvre l'Org Key reçue (vérifie qu'elle provient bien de l'admin).
export function openOrg(account: Account, adminPublicKey: string, sealed: string): Org {
  return account.open_org(adminPublicKey, sealed);
}

/// Scelle l'Org Key pour un membre (en tant qu'admin).
export function sealOrgKeyForMember(account: Account, org: Org, memberPublicKey: string): string {
  return account.seal_org_key_for_member(org, memberPublicKey);
}

/// Chiffre un login sous l'Org Key (secret partagé).
export function encryptOrgLogin(
  org: Org,
  login: LoginInput,
): { encryptedKey: string; encryptedData: string } {
  const item = {
    name: login.name,
    notes: login.notes ?? null,
    folder: login.folder || null,
    data: {
      kind: "Login",
      data: {
        username: login.username,
        password: login.password,
        uris: login.url ? [login.url] : [],
        totp: login.totp || null,
        password_history: login.passwordHistory ?? [],
      },
    },
  };
  const enc = JSON.parse(org.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

/// Ré-enveloppe l'item key d'une ancienne Org Key vers une nouvelle (rotation/révocation).
/// Renvoie la nouvelle `encryptedKey` (le contenu chiffré reste inchangé).
export function rewrapOrgItem(
  newOrg: Org,
  oldOrg: Org,
  encryptedKey: string,
  encryptedData: string,
): string {
  const r = JSON.parse(
    newOrg.rewrap_item(
      oldOrg,
      JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData }),
    ),
  );
  return r.encrypted_key;
}

/// Déchiffre un item partagé sous l'Org Key.
export function decryptOrgItem(
  org: Org,
  encryptedKey: string,
  encryptedData: string,
): DecryptedItem {
  const json = org.decrypt_item(
    JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData }),
  );
  const item = JSON.parse(json);
  return {
    ...emptyItem("login", item.name, item.folder ?? ""),
    username: item.data.data.username,
    password: item.data.data.password,
    url: item.data.data.uris?.[0] ?? "",
    totp: item.data.data.totp ?? "",
    passwordHistory: item.data.data.password_history ?? [],
  };
}
