import BetterSqlite3 from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect, sql } from "kysely";
import pg from "pg";
import type {
  AuditLogRow,
  CollectionAccessRow,
  CollectionRow,
  EmergencyAccessRow,
  GroupCollectionAccessRow,
  LoginEventRow,
  MfaRecoveryCodeRow,
  OrgGroupMemberRow,
  OrgGroupRow,
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
  org_groups: OrgGroupRow;
  org_group_members: OrgGroupMemberRow;
  group_collection_access: GroupCollectionAccessRow;
  // Store éphémère partagé (challenges WebAuthn, état SSO/PKCE) : en base plutôt qu'en mémoire,
  // pour que login/callback fonctionnent sur n'importe quelle instance (déploiement multi-instance).
  auth_ephemeral: { key: string; value: string; expires_at: number };
  audit_log: AuditLogRow;
  mfa_recovery_codes: MfaRecoveryCodeRow;
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
  -- Essais ratés consécutifs sur le second facteur, et échéance du blocage.
  -- Par COMPTE et en base : la limitation de @fastify/rate-limit compte par
  -- adresse IP, qu'un attaquant fait tourner, et six chiffres se devinent vite
  -- quand on peut essayer sans compter.
  mfa_failed_attempts    INTEGER NOT NULL DEFAULT 0,
  mfa_locked_until       INTEGER,
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
  is_default  INTEGER NOT NULL DEFAULT 0,
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

-- Codes de récupération du second facteur. Sans eux, un téléphone perdu est un
-- compte perdu : la récupération de coffre (encrypted_user_key_recovery) rend le
-- MOT DE PASSE, pas la porte. mfa_enabled reste à 1 après un /api/auth/recover,
-- et la connexion redemande ensuite un code que plus personne ne peut produire.
--
-- Seule l'empreinte est stockée, comme pour les jetons de session : une base lue
-- ne rend aucun code utilisable.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON mfa_recovery_codes(user_id);

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

-- Groupes d'organisation (couche de contrôle d'accès, pas de crypto) : regroupent des membres et
-- reçoivent des permissions sur des collections. La permission effective d'un membre = max de son
-- accès direct et des accès de ses groupes. La décryption reste via l'Org Key (tous les membres).
CREATE TABLE IF NOT EXISTS org_groups (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS org_group_members (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES org_groups(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  UNIQUE (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_collection_access (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES org_groups(id) ON DELETE CASCADE,
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  permission     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (group_id, collection_id)
);
CREATE INDEX IF NOT EXISTS idx_org_groups_org ON org_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_org_group_members_group ON org_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_org_group_members_user ON org_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_collection_access_group ON group_collection_access(group_id);
CREATE INDEX IF NOT EXISTS idx_group_collection_access_collection ON group_collection_access(collection_id);
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
    await migratePostgres(db);
    return db;
  }
  return openDatabase(process.env.DB_PATH ?? "ghostpass.db");
}

/// Migrations idempotentes PostgreSQL. `CREATE TABLE IF NOT EXISTS` ne touche pas une table
/// déjà présente : sur une base de production, une colonne ajoutée au schéma ci-dessus
/// n'apparaîtrait jamais sans cet `ALTER`. `IF NOT EXISTS` le rend rejouable.
async function migratePostgres(db: DB): Promise<void> {
  await sql
    .raw("ALTER TABLE collections ADD COLUMN IF NOT EXISTS is_default BIGINT NOT NULL DEFAULT 0")
    .execute(db);
  await sql
    .raw("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_failed_attempts BIGINT NOT NULL DEFAULT 0")
    .execute(db);
  await sql.raw("ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_locked_until BIGINT").execute(db);
}

/// Migrations idempotentes SQLite (bases créées avant l'ajout d'une colonne).
function migrateSqlite(handle: BetterSqlite3.Database): void {
  ensureColumn(handle, "vault_items", "deleted_at", "INTEGER");
  ensureColumn(handle, "collections", "is_default", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(handle, "users", "mfa_failed_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(handle, "users", "mfa_locked_until", "INTEGER");
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
