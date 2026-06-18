import type { DB } from "./database.js";
import type {
  CollectionAccessRow,
  CollectionPermission,
  CollectionRow,
  MemberStatus,
  OrgItemRow,
  OrgMemberRow,
  OrgRole,
  OrgRow,
  SessionRow,
  UserRow,
  VaultItemRow,
} from "../types.js";

export interface NewUser {
  id: string;
  email: string;
  kdfParams: string;
  serverPasswordHash: string;
  passwordSalt: string;
  encryptedUserKey: string;
  encryptedPrivateKey: string;
  publicKey: string;
}

export const users = {
  create(db: DB, u: NewUser): void {
    db.prepare(
      `INSERT INTO users (id, email, kdf_params, server_password_hash, password_salt,
        encrypted_user_key, encrypted_private_key, public_key, created_at)
       VALUES (@id, @email, @kdfParams, @serverPasswordHash, @passwordSalt,
        @encryptedUserKey, @encryptedPrivateKey, @publicKey, @createdAt)`,
    ).run({ ...u, createdAt: Date.now() });
  },

  findByEmail(db: DB, email: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
      | UserRow
      | undefined;
  },

  findById(db: DB, id: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  },

  setMfaSecret(db: DB, userId: string, secret: string): void {
    // (Re)configure le secret, repasse en non activé et réinitialise l'anti-rejeu.
    db.prepare(
      `UPDATE users SET mfa_secret = ?, mfa_enabled = 0, mfa_last_counter = 0 WHERE id = ?`,
    ).run(secret, userId);
  },

  setMfaEnabled(db: DB, userId: string, enabled: boolean): void {
    db.prepare(`UPDATE users SET mfa_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, userId);
  },

  setMfaLastCounter(db: DB, userId: string, counter: number): void {
    db.prepare(`UPDATE users SET mfa_last_counter = ? WHERE id = ?`).run(counter, userId);
  },

  setRecovery(
    db: DB,
    userId: string,
    r: { encryptedUserKeyRecovery: string; recoveryAuthHash: string; recoverySalt: string },
  ): void {
    db.prepare(
      `UPDATE users SET encrypted_user_key_recovery = ?, recovery_auth_hash = ?, recovery_salt = ?
       WHERE id = ?`,
    ).run(r.encryptedUserKeyRecovery, r.recoveryAuthHash, r.recoverySalt, userId);
  },

  resetPassword(
    db: DB,
    userId: string,
    r: { serverPasswordHash: string; passwordSalt: string; encryptedUserKey: string },
  ): void {
    db.prepare(
      `UPDATE users SET server_password_hash = ?, password_salt = ?, encrypted_user_key = ?
       WHERE id = ?`,
    ).run(r.serverPasswordHash, r.passwordSalt, r.encryptedUserKey, userId);
  },
};

export const sessions = {
  create(db: DB, s: { id: string; userId: string; tokenHash: string; ttlMs: number }): void {
    const now = Date.now();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(s.id, s.userId, s.tokenHash, now, now + s.ttlMs);
  },

  /// Renvoie l'utilisateur associé à un token valide (non expiré), sinon undefined.
  findValidUser(db: DB, tokenHash: string): UserRow | undefined {
    return db
      .prepare(
        `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, Date.now()) as UserRow | undefined;
  },

  deleteByTokenHash(db: DB, tokenHash: string): void {
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
  },

  deleteByUser(db: DB, userId: string): void {
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  },
};

