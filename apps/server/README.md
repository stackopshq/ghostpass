# @ghostpass/server

Backend Phase 1 — **Fastify + TypeScript**. Le serveur ne stocke que des **blobs chiffrés**
qu'il ne peut pas lire (zero-knowledge) ; il gère l'authentification, les sessions et la
synchronisation des items.

## Stockage
- **SQLite** (`better-sqlite3`) en développement — zéro serveur à lancer.
- Schéma volontairement **portable PostgreSQL** (ids UUID, timestamps epoch-ms) ; la bascule
  prod ne touchera que la couche `db/`.
- Aucune dépendance crypto native : hachage serveur (`scrypt`) et tokens via `node:crypto`.

## Endpoints

| Méthode | Route | Auth | Rôle |
|---|---|---|---|
| GET | `/health` | — | sonde |
| POST | `/api/auth/register` | — | crée le compte (stocke les blobs), ouvre une session |
| POST | `/api/auth/prelogin` | — | renvoie les `kdfParams` (anti-énumération si email inconnu) |
| POST | `/api/auth/login` | — | vérifie le hash, renvoie token + blobs pour déverrouiller |
| GET | `/api/vault/items` | 🔒 | liste les items chiffrés de l'utilisateur |
| POST | `/api/vault/items` | 🔒 | crée un item chiffré |
| PUT | `/api/vault/items/:id` | 🔒 | met à jour un item |
| DELETE | `/api/vault/items/:id` | 🔒 | supprime un item |

Auth : `Authorization: Bearer <token>` (sessions à 7 jours, empreinte SHA-256 stockée).

## Sécurité (Phase 1)
- Le mot de passe maître **n'arrive jamais** au serveur ; seul le *hash d'auth* dérivé côté
  client est reçu, puis **re-haché en scrypt + salt** avant stockage.
- Réponses de login **génériques** (ne révèlent pas l'existence d'un email).
- Items **cloisonnés par utilisateur** (vérifié par test).

## Scripts
```bash
npm run dev         # serveur en watch (tsx)
npm test            # tests de bout en bout (node:test) — 12 tests
npm run typecheck   # tsc --noEmit
```
