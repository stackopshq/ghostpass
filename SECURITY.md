# Sécurité — GhostPass

## Modèle de menace
GhostPass est **zero-knowledge** : le serveur ne stocke que des blobs chiffrés et ne peut
déchiffrer aucun coffre. Le mot de passe maître n'atteint jamais le serveur. La cible de
sécurité inclut un **serveur actif/malveillant** (hypothèse forte d'un password manager).

## Audit interne — 2026-06-18
Double revue adversariale (cœur crypto Rust + backend). Bilan : invariant zero-knowledge
préservé, primitives saines (XChaCha20-Poly1305, HKDF, tokens 256 bits, SQL paramétré, pas
d'IDOR). Les faiblesses portaient sur le durcissement et la résistance au serveur actif.

### Corrigé (durcissement)
- **Anti-downgrade KDF** : les `KdfParams` reçus du serveur sont validés côté client
  (`KdfParams::ensure_strong`, planchers 64 Mio / 3 passes) avant toute dérivation.
- **Hygiène mémoire** : `Zeroizing` étendu à tous les secrets transitoires (master key, clés
  dérivées, item keys, clé de récupération, payloads en clair).
- Dépendance `subtle` inutilisée retirée.
- **Rate-limiting** global (`@fastify/rate-limit`), **helmet**, **CORS** configurable,
  **bodyLimit** (anti-DoS).
- **Anti-énumération par timing** : scrypt « à vide » exécuté quand le compte est inconnu
  (login et recover).
- **Révocation de session** : endpoint `POST /api/auth/logout`.
- **Anti-rejeu TOTP** : compteur de période consommé (login & disable) ; fenêtre ±1.
- **Opérations 2FA sensibles** (`setup`, `disable`) re-authentifiées par mot de passe.
- **`recovery-blob` uniformisé** (réponse leurre déterministe → pas d'énumération).
- **Email normalisé** côté serveur ; détails d'erreur zod non exposés ; error-handler
  générique ; logger activé.

### Reporté — à traiter avec le partage / organisations
Ces points concernent le modèle multi-parties et seront traités dans la conception du partage :
- **Authenticité de la distribution d'Org Key** : le `sealed box` X25519 est anonyme ; un
  serveur actif pourrait substituer une Org Key. ⇒ signer la distribution de clés.
- **Révocation réelle** : la rotation d'Org Key ré-enveloppe les item keys mais ne re-protège
  pas les secrets déjà exposés à un membre révoqué. ⇒ rotation des secrets eux-mêmes +
  documentation honnête de la garantie.

## Audit interne — 2026-06-19
Second audit (cœur Rust + WASM + backend + SPA), après l'ajout du proxy de favicons, du registre
de dossiers chiffré, de la corbeille, du TOTP client, du générateur, de l'import CSV et des
notes/cartes. **Bilan : invariant zero-knowledge préservé, aucun finding critique.** Primitives
saines, SQL paramétré, cloisonnement `user_id` systématique (corbeille incluse), pas d'IDOR ni
d'injection exploitable, pas de XSS (Svelte échappe ; aucun `{@html}`).

### Corrigé
- **SSRF par DNS-rebinding (TOCTOU) du proxy favicons** : le fetch passe désormais par
  `node:https` avec un `lookup` **validant** — l'IP utilisée pour la connexion est exactement
  celle validée (rejet privé/loopback/link-local), revalidée à chaque redirection, IP littérale
  refusée même après redirect. Fin de la fenêtre validation≠connexion.
- **Cap mémoire du favicon** : lecture **en streaming** abandonnée dès `MAX_BYTES` (un serveur
  omettant `Content-Length` ne peut plus gonfler la mémoire).
- **Anti-downgrade KDF déplacé dans `derive_master_key`** (chokepoint unique) : protège tous les
  chemins (register/unlock/hash/recover) **et tous les bindings** (WASM + futur FFI natif), plus
  seulement la couche WASM.
- **Énumération / récolte de clés** : rate-limit dédié (20/min) sur `/api/users/lookup`.
- **Machine à états d'adhésion** : `POST /api/orgs/:id/accept` refuse une adhésion non `invited` (409).

### Reporté (durcissement défense-en-profondeur, non bloquant)
- **Lier `KdfParams` + email en AAD** du chiffrement de l'USK (détecter une altération serveur des
  paramètres même au-dessus des planchers). Touche au format chiffré → migration à prévoir.
- **Chiffrer le secret TOTP serveur au repos** (clé serveur dédiée, 12-factor) — hors périmètre ZK
  utilisateur, mais limite l'impact d'une fuite de base.
- **Zeroize** des plaintexts déchiffrés et de la clé de récupération (Rust).
- **Validation `EncString`** à la désérialisation (longueur de nonce / ciphertext) ; **AAD liant
  `encrypted_key`↔`encrypted_data`** lors de la ré-enveloppe d'Org Key.
- **Rôles org** : un `member` peut créer des collections / octroyer `manage` ; garde « dernier
  admin » absente — à arbitrer selon le modèle voulu.
- **Salt KDF déterministe** (par email) : compromis assumé (pas d'aller-retour serveur) — à figer
  en ADR. **`cargo audit`/`osv-scanner` + `.strict()` Zod** en défense en profondeur.

## Avant commercialisation (rappel)
- Pentest externe + programme de divulgation de vulnérabilités.
- Conformité nLPD/RGPD ; à terme SOC 2.
- Paramètres Argon2id à recalibrer selon le budget client (cible mémoire plus élevée).
