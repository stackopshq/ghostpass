# GhostPass — Roadmap produit & analyse concurrentielle

> Backlog priorisé issu d'une comparaison des gestionnaires de référence.
> Complète la roadmap d'architecture (`../ARCHITECTURE.md` §8), qui reste la source des phases techniques.
> Snapshot concurrentiel : **2026-06-18** (vérifié via sources officielles + revues, voir fin de doc).

**Légende statut** : ✅ présent · 🟡 partiel · ⬜ absent
**Effort** : **S** petit (surtout client) · **M** moyen (backend léger) · **L** gros / infra
Sauf mention, tout est conçu pour rester **zero-knowledge**.

---

## 1. Différenciateurs des concurrents

### Proton Pass (concurrent le plus proche : suisse, E2E, privacy)
- Gratuit généreux : logins/notes/cartes illimités, apps navigateur+mobile+desktop, **générateur**,
  **10 alias hide-my-email**, **Password Health** (faibles/réutilisés + 2FA inactive),
  **passkeys illimités gratuits** (depuis fév. 2026), import, E2E.
- Plus : **alias illimités + domaines perso** (signature, via SimpleLogin), **authenticator TOTP**,
  **partage de coffre + partage de lien d'un item**, **dark web monitoring**, **pièces jointes (100 Mo)**,
  **Proton Sentinel** (anti-ATO), **accès d'urgence**, **CLI**.
- Business : Essentials 1,99 $/user/mois ; Professional 4,85 $ ajoute **SSO + SCIM**.
- 2025-26 : import wallets Web3, Sentinel. Vérification des mdp **locale**.

### 1Password
- **Watchtower** (mdp compromis/faibles/réutilisés, 2FA manquante, mdp expirés, dispo de passkeys).
- **Passkeys** parité complète. **Travel Mode** (efface des coffres avant une frontière).
- **Developer/Secrets** : CLI `op`, service accounts, **SSH agent** + signature Git, `op run`,
  GitHub Actions, Kubernetes Operator, SDKs CI/CD.

### Bitwarden
- **Open-source + auto-hébergeable** intégralement.
- **Send** (envoi chiffré éphémère texte/fichier). Entreprise : RBAC, **event logs**, policies,
  **directory sync, SCIM, SSO**, account recovery. **Secrets Manager** auto-hébergeable. Passkeys.

### Autres
- **Dashlane** : VPN intégré, dark web monitoring. **Keeper** : KeeperPAM (accès privilégié).
- **KeePassXC** : local, gratuit, extensible, sans cloud.

---

## 2. Où en est GhostPass
**Socle fort déjà en place** (le plus dur) :
- ✅ Zero-knowledge / E2E, cœur crypto Rust auditable isolé
- ✅ Authenticator **TOTP avec timer** (Proton le réserve au payant)
- ✅ Organisations / collections / rôles, **révocation par rotation de clé** (plus avancé que le « vault sharing » Proton)
- ✅ Coffre : login/**notes**/**cartes**, **arborescence de dossiers**, favicons auto-hébergés, **édition/suppression**, **corbeille**, **historique des mots de passe**, thème clair/sombre, kit de récupération, MFA TOTP du compte
- ✅ Outils : **générateur**, **Password Health**, **import/export CSV**, **dark-web monitoring** (HIBP), **partage de lien éphémère**
- ✅ **Audit de sécurité interne** (2026-06-19, voir `../SECURITY.md`) : aucun finding critique, correctifs Élevés/Moyens appliqués

**Manques structurants** : surtout l'**usage quotidien hors web** (extension, apps natives) et l'**entreprise/SSO** — pas l'architecture.

---

## 3. Backlog priorisé

### Phase 1 — Quick wins coffre (S, 100 % client, fort ROI) — ✅ TERMINÉE
- ✅ **Générateur** de mots de passe (longueur/jeux, aléa CSPRNG)
- ✅ **Password Health** : faibles, réutilisés, 2FA manquante (calcul local)
- ✅ **UI notes sécurisées & cartes** (sélecteur de type, détail adapté)
- ✅ **Historique des mots de passe** par item (chiffré, max 20)
- ✅ **Import / export** (CSV + formats 1P / Bitwarden / Proton)
- ✅ **Corbeille** : soft-delete / restauration / purge

