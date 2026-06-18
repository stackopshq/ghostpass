// Test fonctionnel du partage d'organisation via le binding WASM (cible Node).
// Vérifie : création d'org, distribution authentifiée de l'Org Key, partage et déchiffrement.
const assert = require("node:assert");
const { Account } = require("./pkg-node/ghostpass_crypto_wasm.js");

const sharedItem = {
  name: "Base de données prod",
  notes: null,
  data: {
    kind: "Login",
    data: { username: "svc", password: "org-secret!", uris: [], totp: null },
  },
};

// Admin + membre + intrus, chacun avec son compte (donc sa paire de clés).
const admin = Account.register("admin-pw", "admin@stackops.ch").account();
const member = Account.register("member-pw", "member@stackops.ch").account();
const intruder = Account.register("x-pw", "intruder@stackops.ch").account();

// 1. L'admin crée une organisation (Org Key générée, scellée pour lui-même).
const creation = admin.create_org();
const sealedForSelf = creation.sealed_for_self;
const org = creation.org();
console.log("✓ org créée (Org Key jamais exposée au JS)");

// 2. L'admin chiffre un secret partagé sous l'Org Key.
const enc = org.encrypt_item(JSON.stringify(sharedItem));
assert.ok(!enc.includes("org-secret"), "le secret ne doit pas apparaître en clair");

// 3. L'admin distribue l'Org Key au membre (box authentifiée admin→membre).
const sealedForMember = admin.seal_org_key_for_member(org, member.public_key);

// 4. Le membre ouvre l'Org Key en vérifiant qu'elle vient bien de l'admin, puis déchiffre.
const memberOrg = member.open_org(admin.public_key, sealedForMember);
const dec = JSON.parse(memberOrg.decrypt_item(enc));
assert.deepStrictEqual(dec, sharedItem, "le membre doit retrouver le secret partagé");
console.log("✓ membre : Org Key vérifiée (vient de l'admin) + secret partagé déchiffré");

// 5. Authenticité : ouvrir en prétendant un autre émetteur que l'admin doit échouer.
assert.throws(
  () => member.open_org(intruder.public_key, sealedForMember),
  "une fausse clé d'admin doit être rejetée",
);
console.log("✓ authenticité : substitution d'émetteur rejetée");

// 6. Un intrus (mauvaise clé privée) ne peut pas ouvrir l'Org Key destinée au membre.
assert.throws(
  () => intruder.open_org(admin.public_key, sealedForMember),
  "un non-destinataire ne doit pas pouvoir ouvrir",
);
console.log("✓ confidentialité : non-destinataire rejeté");

// 7. L'admin se ré-ouvre l'org depuis le blob scellé pour lui-même.
const adminOrgAgain = admin.open_org(admin.public_key, sealedForSelf);
const dec2 = JSON.parse(adminOrgAgain.decrypt_item(enc));
assert.deepStrictEqual(dec2, sharedItem);
console.log("✓ admin : ré-ouverture de l'org via le blob personnel");

console.log("\n✅ Partage d'organisation (WASM) : distribution authentifiée + partage OK.");
