// Test d'intégration de bout en bout : reproduit le parcours exact de la web app
// (crypto WASM côté « client » + appels HTTP) contre le backend démarré pour de vrai.
// Lancement : `node --import tsx scripts/e2e.ts` depuis apps/server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const require = createRequire(import.meta.url);
// Le « client » utilise le même cœur crypto que le navigateur (ici la variante Node du WASM).
const { Account } = require("../../../crates/ghostpass-crypto-wasm/pkg-node/ghostpass_crypto_wasm.js");

const EMAIL = "kevin@stackops.ch";
const PW = "correct horse battery staple";

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

// 1. Inscription (le serveur ne reçoit que des blobs chiffrés).
const { account, data } = registrationData(EMAIL, PW);
let r = await http("/api/auth/register", { method: "POST", body: data });
assert.equal(r.status, 201, "register");
const token = r.json.token as string;
console.log("✓ inscription via l'API");

// 2. Chiffrement d'un secret côté client → stockage côté serveur.
const enc = encryptLogin(account, { name: "GitHub", username: "kevin", password: "s3cr3t!" });
r = await http("/api/vault/items", { method: "POST", body: enc, token });
assert.equal(r.status, 201, "create item");
console.log("✓ secret chiffré envoyé au serveur");

// 3. Relecture depuis le serveur + déchiffrement local.
r = await http("/api/vault/items", { token });
assert.equal(r.json.items.length, 1);
const dec = decryptItem(account, r.json.items[0].encryptedKey, r.json.items[0].encryptedData);
assert.equal(dec.data.data.password, "s3cr3t!", "round-trip déchiffrement");
console.log(`✓ secret relu et déchiffré : ${dec.name} / ${dec.data.data.username}`);

// 4. Reconnexion sur un « nouvel appareil » (prelogin → login → unlock → déchiffrement).
const pre = await http("/api/auth/prelogin", { method: "POST", body: { email: EMAIL } });
const hash = Account.master_password_hash(PW, EMAIL, pre.json.kdfParams);
const login = await http("/api/auth/login", { method: "POST", body: { email: EMAIL, masterPasswordHash: hash } });
assert.equal(login.status, 200, "login");
const account2 = Account.unlock(
  PW,
  EMAIL,
  login.json.kdfParams,
  login.json.encryptedUserKey,
  login.json.encryptedPrivateKey,
);
const list2 = await http("/api/vault/items", { token: login.json.token });
const dec2 = decryptItem(account2, list2.json.items[0].encryptedKey, list2.json.items[0].encryptedData);
assert.equal(dec2.data.data.password, "s3cr3t!", "déchiffrement après reconnexion");
console.log("✓ reconnexion sur un nouvel appareil → coffre déchiffré");

await app.close();
console.log("\n✅ E2E complet : crypto WASM (client) + backend + déchiffrement s'emboîtent parfaitement.");