### Phase 2 — Usage quotidien : clients (L, vrai bloqueur d'adoption)
- ✅ **Extension navigateur** (dépôt `ghostpass-extension`, MV3) — *priorité produit n°1* — **livrée** (2026-07) :
  - MVP durci : CSP `wasm-unsafe-eval` (cœur WASM), backend configurable (page d'options), presse-papier auto-effacé.
  - **Session dans le service worker** + **verrouillage automatique** (délai réglable) — plus de re-login à chaque ouverture, rien de sensible sur disque.
  - **Autofill à la demande** (`activeTab` + `scripting`, geste utilisateur) : détection multi-formulaires, matching par domaine, flux « identifiant d'abord ».
  - **Cross-browser** (un seul code, `browser.* ?? chrome.*`) : **Chrome/Edge/Brave** (testé E2E : unlock, session, autofill), **Firefox** (`build:firefox`, chargé sur ESR 140 ; runtime à confirmer sur desktop), **Safari** (`build:safari`, converti + compilé en **CI macOS**).
  - *Reste : publication sur les stores + login passkey dans le popup (voir Phase 3).*
- ⬜ **Desktop natif** (Tauri + cœur Rust) puis **mobiles** (UniFFI) — **L**

### Phase 3 — Authentification & sécurité du compte (M/L)
- ✅ **Partage de lien éphémère** (Send : AES-GCM client, clé dans le fragment, expiry + one-time)
- ✅ **Dark web monitoring** (HIBP k-anonymity, requête côté client)
- ✅ **MFA FIDO2 / YubiKey** (WebAuthn, 2e facteur au login ; fondation passkeys)
- ✅ **Détection d'anomalies (base)** : historique des connexions (appareil/IP/date) + drapeau nouvel appareil ; scoring « Sentinel-like » avancé optionnel plus tard
- ✅ **Accès d'urgence** (USK scellée pour un contact, délai géré serveur, lecture + takeover)
- ✅ **Passkeys passwordless** : login & enrôlement via **PRF WebAuthn** (USK enveloppée par le secret PRF, ZK). **Web app fonctionnelle**. **Backend Related Origin Requests** ajouté (`/.well-known/webauthn` + `WEBAUTHN_EXTRA_ORIGINS`, `expectedOrigin` multi-origines) pour autoriser des origines non same-site — prérequis des passkeys **dans l'extension**. *Flux passkey côté extension différé* : Chrome-only (nécessite un `chrome-extension://<id>` **publié et stable** dans `WEBAUTHN_EXTRA_ORIGINS`) ; Firefox/Safari ont des origines non stables.

### Phase 4 — Différenciateurs souveraineté CH (L, à arbitrer)
- ⬜ **Alias hide-my-email** auto-hébergés (forwarding souverain) — meilleur angle anti-Proton, infra email — **L**
- ⬜ **Pièces jointes chiffrées** — **M**
- ⬜ **Travel Mode** (masquer des coffres) — **S/M**

### Phase 5 — Entreprise (L)
- 🟡 **SSO OIDC** — **login fédéré livré** (2026-07) : backend Authorization Code + PKCE, vérification ID token via `jose` (signature JWKS + issuer + audience + nonce), reliage à un compte existant par email vérifié ; UI web (bouton SSO → IdP → mot de passe maître → déverrouillage). **Master password conservé, ZK intact.** Reste : **Key Connector** (passwordless entreprise) + **store SSO partagé** (état PKCE en mémoire → DB/Redis pour le multi-instance).
- ⬜ **SCIM / directory sync**, **console admin**, **groupes** — **L**
- ⬜ **Journaux d'audit** inviolables, **policies**, rapports — **M/L**

### Phase 6 — Secrets Manager (machines) (L)
- ⬜ **KV E2E** pour **service accounts** + **CLI** + SDK (réutilise le cœur crypto) — **L**
- ⬜ **Agent SSH**, signature Git, intégrations CI/CD / Kubernetes / Terraform — **L**
- ⬜ Moteurs actifs **auto-hébergeables** : secrets dynamiques, PKI, Transit (non-ZK) — **L**

### Transverse — Mise sur le marché
- ✅ **PostgreSQL** prod — **fait** : couche DB portée sur **Kysely** (async), un seul code pour **SQLite** (dev/tests) et **PostgreSQL** (prod via `DATABASE_URL`) ; `docker-compose` Postgres, `pg-smoke` de bout en bout. Débloque le déploiement multi-instance.
- 🟡 **Audit interne fait** (2026-06-19) ; reste : **audit externe / pentest** + bug bounty, **SOC 2 / ISO 27001**, conformité **nLPD/RGPD**, `security.txt` — **L**

---

## 4. Séquencement recommandé
1. ✅ **Phase 1** — démo crédible (générateur + Password Health).
2. ✅ **Phase 2 — extension navigateur** — livrée (Chrome/Firefox/Safari) ; reste **publication stores** + desktop/mobile natifs.
3. 🟡 **Phase 3 — passkeys + santé/monitoring** — l'essentiel est là ; reste le **login passkey dans le popup** (une fois l'extension publiée) et le scoring d'anomalies avancé.
4. ✅ **PostgreSQL prod** — fait (bascule Kysely SQLite/Postgres). Prochaines cibles : **entreprise** (SSO OIDC, SCIM, console admin) et/ou **Secrets Manager** selon la cible commerciale.

---

## Sources (2026-06-18)
- Proton Pass — pricing : https://proton.me/pass/pricing
- Proton Pass — Pass Monitor : https://proton.me/pass/pass-monitor
- 1Password — review : https://cyberinsider.com/password-manager/reviews/1password/
- 1Password — Watchtower : https://securetoolsguide.com/1password-watchtower-feature-review/
- Bitwarden — review : https://work-management.org/network-security/bitwarden-review/
- Bitwarden — Secrets Manager self-host : https://www.businesswire.com/news/home/20231116701838/en/Bitwarden-Introduces-Enterprise-Self-Hosting-for-Secrets-Manager
