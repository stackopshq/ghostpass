// E2E du partage d'organisation : crypto WASM (admin + membre) + backend, de bout en bout.
// Lancement : `node --import tsx scripts/e2e-sharing.ts` depuis apps/server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/database.js";

const require = createRequire(import.meta.url);
const { Account } = require("../../../crates/ghostpass-crypto-wasm/pkg-node/ghostpass_crypto_wasm.js");

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

// 0. Inscription de l'admin et du membre (comptes + clés publiques côté serveur).
const admin = registrationData("admin@stackops.ch", "admin-pw");
const member = registrationData("member@stackops.ch", "member-pw");
const adminToken = (await http("/api/auth/register", { method: "POST", body: admin.data })).json.token;
const memberToken = (await http("/api/auth/register", { method: "POST", body: member.data })).json.token;
console.log("✓ admin et membre inscrits");

// 1. L'admin crée une organisation (Org Key scellée pour lui-même).
const creation = admin.account.create_org();
const org = creation.org();
const orgRes = await http("/api/orgs", {
  method: "POST",
  token: adminToken,
  body: { name: "StackOps", encryptedOrgKey: creation.sealed_for_self },
});
const orgId = orgRes.json.orgId as string;
console.log("✓ organisation créée");

// 2. L'admin crée une collection et y partage un secret (chiffré sous l'Org Key).
const colId = (
  await http(`/api/orgs/${orgId}/collections`, {
    method: "POST",
    token: adminToken,
    body: { name: "Infra" },
  })
).json.id as string;
const sharedItem = {
  name: "DB prod",
  notes: null,
  data: { kind: "Login", data: { username: "svc", password: "org-secret!", uris: [], totp: null } },
};
const enc = JSON.parse(org.encrypt_item(JSON.stringify(sharedItem)));
await http(`/api/orgs/${orgId}/collections/${colId}/items`, {
  method: "POST",
  token: adminToken,
  body: { encryptedKey: enc.encrypted_key, encryptedData: enc.encrypted_data },
});
console.log("✓ secret partagé chiffré et stocké");

// 3. L'admin invite le membre : récupère sa clé publique, scelle l'Org Key pour lui.
const memberPub = (await http(`/api/users/lookup?email=member@stackops.ch`, { token: adminToken })).json
  .publicKey as string;
const sealedForMember = admin.account.seal_org_key_for_member(org, memberPub);
await http(`/api/orgs/${orgId}/members`, {
  method: "POST",
  token: adminToken,
  body: { email: "member@stackops.ch", role: "member", encryptedOrgKey: sealedForMember },
});
console.log("✓ membre invité avec Org Key scellée (authentifiée)");

// 4. Le membre accepte, récupère son adhésion et ouvre l'Org Key (vérifie l'émetteur).
await http(`/api/orgs/${orgId}/accept`, { method: "POST", token: memberToken });
const membership = (await http(`/api/orgs/${orgId}/membership`, { token: memberToken })).json;
const memberOrg = member.account.open_org(membership.sealedByPublicKey, membership.encryptedOrgKey);
console.log("✓ membre : Org Key ouverte et vérifiée comme provenant de l'admin");

// 5. Le membre liste les items partagés et déchiffre le secret.
const items = (await http(`/api/orgs/${orgId}/collections/${colId}/items`, { token: memberToken })).json
  .items;
assert.equal(items.length, 1);
const dec = JSON.parse(
  memberOrg.decrypt_item(
    JSON.stringify({ encrypted_key: items[0].encryptedKey, encrypted_data: items[0].encryptedData }),
  ),
);
assert.equal(dec.data.data.password, "org-secret!", "le membre doit lire le secret partagé");
console.log(`✓ membre : secret partagé déchiffré → ${dec.name} / ${dec.data.data.username}`);

await app.close();
console.log("\n✅ E2E partage : crypto WASM + backend orgs/collections/items s'emboîtent parfaitement.");
