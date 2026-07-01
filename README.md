# GhostPass 👻

Password manager **zero-knowledge** pour humains et équipes — avec, à terme, un volet
**Secrets Manager** (type HashiCorp Vault) pour les machines. Le serveur ne stocke que des
blobs chiffrés qu'il ne peut pas lire ; tout le chiffrement a lieu côté client.

## Captures d'écran

<p align="center">
  <img src="docs/screenshots/vault-dark.png" alt="Coffre GhostPass — identifiants chiffrés, dossiers, détail d'un item" width="860">
</p>

<p align="center">
  <em>Le coffre : tout est déchiffré localement, le serveur ne voit que des blobs. Dossiers, favicons auto-hébergés, indicateur de robustesse.</em>
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/generator.png" alt="Ajout d'un identifiant avec le générateur de mots de passe intégré"></td>
    <td width="50%"><img src="docs/screenshots/security.png" alt="Sécurité : Password Health, vérification de fuites HIBP, TOTP, passkeys"></td>
  </tr>
  <tr>
    <td align="center"><em>Générateur — chiffré sur l'appareil avant l'envoi</em></td>
    <td align="center"><em>Password Health · fuites (HIBP k-anonymity) · TOTP · passkeys</em></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/vault-light.png" alt="Coffre GhostPass en thème clair" width="860">
</p>

<p align="center"><em>Thème clair également disponible.</em></p>

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
