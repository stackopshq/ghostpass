# GhostPass 👻

Password manager **zero-knowledge** pour humains et équipes — avec, à terme, un volet
**Secrets Manager** (type HashiCorp Vault) pour les machines. Le serveur ne stocke que des
blobs chiffrés qu'il ne peut pas lire ; tout le chiffrement a lieu côté client.

## Structure (monorepo)

| Chemin | Rôle |
|---|---|
| `crates/ghostpass-crypto` | Cœur crypto Rust : Argon2id, XChaCha20-Poly1305, X25519, items, org, récupération |
| `crates/ghostpass-crypto-wasm` | Binding WASM du cœur (web + extension) |
| `apps/server` | Backend Fastify (auth, vault, MFA TOTP, récupération) |
| `apps/web` | Web app SPA Svelte (coffre, zero-knowledge côté client) |
| `ARCHITECTURE.md` | Plan d'architecture vivant (décisions, roadmap, modèle de menace) |

## État

MVP du coffre individuel **fonctionnel de bout en bout** : inscription, connexion, items
chiffrés, MFA TOTP et récupération de compte par kit de récupération. Validé par des tests
unitaires, d'intégration et des scénarios end-to-end.

- Cœur crypto : 21 tests · Backend : 22 tests + 2 e2e · Web : svelte-check + build OK.

## Build & tests

Voir le README de chaque composant.

> ⚠️ **Poste de dev derrière proxy** : l'accès à crates.io passe en direct — préfixer les
> commandes `cargo`/`npm` avec un `no_proxy` étendu (voir `crates/ghostpass-crypto/README.md`).