export const vaultItems = {
  listByUser(db: DB, userId: string): VaultItemRow[] {
    return db
      .prepare(
        `SELECT * FROM vault_items WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      )
      .all(userId) as VaultItemRow[];
  },

  listDeleted(db: DB, userId: string): VaultItemRow[] {
    return db
      .prepare(
        `SELECT * FROM vault_items WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      )
      .all(userId) as VaultItemRow[];
  },

  create(
    db: DB,
    item: { id: string; userId: string; encryptedKey: string; encryptedData: string },
  ): VaultItemRow {
    const now = Date.now();
    db.prepare(
      `INSERT INTO vault_items (id, user_id, encrypted_key, encrypted_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(item.id, item.userId, item.encryptedKey, item.encryptedData, now, now);
    return db.prepare(`SELECT * FROM vault_items WHERE id = ?`).get(item.id) as VaultItemRow;
  },

  update(
    db: DB,
    args: { id: string; userId: string; encryptedKey: string; encryptedData: string },
  ): VaultItemRow | undefined {
    const result = db
      .prepare(
        `UPDATE vault_items SET encrypted_key = ?, encrypted_data = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(args.encryptedKey, args.encryptedData, Date.now(), args.id, args.userId);
    if (result.changes === 0) return undefined;
    return db.prepare(`SELECT * FROM vault_items WHERE id = ?`).get(args.id) as VaultItemRow;
  },

  /// Soft-delete : déplace vers la corbeille (n'agit que sur un item actif).
  softDelete(db: DB, args: { id: string; userId: string }): boolean {
    const result = db
      .prepare(
        `UPDATE vault_items SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
      .run(Date.now(), args.id, args.userId);
    return result.changes > 0;
  },

  /// Restaure un item de la corbeille.
  restore(db: DB, args: { id: string; userId: string }): boolean {
    const result = db
      .prepare(
        `UPDATE vault_items SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
      )
      .run(args.id, args.userId);
    return result.changes > 0;
  },

  /// Suppression définitive (purge depuis la corbeille).
  remove(db: DB, args: { id: string; userId: string }): boolean {
    const result = db
      .prepare(`DELETE FROM vault_items WHERE id = ? AND user_id = ?`)
      .run(args.id, args.userId);
    return result.changes > 0;
  },
};

export const organizations = {
  create(db: DB, o: { id: string; name: string }): void {
    db.prepare(`INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`).run(
      o.id,
      o.name,
      Date.now(),
    );
  },
  findById(db: DB, id: string): OrgRow | undefined {
    return db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as OrgRow | undefined;
  },
};

export interface NewMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  status: MemberStatus;
  encryptedOrgKey: string | null;
  sealedByUserId: string | null;
}

export const orgMembers = {
  create(db: DB, m: NewMember): void {
    db.prepare(
      `INSERT INTO org_members
        (id, org_id, user_id, role, status, encrypted_org_key, sealed_by_user_id, created_at)
       VALUES (@id, @orgId, @userId, @role, @status, @encryptedOrgKey, @sealedByUserId, @createdAt)`,
    ).run({ ...m, createdAt: Date.now() });
  },

  findByOrgAndUser(db: DB, orgId: string, userId: string): OrgMemberRow | undefined {
    return db
      .prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`)
      .get(orgId, userId) as OrgMemberRow | undefined;
  },

  listByOrg(db: DB, orgId: string): OrgMemberRow[] {
    return db
      .prepare(`SELECT * FROM org_members WHERE org_id = ? ORDER BY created_at`)
      .all(orgId) as OrgMemberRow[];
  },

  /// Orgs où l'utilisateur est membre (tous statuts), avec le nom de l'organisation.
  listForUser(db: DB, userId: string): Array<OrgMemberRow & { name: string }> {
    return db
      .prepare(
        `SELECT m.*, o.name AS name FROM org_members m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = ? ORDER BY o.name`,
      )
      .all(userId) as Array<OrgMemberRow & { name: string }>;
  },

  setActive(db: DB, id: string): void {
    db.prepare(`UPDATE org_members SET status = 'active' WHERE id = ?`).run(id);
  },

  /// Met à jour l'Org Key scellée d'un membre (lors d'une rotation).
  setKey(
    db: DB,
    args: { orgId: string; userId: string; encryptedOrgKey: string; sealedByUserId: string },
  ): void {
    db.prepare(
      `UPDATE org_members SET encrypted_org_key = ?, sealed_by_user_id = ?
       WHERE org_id = ? AND user_id = ?`,
    ).run(args.encryptedOrgKey, args.sealedByUserId, args.orgId, args.userId);
  },

  remove(db: DB, args: { orgId: string; userId: string }): boolean {
    const result = db
      .prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`)
      .run(args.orgId, args.userId);
    return result.changes > 0;
  },
};

