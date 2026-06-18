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

## Avant commercialisation (rappel)
- Pentest externe + programme de divulgation de vulnérabilités.
- Conformité nLPD/RGPD ; à terme SOC 2.
- Paramètres Argon2id à recalibrer selon le budget client (cible mémoire plus élevée).
