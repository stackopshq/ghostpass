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
- ✅ Coffre : entrées login, **arborescence de dossiers**, favicons auto-hébergés, **édition/suppression**, thème clair/sombre, kit de récupération, MFA TOTP du compte

**Manques structurants** : surtout l'**usage quotidien** (clients), pas l'architecture.

---

## 3. Backlog priorisé

### Phase 1 — Quick wins coffre (S, 100 % client, fort ROI)
- ⬜ **Générateur** de mots de passe / phrases de passe — **S**
- ⬜ **Password Health** : faibles, réutilisés, 2FA manquante (façon Watchtower, calcul local) — **S**
- ⬜ **UI notes sécurisées & cartes** (le cœur Rust les gère déjà) — **S**
- ⬜ **Historique des mots de passe** par item — **S/M**
- ⬜ **Import / export** (CSV + formats 1P / Bitwarden / Proton) — **S/M**
- ⬜ **Corbeille** / éléments récemment supprimés — **S**

### Phase 2 — Usage quotidien : clients (L, vrai bloqueur d'adoption)
- ⬜ **Extension navigateur** (autofill, capture) — *priorité produit n°1*, cœur WASM prêt — **L**
- ⬜ **Desktop natif** (Tauri + cœur Rust) puis **mobiles** (UniFFI) — **L**

### Phase 3 — Authentification & sécurité du compte (M/L)
- ⬜ **Passkeys / WebAuthn** : login au coffre **et** stockage/usage de passkeys pour les sites — **L**
- ⬜ **MFA FIDO2 / YubiKey** (en plus du TOTP) — **M**
- ⬜ **Accès d'urgence** (emergency access) — **M**
- ⬜ **Partage de lien éphémère** d'un item (façon Send / Proton link) — **M**
- ⬜ **Détection d'anomalies** de connexion (façon Sentinel) — **M** (on a déjà rate-limit / anti-enumeration)
- ⬜ **Dark web monitoring** (breach via HIBP k-anonymity, requête côté client) — **M**

### Phase 4 — Différenciateurs souveraineté CH (L, à arbitrer)
- ⬜ **Alias hide-my-email** auto-hébergés (forwarding souverain) — meilleur angle anti-Proton, infra email — **L**
- ⬜ **Pièces jointes chiffrées** — **M**
- ⬜ **Travel Mode** (masquer des coffres) — **S/M**

### Phase 5 — Entreprise (L)
- ⬜ **SSO OIDC** (master password conservé, puis Key Connector) — **L**
- ⬜ **SCIM / directory sync**, **console admin**, **groupes** — **L**
- ⬜ **Journaux d'audit** inviolables, **policies**, rapports — **M/L**

### Phase 6 — Secrets Manager (machines) (L)
- ⬜ **KV E2E** pour **service accounts** + **CLI** + SDK (réutilise le cœur crypto) — **L**
- ⬜ **Agent SSH**, signature Git, intégrations CI/CD / Kubernetes / Terraform — **L**
- ⬜ Moteurs actifs **auto-hébergeables** : secrets dynamiques, PKI, Transit (non-ZK) — **L**

### Transverse — Mise sur le marché
- ⬜ **PostgreSQL** prod (schéma déjà portable) — **M**
- ⬜ **Audit externe** + bug bounty, **SOC 2 / ISO 27001**, conformité **nLPD/RGPD**, `security.txt` — **L**

---

## 4. Séquencement recommandé
1. **Phase 1** — rend la démo crédible rapidement (générateur + Password Health en tête).
2. **Phase 2 — extension navigateur** — débloque l'usage réel quotidien.
3. **Phase 3 — passkeys + santé/monitoring** — table-stakes 2026.
4. Puis **entreprise** et/ou **Secrets Manager** selon la cible commerciale.

---

## Sources (2026-06-18)
- Proton Pass — pricing : https://proton.me/pass/pricing
- Proton Pass — Pass Monitor : https://proton.me/pass/pass-monitor
- 1Password — review : https://cyberinsider.com/password-manager/reviews/1password/
- 1Password — Watchtower : https://securetoolsguide.com/1password-watchtower-feature-review/
- Bitwarden — review : https://work-management.org/network-security/bitwarden-review/
- Bitwarden — Secrets Manager self-host : https://www.businesswire.com/news/home/20231116701838/en/Bitwarden-Introduces-Enterprise-Self-Hosting-for-Secrets-Manager
