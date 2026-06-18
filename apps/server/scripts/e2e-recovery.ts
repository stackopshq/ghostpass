// E2E de la récupération de compte : kit de récupération (WASM) + backend, de bout en bout.
// Lancement : `node --import tsx scripts/e2e-recovery.ts` depuis apps/server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const require = createRequire(import.meta.url);
const { Account } = require("../../../crates/ghostpass-crypto-wasm/pkg-node/ghostpass_crypto_wasm.js");

const EMAIL = "kevin@stackops.ch";
const OLD_PW = "ancien-mot-de-passe";
const NEW_PW = "tout-nouveau-mot-de-passe";

function registrationData(email: string, password: string) {
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

function encryptLogin(account: any, l: { name: string; username: string; password: string }) {
  const item = {
    name: l.name,
    notes: null,
    data: { kind: "Login", data: { username: l.username, password: l.password, uris: [], totp: null } },
  };
  const enc = JSON.parse(account.encrypt_item(JSON.stringify(item)));
  return { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data };
}

function decryptItem(account: any, encryptedKey: string, encryptedData: string) {
  return JSON.parse(
    account.decrypt_item(JSON.stringify({ encrypted_key: encryptedKey, encrypted_data: encryptedData })),
  );
}

const app = buildApp(openDatabase(":memory:"));
const base = await app.listen({ port: 0, host: "127.0.0.1" });

async function http(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(base + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

// 1. Inscription + un secret dans le coffre.
const { account, data } = registrationData(EMAIL, OLD_PW);
let r = await http("/api/auth/register", { method: "POST", body: data });
const token = r.json.token as string;
const enc = encryptLogin(account, { name: "GitHub", username: "kevin", password: "s3cr3t!" });
await http("/api/vault/items", { method: "POST", body: enc, token });
console.log("✓ compte + secret créés");

// 2. Génération du kit de récupération (clé affichée à l'utilisateur, blobs au serveur).
const artifacts = JSON.parse(account.create_recovery());
r = await http("/api/account/recovery", {
  method: "POST",
  token,
  body: {
    recoveryAuthHash: artifacts.recovery_auth_hash,
    encryptedUserKeyRecovery: artifacts.encrypted_user_key_recovery,
  },
});
assert.equal(r.status, 201, "enrôlement récupération");
console.log("✓ kit de récupération enregistré (clé conservée par l'utilisateur)");

// 3. Mot de passe oublié → récupération des blobs + reconstruction locale.
const blobRes = await http("/api/auth/recovery-blob", { method: "POST", body: { email: EMAIL } });
assert.equal(blobRes.status, 200);
const rec = Account.recover(
  artifacts.recovery_key,
  EMAIL,
  NEW_PW,
  blobRes.json.kdfParams,
  blobRes.json.encryptedUserKeyRecovery,
  blobRes.json.encryptedPrivateKey,
);
const reset = JSON.parse(rec.reset);
console.log("✓ clé de récupération acceptée localement, nouveau mot de passe préparé");

// 4. Envoi du reset au serveur (preuve = recovery_auth_hash).
r = await http("/api/auth/recover", {
  method: "POST",
  body: {
    email: EMAIL,
    recoveryAuthHash: reset.recovery_auth_hash,
    newMasterPasswordHash: reset.master_password_hash,
    newEncryptedUserKey: reset.encrypted_user_key,
  },
});
assert.equal(r.status, 200, "reset accepté");
console.log("✓ mot de passe réinitialisé côté serveur (anciennes sessions invalidées)");

// 5. Connexion avec le NOUVEAU mot de passe → le coffre est toujours là et déchiffrable.
const pre = await http("/api/auth/prelogin", { method: "POST", body: { email: EMAIL } });
const newHash = Account.master_password_hash(NEW_PW, EMAIL, pre.json.kdfParams);
const login = await http("/api/auth/login", {
  method: "POST",
  body: { email: EMAIL, masterPasswordHash: newHash },
});
assert.equal(login.status, 200, "login nouveau mot de passe");
const account3 = Account.unlock(
  NEW_PW,
  EMAIL,
  login.json.kdfParams,
  login.json.encryptedUserKey,
  login.json.encryptedPrivateKey,
);
const list = await http("/api/vault/items", { token: login.json.token });
const dec = decryptItem(account3, list.json.items[0].encryptedKey, list.json.items[0].encryptedData);
assert.equal(dec.data.data.password, "s3cr3t!", "secret toujours déchiffrable");
console.log(`✓ reconnexion avec le nouveau mot de passe → secret intact : ${dec.name}`);

// 6. L'ancien mot de passe ne fonctionne plus.
const oldHash = Account.master_password_hash(OLD_PW, EMAIL, pre.json.kdfParams);
const oldLogin = await http("/api/auth/login", {
  method: "POST",
  body: { email: EMAIL, masterPasswordHash: oldHash },
});
assert.equal(oldLogin.status, 401, "ancien mot de passe rejeté");
console.log("✓ l'ancien mot de passe est bien rejeté");

await app.close();
console.log("\n✅ E2E récupération : kit de récupération + reset + reconnexion fonctionnent.");
