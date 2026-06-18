# GhostPass — Plan d'architecture

> Document de conception vivant. Objectif : **produit commercial multi-utilisateurs**
> (équipes, partage de secrets, SSO) avec un modèle **zero-knowledge**.
> Statut : conception initiale.

---

## 0. Principes directeurs (non négociables)

1. **Zero-knowledge** : le serveur ne doit JAMAIS pouvoir déchiffrer les secrets d'un
   utilisateur. Il ne stocke que des blobs chiffrés et le matériel cryptographique
   lui-même chiffré.
2. **Ne jamais inventer de crypto** : uniquement des primitives auditées
   (libsodium, WebCrypto, Argon2). Aucun algorithme maison.
3. **Le chiffrement se fait sur le client** (navigateur, app desktop/mobile, extension),
   jamais sur le serveur.
4. **Sécurité par défaut** : MFA, rotation de clés, expiration de session, audit log
   activés d'office.
5. **Auditabilité** : tout le code crypto isolé dans un module testable, documenté,
   destiné à être audité par un tiers avant la mise en vente.

---

## 1. Modèle de menace

Adversaires considérés :

- **Serveur/BDD compromis** → ne doit révéler aucun secret en clair (d'où zero-knowledge).
- **Attaquant réseau (MITM)** → TLS + chiffrement applicatif de bout en bout.
- **Brute-force du master password** → Argon2id à coût élevé + jamais transmis au serveur.
- **Employé malveillant côté GhostPass** → ne peut pas lire les coffres (pas d'accès aux clés).
- **Vol d'appareil** → coffre verrouillé, clés effacées de la mémoire au lock.
- **Compte SSO compromis** → MFA + (selon design) le master password reste un second facteur.

Hors périmètre initial (à documenter pour les clients) : malware avec keylogger sur la
machine de l'utilisateur, attaque sur l'IdP du client.

---

## 2. Cœur cryptographique

### Dérivation des clés (à la connexion)

```
Master Password + email (salt)
        │
   Argon2id (paramètres élevés, calibrés)
        ▼
   Master Key (256 bits)  ──── ne quitte jamais le client
        │
   ┌────┴───────────────────────┐
HKDF-Expand                  HKDF-Expand
   │                            │
Stretched Master Key      "Master Password Hash"
(chiffre la clé sym.)     (envoyé au serveur pour l'auth uniquement —
                           re-hashé côté serveur avec Argon2/bcrypt)
```

### Hiérarchie de clés

- **User Symmetric Key (USK)** : clé symétrique aléatoire, chiffrée par la Stretched Master
  Key. C'est elle qui protège réellement le coffre. → permet de changer le master password
  sans tout re-chiffrer (on re-chiffre juste l'USK).
- **Paire de clés asymétrique utilisateur (RSA-2048/4096 ou X25519)** : clé privée chiffrée
  par l'USK. Sert au **partage** (recevoir des clés chiffrées d'autres utilisateurs).
- **Item Key** : chaque secret possède sa propre clé symétrique, chiffrée par l'USK (ou par
  la clé d'organisation pour les secrets partagés).

### Algorithmes retenus

| Usage | Algorithme |
|---|---|
| Dérivation de clé | **Argon2id** |
| Chiffrement symétrique | **XChaCha20-Poly1305** (ou AES-256-GCM) |
| Chiffrement asymétrique (partage) | **X25519** (sealed box) ou RSA-OAEP |
| Intégrité / MAC | inclus dans les modes AEAD ci-dessus |
| Hash d'auth serveur | Argon2id (re-hash du hash client) |

---

## 3. SSO + gestion de la clé (le point le plus délicat)

SSO et zero-knowledge sont en tension : en SSO, l'utilisateur ne tape pas son master
password → d'où vient la clé de déchiffrement ?

Trois patterns possibles (du plus simple au plus avancé) :

1. **SSO pour l'auth + master password conservé** (MVP) : le SSO authentifie l'identité,
   mais l'utilisateur garde un master password pour déverrouiller le coffre. Simple, sûr,
   mais double saisie.
2. **Trusted Device Encryption** : un appareil déjà déverrouillé approuve les nouveaux
   appareils ; les clés transitent chiffrées entre appareils de confiance. Pas de master
   password à terme. Plus complexe (gestion d'approbation, récupération).
3. **Key Connector** : un micro-service **auto-hébergé par le client entreprise** qui détient
   une clé et la fournit après une auth SSO réussie. Permet le "SSO sans master password"
   tout en gardant GhostPass zero-knowledge (la clé n'est jamais chez nous). Cible entreprise.

**Décision proposée** : implémenter (1) d'abord, concevoir le schéma pour permettre (2) et (3)
plus tard. Protocole SSO : **OIDC** en priorité (plus simple que SAML), SAML en phase 2 pour
les grands comptes.

---

## 4. Partage & multi-utilisateurs

Modèle inspiré des organisations/collections :

- **Organisation** : possède une **Org Key** symétrique.
- L'Org Key est distribuée à chaque membre **chiffrée avec sa clé publique** (X25519/RSA).
  → seul un membre invité peut la déchiffrer avec sa clé privée.
- **Collections** : regroupent des secrets ; permissions par rôle (admin / manager / user /
  read-only) appliquées côté serveur (autorisation) ET garanties par la possession des clés.
- **Inviter un membre** : l'admin chiffre l'Org Key avec la clé publique de l'invité.
- **Révoquer** : retirer l'accès + **rotation de l'Org Key** (re-chiffrement) pour les cas
  sensibles.

Le serveur gère **qui a accès** (autorisation) mais ne peut pas lire le contenu (les clés
restent chiffrées).

### Décisions arrêtées (incrément partage)
- **Invitation + acceptation** : l'admin invite par email ; l'Org Key est scellée pour la clé
  publique de l'invité à l'acceptation (invitation en attente tant qu'il n'a pas de compte).
- **Collections** : les secrets sont groupés en collections partagées à des membres.
- **Rôles** : Admin (gère membres + secrets) / Membre (lit/modifie) / Lecture seule.
- **Authenticité de l'Org Key** (correctif audit #2) : distribution via une box **authentifiée**
  (`crypto_box` ChaChaBox, expéditeur = admin), pas une sealed box anonyme. Réutilise les paires
  X25519 existantes ; un serveur actif sans clé privée ne peut pas substituer d'Org Key.
- **Révocation réelle** (correctif audit #3) : révoquer un membre déclenche la rotation de
  l'Org Key + des item keys, et signale explicitement que les secrets déjà exposés doivent être
  changés (rotation des mots de passe côté utilisateur).

### Plan d'implémentation (par lots)
1. ✅ **Crypto/WASM** : box authentifiée dans `sharing` (corrige audit #2) + exposition au
   binding WASM — classe `Org` (encrypt/decrypt/rewrap d'items, Org Key jamais exposée au JS)
   + `Account.create_org` / `open_org` / `seal_org_key_for_member`. Testé en Node.
2. ✅ **Backend** :
   - ✅ 3a — tables `organizations`/`org_members`, création d'org, lookup de clé publique,
     ajout de membre (Org Key scellée), invitation/acceptation, adhésion (clé + émetteur),
     liste membres, contrôle de rôle admin.
   - ✅ 3b — **collections** + **items partagés** (CRUD) avec permissions par rôle
     (lecture pour tous, écriture admin/member, cloisonnement cross-org). **e2e partage complet**
     (`scripts/e2e-sharing.ts`) : crypto WASM + backend de bout en bout.
   - ✅ 3c — **révocation par rotation d'Org Key** (retrait membre + re-scellement des clés +
     ré-enveloppe des items, atomique, admin only). **37 tests backend.**
   - ✅ Permissions **fines par collection** (`collection_access` : read/write/manage ;
     admin d'org = `manage` implicite) + endpoint d'octroi. **38 tests backend.**
   - ✅ **Rate-limiting strict par route** sur les endpoints sensibles (login/register/recover…).
3. ✅ **UI** (`apps/web`, `Organizations.svelte`) : onglet Organisations — créer une org,
   inviter (lookup clé publique + scellement), accepter, membres, collections, partage et
   lecture de secrets (déchiffrés côté client), **révocation** (rotation côté client) et
   **octroi d'accès par collection**. svelte-check + build OK.

---

## 4bis. Volet « Secrets Manager » (type HashiCorp Vault)

Le produit vise **deux faces** : le coffre humain (zero-knowledge) ET un gestionnaire de
secrets pour machines/applications/infra, dans l'esprit de HashiCorp Vault / Bitwarden
Secrets Manager / Infisical / Doppler.

> **Décisions arrêtées :**
> - **Périmètre complet** visé : KV statique (E2E), secrets dynamiques, PKI, Transit.
> - **Modèle hybride** : KV en zero-knowledge ; moteurs actifs (dynamique/PKI/Transit) dans un
>   composant séparé **auto-hébergeable par le client** (préserve l'argument souveraineté CH).
> - **Phase ultérieure** : on livre d'abord le coffre humain (extension → backend → SSO),
>   puis le Secrets Manager. Mais le **modèle d'identité** prévoit les *service accounts* dès
>   le départ pour éviter un refactor.

### Tension fondamentale : zero-knowledge ↔ secrets actifs
- **KV statique** (clés d'API, secrets d'app) : peut rester **zero-knowledge / E2E**. Une
  machine ou un *service account* possède une paire de clés ; on lui scelle les clés des
  secrets autorisés. ⇒ **réutilise directement le cœur crypto actuel** (`sharing`, `vault`, `org`).
- **Secrets dynamiques** (credentials DB/cloud temporaires générés à la volée), **PKI**
  (émission de certificats), **Transit** (chiffrement-as-a-service) : **incompatibles avec le
  zero-knowledge strict** — le serveur doit détenir des clés et opérer sur les secrets
  (modèle « unseal » à la HashiCorp).

### Pistes de réconciliation
- **E2E par défaut** pour le KV ; les moteurs actifs (dynamique/PKI/transit) tournent dans un
  composant séparé, **auto-hébergeable par le client** (souveraineté CH) — analogue au
  Key Connector côté SSO.
- Auth **machine** distincte de l'auth humaine : jetons à durée de vie courte, AppRole-like,
  OIDC/JWT, intégration CI/CD & Kubernetes.
- **Leasing / révocation / rotation** et **audit log** des accès machine.

### Impact
- Modèle d'identité élargi : *users* **et** *service accounts* (mêmes primitives de clés).
- Décision de périmètre et de modèle de confiance à arrêter (voir questions de cadrage) avant
  de figer l'architecture serveur de la Phase 1.

## 5. Architecture système

```
┌───────────────┐   ┌───────────────┐   ┌──────────────────┐
│  Clients      │   │  Clients      │   │  Extension nav.  │
│  Web (SPA)    │   │  Desktop/Mob. │   │  (autofill)      │
└──────┬────────┘   └──────┬────────┘   └────────┬─────────┘
       │  chiffrent/déchiffrent localement       │
       └──────────────┬──────────────────────────┘
                      │ HTTPS (TLS) — blobs chiffrés + tokens
              ┌───────▼────────┐
              │   API Backend  │  auth, autorisation, stockage,
              │   (stateless)  │  audit log, billing, SSO broker
              └───────┬────────┘
        ┌─────────────┼───────────────┐
   ┌────▼────┐   ┌────▼─────┐   ┌─────▼──────┐
   │Postgres │   │  Redis   │   │  IdP SSO   │
   │(blobs)  │   │(sessions)│   │ (OIDC/SAML)│
   └─────────┘   └──────────┘   └────────────┘
```

---

## 6. Stack technique proposée

| Couche | Choix | Justification |
|---|---|---|
| Crypto | `libsodium-wrappers` + Argon2 (WASM) | Primitives auditées, multiplateforme |
| Backend | TypeScript + **Fastify** (ou Go) | Rapide, typé, écosystème mûr |
| Base de données | **PostgreSQL** | Robuste, transactions, JSON |
| Cache/Sessions | **Redis** | Sessions, rate-limiting |
| SSO | `openid-client` (OIDC), `node-saml` (SAML) | Standards |
| **Cœur crypto** | **Rust** (cœur unique partagé) | Compilable en WASM (web) + FFI (natif) — jamais réécrit |
| Frontend web | **SvelteKit** + Vite | Consomme le cœur Rust via WASM |
| Desktop **natif** Win/Mac | **Pas d'Electron** — voir décision ci-dessous | Exigence : applications natives |
| Mobile (phase ultérieure) | iOS + Android natifs | Cœur Rust partagé via UniFFI |
| Auth interne | Tokens courts + refresh, MFA (TOTP/WebAuthn) | |
| Infra | Docker + IaC (Terraform), région EU/CH | |

> Stack à confirmer avec toi — voir questions en fin de conversation.

---

## 7. Modèle de données (esquisse)

- `users` : id, email, kdf_params, master_password_hash, USK (chiffrée), clé privée (chiffrée),
  clé publique, statut MFA.
- `organizations` : id, nom, plan, billing.
- `org_members` : user_id, org_id, rôle, Org Key chiffrée pour ce membre.
- `collections` : id, org_id, nom.
- `collection_access` : collection_id, member_id, permission.
- `items` (secrets) : id, owner (user ou collection), blob chiffré, item key chiffrée, type,
  métadonnées chiffrées.
- `audit_logs` : qui, quoi, quand (append-only).
- `sso_configs` : org_id, type (OIDC/SAML), endpoints, certs.
- `devices` / `sessions`.

---

## 8. Roadmap par phases

### Phase 0 — Fondations (cœur crypto isolé) ✅ FAIT
- Crate Rust `crates/ghostpass-crypto` : Argon2id, HKDF, XChaCha20-Poly1305, X25519
  (sealed box), hiérarchie de clés (`register`/`unlock`), format `EncString`.
- **Items de coffre** (`vault`) : login/note/carte chiffrés par *item key* ; `rewrap_item_key`.
- **Organisations** (`org`) : distribution de l'Org Key aux membres + `rotate_org_key`
  (rotation/révocation sans re-chiffrer les payloads).
- **19 tests d'intégration verts** (round-trip, détection d'altération, mauvais mot de passe,
  déterminisme KDF, séparation de domaine, partage Org Key, rotation = révocation effective).
  Clippy strict OK, code formaté.
- **Aucune logique réseau.** Primitives RustCrypto uniquement.

### Phase 1 — MVP coffre individuel 🚧 EN COURS
- ✅ **Backend** (`apps/server`, Fastify + TypeScript + SQLite) : `register`/`prelogin`/`login`
  + CRUD d'items chiffrés, sessions par token, hachage serveur scrypt, anti-énumération,
  cloisonnement par utilisateur. **12 tests verts**, 0 vuln, schéma prévoyant les *service
  accounts* (futur Secrets Manager).
- ✅ **Web app** (`apps/web`, SPA Svelte + WASM) : créer un compte, se connecter, ajouter et
  lister des secrets — tout le chiffrement côté client. svelte-check + build OK.
- ✅ **Parcours end-to-end validé** (`apps/server/scripts/e2e.ts`) : crypto WASM + backend +
  déchiffrement, y compris reconnexion sur un « nouvel appareil ».
- ✅ **MFA TOTP** (RFC 6238, `node:crypto`, sans dépendance) : setup/activate/disable + code
  exigé au login si activé. UI de configuration + saisie du code.
- ✅ **Récupération de compte** (kit de récupération zero-knowledge, sans backdoor) : la clé de
  récupération enveloppe l'USK ; preuve serveur par hash dérivé (scrypt) ; reset du mot de passe
  + invalidation des sessions. Crypto Rust (`create_recovery`/`recover`, 21 tests), exposé en
  WASM, backend (**22 tests**), UI (génération du kit + écran « mot de passe oublié »).
  **E2E complet validé** (`scripts/e2e-recovery.ts`).
- ✅ **Durcissement sécurité** (suite à l'audit interne, voir `SECURITY.md`) : anti-downgrade
  KDF, zeroize étendu, rate-limiting + helmet + CORS + bodyLimit, anti-énumération par timing,
  logout/révocation de session, anti-rejeu TOTP, re-auth des opérations 2FA, `recovery-blob`
  uniformisé, normalisation email. **22 tests Rust · 24 tests backend · e2e OK.**
- ⬜ Reste (coffre) : partage / organisations (UI) — le crypto (`org`, `sharing`) existe, reste
  à exposer en WASM + endpoints + UI. ⚠️ Intégrer alors l'authenticité de la distribution
  d'Org Key + la révocation réelle (points reportés de l'audit, voir `SECURITY.md`).
- ⬜ Reste (durcissement) : bascule PostgreSQL pour la prod.

### Phase 2 — Organisations & partage
- Orgs, collections, clés asymétriques, invitations, rôles, révocation + rotation.

### Phase 3 — SSO
- OIDC (auth) avec master password conservé, puis SAML, puis Key Connector / trusted device.

### Phase 4 — Clients
Ordre de priorité (décidé) :
1. **Extension navigateur** (autofill) — cœur Rust via **WASM**, comme la web app. ⭐ priorité 1
   - ✅ **Binding WASM en place** (`crates/ghostpass-crypto-wasm`) : classe `Account`
     (register/unlock/encrypt_item/decrypt_item), clés jamais exposées au JS, types `.d.ts`
     générés, round-trip validé en Node. Prêt à être consommé par l'extension.
2. **Desktop natif Windows + macOS** (pas d'Electron) — cœur Rust via FFI. Approche UI à
   trancher (Tauri webview vs full natif SwiftUI/WinUI) au moment d'attaquer cette étape.
3. **iOS + Android natifs** (plus tard) — même cœur Rust via UniFFI.

### Phase 5 — Durcissement & mise sur le marché
- **Pentest externe**, programme de bug bounty, conformité nLPD/RGPD, SOC 2,
  plan de reprise (récupération de compte, codes de secours), billing.

### Phase 6 — Secrets Manager (volet machine, type HashiCorp Vault)
- KV statique **E2E** pour service accounts (réutilise le cœur crypto).
- Auth machine (jetons courts, AppRole-like, OIDC/JWT, CI/CD, Kubernetes).
- Moteurs **actifs auto-hébergeables** : secrets dynamiques (DB/cloud), PKI, Transit ;
  leasing / révocation / rotation + audit log dédié.
- SDK & CLI pour l'intégration applicative.

---

## 9. Sécurité opérationnelle & conformité (pour vendre)

- **Audit de sécurité tiers obligatoire** avant la première vente.
- Récupération de compte sans casser le zero-knowledge : **kit de récupération**
  (clé de secours générée à l'inscription, stockée par l'utilisateur).
- Rate-limiting, détection d'anomalies, audit log inviolable.
- Politique de divulgation de vulnérabilités (`security.txt`).
- Hébergement région CH/EU ; chiffrement au repos + en transit.
- Sauvegardes chiffrées + tests de restauration.
- Documentation du modèle de menace publiée (argument de vente).

---

## 10. Risques principaux

| Risque | Mitigation |
|---|---|
| Erreur cryptographique | Primitives standard, module isolé, audit externe |
| Récupération de compte (perte master pw) | Kit de récupération, pas de backdoor |
| Tension SSO ↔ zero-knowledge | Patterns Key Connector / trusted device |
| Responsabilité en cas de fuite | Assurance cyber, conformité, transparence |
| Concurrence établie (Bitwarden, 1Password) | Différenciation : Suisse, niche, intégrations |

---

## Décisions arrêtées

- [x] **Backend** : TypeScript + Fastify (un seul langage front/back, itération rapide).
- [x] **Front** : SvelteKit (léger, WebCrypto natif).
- [x] **1er IdP SSO** : Entra ID via **OIDC** (portable ensuite vers Google Workspace / Keycloak).
- [x] **Différenciation** : souveraineté suisse (hébergement CH, nLPD) + simplicité pour les PME.

## Décisions encore ouvertes

- [ ] Stratégie de récupération de compte définitive (kit de récupération vs admin reset).
- [ ] Bibliothèque crypto précise côté navigateur (libsodium WASM vs WebCrypto natif) — voir Phase 0.

## Choix techniques de la Phase 0 (cœur crypto, en Rust)

- **Langage** : **Rust**, compilé en WASM pour le web et exposé en FFI pour les clients natifs.
- **Bibliothèques** : `argon2` (Argon2id), `chacha20poly1305` (AEAD), `x25519-dalek` /
  `crypto_box` (partage), `rand` (CSPRNG), `zeroize` (effacement mémoire des clés).
- **Dérivation de clé** : Argon2id, salt = `BLAKE2b(email normalisé)` (déterministe, pas de
  stockage serveur préalable), paramètres stockés par utilisateur (`kdfParams`) pour pouvoir
  les durcir dans le temps.
- **Séparation de domaine** : depuis la Master Key, `crypto_kdf` dérive deux sous-clés
  distinctes — la clé de chiffrement (protège l'USK) et le hash d'authentification (envoyé au
  serveur). One-way : le serveur ne peut pas remonter à la Master Key.
- **Chiffrement symétrique** : XChaCha20-Poly1305 (AEAD, nonce 24 octets aléatoire).
- **Partage** : `crypto_box_seal` (X25519) — l'Org Key est scellée avec la clé publique du membre.
- **Format de chaîne chiffrée** : `2.<nonce_b64>.<ciphertext_b64>` (le `2` = type XChaCha20-Poly1305).
