import BetterSqlite3 from "better-sqlite3";

export type DB = BetterSqlite3.Database;

/// Schéma. Volontairement portable (ids TEXT/UUID, timestamps INTEGER epoch-ms) pour
/// faciliter la bascule future vers PostgreSQL. Le serveur ne stocke QUE des blobs chiffrés
/// (`encrypted_*`, format `EncString`) ou publics (clés publiques, hash d'auth re-hashé).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  kdf_params             TEXT NOT NULL,   -- JSON KdfParams (public)
  server_password_hash   TEXT NOT NULL,   -- scrypt(hash d'auth client) en hex
  password_salt          TEXT NOT NULL,   -- salt scrypt en hex
  encrypted_user_key     TEXT NOT NULL,   -- EncString (USK chiffrée)
  encrypted_private_key  TEXT NOT NULL,   -- EncString (clé privée de partage chiffrée)
  public_key             TEXT NOT NULL,   -- base64 (clé publique de partage)
  mfa_secret             TEXT,            -- secret TOTP base32 (NULL si pas configuré)
  mfa_enabled            INTEGER NOT NULL DEFAULT 0,
  mfa_last_counter       INTEGER NOT NULL DEFAULT 0,  -- dernier compteur TOTP consommé (anti-rejeu)
  encrypted_user_key_recovery TEXT,       -- EncString (USK enveloppée par la clé de récupération)
  recovery_auth_hash     TEXT,            -- scrypt(preuve de récupération) en hex
  recovery_salt          TEXT,            -- salt scrypt de la preuve, en hex
  created_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_items (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key   TEXT NOT NULL,   -- EncString (item key enveloppée)
  encrypted_data  TEXT NOT NULL,   -- EncString (contenu de l'item)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,  -- sha256(token) en hex
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Prévu pour le futur Secrets Manager (volet machine) : identités non-humaines.
CREATE TABLE IF NOT EXISTS service_accounts (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT,
  name             TEXT NOT NULL,
  public_key       TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

-- Organisations (partage en équipe).
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               TEXT NOT NULL,   -- 'admin' | 'member' | 'readonly'
  status             TEXT NOT NULL,   -- 'invited' | 'active'
  encrypted_org_key  TEXT,            -- Org Key scellée pour ce membre (base64), authentifiée
  sealed_by_user_id  TEXT,            -- admin émetteur (sa clé publique sert à vérifier l'origine)
  created_at         INTEGER NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_items_user ON vault_items(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
`;

/// Ouvre la base et applique le schéma. `path` vaut ":memory:" pour les tests.
export function openDatabase(path: string): DB {
  const db = new BetterSqlite3(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
