// Test fonctionnel du binding WASM via la cible Node.
// Vérifie le cycle réel : inscription → chiffrement → déchiffrement → déverrouillage.
const assert = require("node:assert");
const { Account } = require("./pkg-node/ghostpass_crypto_wasm.js");

const PASSWORD = "hunter2-correct-horse";
const EMAIL = "kevin@stackops.ch";

const item = {
  name: "GitHub",
  notes: "compte pro",
  data: {
    kind: "Login",
    data: {
      username: "kevin",
      password: "s3cr3t!",
      uris: ["https://github.com"],
      totp: null,
    },
  },
};

// 1. Inscription : produit un blob (pour le serveur) + un compte (clés en mémoire WASM).
const reg = Account.register(PASSWORD, EMAIL);
const blob = JSON.parse(reg.blob);
const account = reg.account();
console.log("✓ register — clé publique (base64):", account.public_key.slice(0, 16) + "…");
assert.ok(blob.encrypted_user_key.startsWith("2."), "blob chiffré attendu");

// 2. Chiffrement d'un item avec l'USK (jamais exposée au JS).
const encrypted = account.encrypt_item(JSON.stringify(item));
assert.ok(!encrypted.includes("s3cr3t"), "le secret ne doit PAS apparaître en clair");
const decrypted = JSON.parse(account.decrypt_item(encrypted));
assert.deepStrictEqual(decrypted, item, "round-trip chiffrement échoué");
console.log("✓ encrypt/decrypt item — round-trip OK, aucun secret en clair");

// 3. Déverrouillage depuis le blob (comme à une reconnexion) puis re-déchiffrement.
const reopened = Account.unlock(
  PASSWORD,
  EMAIL,
  JSON.stringify(blob.kdf_params),
  blob.encrypted_user_key,
  blob.encrypted_private_key
);
const decrypted2 = JSON.parse(reopened.decrypt_item(encrypted));
assert.deepStrictEqual(decrypted2, item, "déchiffrement après unlock échoué");
console.log("✓ unlock — un compte rouvert déchiffre les mêmes items");

// 4. Mauvais mot de passe → échec attendu.
assert.throws(
  () =>
    Account.unlock(
      "mauvais-mot-de-passe",
      EMAIL,
      JSON.stringify(blob.kdf_params),
      blob.encrypted_user_key,
      blob.encrypted_private_key
    ),
  "un mauvais mot de passe doit échouer"
);
console.log("✓ unlock — mauvais mot de passe rejeté");

console.log("\n✅ Tous les tests WASM (Node) passent.");
