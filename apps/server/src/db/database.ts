import BetterSqlite3 from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect, sql } from "kysely";
import pg from "pg";
import type {
  AuditLogRow,
  CollectionAccessRow,
  CollectionRow,
  EmergencyAccessRow,
  LoginEventRow,
  OrgItemRow,
  OrgMemberRow,
  OrgRow,
  PasskeyRow,
  SendRow,
  SessionRow,
  UserRow,
  VaultItemRow,
  WebAuthnCredentialRow,
} from "../types.js";

/// Schéma des tables pour Kysely (nom de table → forme de la ligne). Les colonnes `encrypted_*`
/// sont des blobs illisibles par le serveur. `service_accounts` (futur Secrets Manager) n'est
/// requêté par aucun repo → absent ici, mais présent dans le schéma SQL.
export interface Database {
  users: UserRow;
  vault_items: VaultItemRow;
  sessions: SessionRow;
  emergency_access: EmergencyAccessRow;
  login_events: LoginEventRow;
  passkeys: PasskeyRow;
  webauthn_credentials: WebAuthnCredentialRow;
  sends: SendRow;
  organizations: OrgRow;
  org_members: OrgMemberRow;
  collections: CollectionRow;
  org_items: OrgItemRow;
  collection_access: CollectionAccessRow;
  // Store éphémère partagé (challenges WebAuthn, état SSO/PKCE) : en base plutôt qu'en mémoire,
  // pour que login/callback fonctionnent sur n'importe quelle instance (déploiement multi-instance).
  auth_ephemeral: { key: string; value: string; expires_at: number };
  audit_log: AuditLogRow;
}

export type DB = Kysely<Database>;

/// Schéma. Volontairement portable (ids TEXT/UUID, timestamps epoch-ms) pour SQLite (dev/tests)
/// et PostgreSQL (prod). Le serveur ne stocke QUE des blobs chiffrés (`encrypted_*`, `EncString`)
/// ou publics (clés publiques, hash d'auth re-hashé). Les booléens sont stockés en 0/1 (INTEGER
/// SQLite / BIGINT Postgres) pour un typage uniforme côté application (`number`).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  kdf_params             TEXT NOT NULL,
  server_password_hash   TEXT NOT NULL,
  password_salt          TEXT NOT NULL,
  encrypted_user_key     TEXT NOT NULL,
  encrypted_private_key  TEXT NOT NULL,
  public_key             TEXT NOT NULL,
  mfa_secret             TEXT,
  mfa_enabled            INTEGER NOT NULL DEFAULT 0,
  mfa_last_counter       INTEGER NOT NULL DEFAULT 0,
  encrypted_user_key_recovery TEXT,
  recovery_auth_hash     TEXT,
  recovery_salt          TEXT,
  created_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_items (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key   TEXT NOT NULL,
  encrypted_data  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER
);

CREATE TABLE IF NOT EXISTS sends (
  id          TEXT PRIMARY KEY,
  ciphertext  TEXT NOT NULL,
  iv          TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  max_views   INTEGER NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passkeys (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key           TEXT NOT NULL,
  counter              INTEGER NOT NULL,
  transports           TEXT,
  name                 TEXT NOT NULL,
  prf_wrapped_user_key TEXT NOT NULL,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,
  counter     INTEGER NOT NULL,
  transports  TEXT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS emergency_access (
  id               TEXT PRIMARY KEY,
  grantor_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  wait_days        INTEGER NOT NULL,
  status           TEXT NOT NULL,
  sealed_user_key  TEXT NOT NULL,
  requested_at     INTEGER,
  created_at       INTEGER NOT NULL,
  UNIQUE (grantor_id, grantee_id)
);

CREATE TABLE IF NOT EXISTS login_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          TEXT NOT NULL,
  user_agent  TEXT NOT NULL,
  new_device  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_accounts (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT,
  name             TEXT NOT NULL,
  public_key       TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               TEXT NOT NULL,
  status             TEXT NOT NULL,
  encrypted_org_key  TEXT,
  sealed_by_user_id  TEXT,
  created_at         INTEGER NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_items (
  id              TEXT PRIMARY KEY,
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  encrypted_key   TEXT NOT NULL,
  encrypted_data  TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_access (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_items_user ON vault_items(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_grantor ON emergency_access(grantor_id);
CREATE INDEX IF NOT EXISTS idx_emergency_grantee ON emergency_access(grantee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_collections_org ON collections(org_id);
CREATE INDEX IF NOT EXISTS idx_org_items_collection ON org_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_access_user ON collection_access(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_access_collection ON collection_access(collection_id);

-- Store éphémère partagé (challenges WebAuthn à usage unique, état SSO/PKCE). En base pour
-- fonctionner en multi-instance ; l'expiration est vérifiée à la lecture et purgeable par balayage.
CREATE TABLE IF NOT EXISTS auth_ephemeral (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_ephemeral_expires ON auth_ephemeral(expires_at);

-- Journal d'audit sécurité (append-only) : login/SSO/passkey, changements d'identifiants, org…
-- Métadonnées seulement (jamais de secret). Le chaînage par hash (« inviolable ») viendra ensuite.
CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  ip           TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`;

/// Schéma Postgres : identique, `INTEGER` (32 bits) → `BIGINT` (les timestamps epoch-ms
/// dépassent 2^31). Les booléens 0/1 restent numériques.
const POSTGRES_SCHEMA = SCHEMA.replace(/\bINTEGER\b/g, "BIGINT");

/// Ouvre une base **SQLite** (dev/tests). `path` vaut ":memory:" pour les tests. Synchrone :
/// le schéma est appliqué sur le handle better-sqlite3 avant de l'envelopper dans Kysely.
export function openDatabase(path: string): DB {
  const handle = new BetterSqlite3(path);
  if (path !== ":memory:") handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  handle.exec(SCHEMA);
  migrateSqlite(handle);
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: handle }) });
}

/// Sélectionne la base selon la config : PostgreSQL si `DATABASE_URL` est défini (prod),
/// sinon SQLite sur `DB_PATH` (dev). Asynchrone car la création du schéma Postgres l'est.
export async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // BIGINT (int8, oid 20) → number JS (epoch-ms < 2^53, sûr) pour un typage uniforme.
    pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
    const db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) }),
    });
    await sql.raw(POSTGRES_SCHEMA).execute(db);
    return db;
  }
  return openDatabase(process.env.DB_PATH ?? "ghostpass.db");
}

/// Migrations idempotentes SQLite (bases créées avant l'ajout d'une colonne).
function migrateSqlite(handle: BetterSqlite3.Database): void {
  ensureColumn(handle, "vault_items", "deleted_at", "INTEGER");
}

function ensureColumn(
  handle: BetterSqlite3.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
