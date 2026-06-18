// Couche crypto côté client : encapsule le module WASM.
// Les clés en clair restent DANS le WASM ; ce module n'expose que des données chiffrées.
import init, { Account, type Org } from "ghostpass-crypto-wasm";
import wasmUrl from "ghostpass-crypto-wasm/ghostpass_crypto_wasm_bg.wasm?url";

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

export interface LoginInput {
  name: string;
  username: string;
  password: string;
  notes?: string;
}

export interface DecryptedItem {
  name: string;
  username: string;
  password: string;
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
    data: {
      kind: "Login",
      data: { username: login.username, password: login.password, uris: [], totp: null },
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
    name: item.name,
    username: item.data.data.username,
    password: item.data.data.password,
  };
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
    data: {
      kind: "Login",
      data: { username: login.username, password: login.password, uris: [], totp: null },
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
  return { name: item.name, username: item.data.data.username, password: item.data.data.password };
}
