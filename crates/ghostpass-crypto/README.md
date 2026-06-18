# ghostpass-crypto

Cœur cryptographique **zero-knowledge** de GhostPass.
Compilable en natif (clients desktop/mobile via FFI) et en WASM (web + extension).

## Contenu

| Module | Rôle |
|---|---|
| `kdf` | Argon2id (Master Key) + HKDF-Expand (clé de chiffrement / hash d'auth, séparés par domaine) |
| `symmetric` | Chiffrement authentifié XChaCha20-Poly1305 |
| `sharing` | Partage par clé publique X25519 (sealed box) — pour les Org Keys |
| `encstring` | Format sérialisable `2.<nonce_b64>.<ciphertext_b64>` |
| `keys` | Hiérarchie de clés : `register` / `unlock` / `master_password_hash` |
| `vault` | Items (login/note/carte) chiffrés par *item key* ; `rewrap_item_key` |
| `org` | Org Key : distribution aux membres + `rotate_org_key` (révocation) |
| `error` | Erreurs opaques (pas d'oracle) |

Toutes les primitives proviennent de l'écosystème **RustCrypto** audité — aucune crypto maison.

## Build & tests

> ⚠️ **Réseau** : sur le poste de dev (Rocky Linux, derrière le proxy `dfinet`), le proxy
> **bloque crates.io et rustup**. La toolchain est installée via `dnf`, et `cargo` doit
> accéder aux registres **en direct**. Préfixer les commandes par un `no_proxy` étendu :

```bash
export no_proxy="crates.io,rust-lang.org,github.com,githubusercontent.com,${no_proxy}"
export NO_PROXY="$no_proxy"

cargo test                          # 12 tests d'intégration
cargo clippy --all-targets -- -D warnings
cargo fmt
```

Toolchain installée via : `sudo dnf install -y rust cargo rustfmt clippy nodejs npm`.
