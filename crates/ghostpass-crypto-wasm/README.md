# ghostpass-crypto-wasm

Binding **WASM** du cœur crypto, pour la web app et l'**extension navigateur**.

Tout le chiffrement reste dans le module WASM : les clés en clair ne sont jamais exposées au
JavaScript. Le JS manipule un objet `Account` opaque et n'échange que des données chiffrées
(JSON `EncryptedItem`) ou publiques (clé publique base64).

## API exposée (classe `Account`)

| Méthode | Rôle |
|---|---|
| `Account.register(password, email)` | → `Registration` : `.blob` (JSON pour le serveur) + `.account()` |
| `Account.unlock(password, email, kdfParamsJson, encUserKey, encPrivateKey)` | rouvre un compte |
| `Account.master_password_hash(password, email, kdfParamsJson)` | hash d'auth (base64) pour le login |
| `Account.default_kdf_params()` | paramètres KDF par défaut (JSON) |
| `account.public_key` | clé publique de partage (base64) |
| `account.encrypt_item(vaultItemJson)` | → JSON `EncryptedItem` |
| `account.decrypt_item(encryptedItemJson)` | → JSON `VaultItem` |
| `account.create_recovery()` / `Account.recover(...)` | kit de récupération |
| `account.create_org()` | → `OrgCreation` : `.sealed_for_self` + `.org()` |
| `account.open_org(adminPublicKey, sealed)` | ouvre une Org Key reçue (vérifie l'émetteur) |
| `account.seal_org_key_for_member(org, memberPublicKey)` | distribue l'Org Key (authentifiée) |
| `org.encrypt_item / decrypt_item / rewrap_item` | items partagés (Org Key jamais exposée au JS) |

## Build

> Voir la note proxy dans `../ghostpass-crypto/README.md` (export `no_proxy` étendu).
> `wasm-pack` est installé via `cargo install wasm-pack` ; `~/.cargo/bin` doit être dans le PATH.

```bash
# Cible navigateur (livrable pour web + extension) → ./pkg
wasm-pack build --target web

# Cible Node (pour les tests) → ./pkg-node
wasm-pack build --target nodejs --out-dir pkg-node
node test-node.cjs        # round-trip register → chiffre → déchiffre → unlock
```