export const collections = {
  create(db: DB, c: { id: string; orgId: string; name: string }): void {
    db.prepare(`INSERT INTO collections (id, org_id, name, created_at) VALUES (?, ?, ?, ?)`).run(
      c.id,
      c.orgId,
      c.name,
      Date.now(),
    );
  },
  listByOrg(db: DB, orgId: string): CollectionRow[] {
    return db
      .prepare(`SELECT * FROM collections WHERE org_id = ? ORDER BY name`)
      .all(orgId) as CollectionRow[];
  },
  findById(db: DB, id: string): CollectionRow | undefined {
    return db.prepare(`SELECT * FROM collections WHERE id = ?`).get(id) as CollectionRow | undefined;
  },
};

export const orgItems = {
  create(
    db: DB,
    item: { id: string; collectionId: string; encryptedKey: string; encryptedData: string },
  ): OrgItemRow {
    const now = Date.now();
    db.prepare(
      `INSERT INTO org_items (id, collection_id, encrypted_key, encrypted_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(item.id, item.collectionId, item.encryptedKey, item.encryptedData, now, now);
    return db.prepare(`SELECT * FROM org_items WHERE id = ?`).get(item.id) as OrgItemRow;
  },
  listByCollection(db: DB, collectionId: string): OrgItemRow[] {
    return db
      .prepare(`SELECT * FROM org_items WHERE collection_id = ? ORDER BY updated_at DESC`)
      .all(collectionId) as OrgItemRow[];
  },

  /// Tous les items partagés d'une org (toutes collections) — utile pour la rotation.
  listByOrg(db: DB, orgId: string): OrgItemRow[] {
    return db
      .prepare(
        `SELECT i.* FROM org_items i
         JOIN collections c ON c.id = i.collection_id
         WHERE c.org_id = ?`,
      )
      .all(orgId) as OrgItemRow[];
  },

  /// Ré-enveloppe l'item key (rotation) ; le contenu chiffré reste inchangé.
  setEncryptedKey(db: DB, args: { id: string; encryptedKey: string }): void {
    db.prepare(`UPDATE org_items SET encrypted_key = ?, updated_at = ? WHERE id = ?`).run(
      args.encryptedKey,
      Date.now(),
      args.id,
    );
  },
  update(
    db: DB,
    args: { id: string; collectionId: string; encryptedKey: string; encryptedData: string },
  ): OrgItemRow | undefined {
    const result = db
      .prepare(
        `UPDATE org_items SET encrypted_key = ?, encrypted_data = ?, updated_at = ?
         WHERE id = ? AND collection_id = ?`,
      )
      .run(args.encryptedKey, args.encryptedData, Date.now(), args.id, args.collectionId);
    if (result.changes === 0) return undefined;
    return db.prepare(`SELECT * FROM org_items WHERE id = ?`).get(args.id) as OrgItemRow;
  },
  remove(db: DB, args: { id: string; collectionId: string }): boolean {
    const result = db
      .prepare(`DELETE FROM org_items WHERE id = ? AND collection_id = ?`)
      .run(args.id, args.collectionId);
    return result.changes > 0;
  },
};

export const collectionAccess = {
  /// Accorde (ou met à jour) la permission d'un utilisateur sur une collection.
  grant(
    db: DB,
    a: { id: string; collectionId: string; userId: string; permission: CollectionPermission },
  ): void {
    db.prepare(
      `INSERT INTO collection_access (id, collection_id, user_id, permission, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (collection_id, user_id) DO UPDATE SET permission = excluded.permission`,
    ).run(a.id, a.collectionId, a.userId, a.permission, Date.now());
  },

  findFor(db: DB, collectionId: string, userId: string): CollectionAccessRow | undefined {
    return db
      .prepare(`SELECT * FROM collection_access WHERE collection_id = ? AND user_id = ?`)
      .get(collectionId, userId) as CollectionAccessRow | undefined;
  },

  /// Collections d'une org auxquelles l'utilisateur a un accès explicite.
  listCollectionsForUser(db: DB, orgId: string, userId: string): CollectionRow[] {
    return db
      .prepare(
        `SELECT c.* FROM collections c
         JOIN collection_access a ON a.collection_id = c.id
         WHERE c.org_id = ? AND a.user_id = ? ORDER BY c.name`,
      )
      .all(orgId, userId) as CollectionRow[];
  },
};
