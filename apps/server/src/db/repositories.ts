import type { DB } from "./database.js";
import type { SessionRow, UserRow, VaultItemRow } from "../types.js";

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
      .prepare(`SELECT * FROM vault_items WHERE user_id = ? ORDER BY updated_at DESC`)
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

  remove(db: DB, args: { id: string; userId: string }): boolean {
    const result = db
      .prepare(`DELETE FROM vault_items WHERE id = ? AND user_id = ?`)
      .run(args.id, args.userId);
    return result.changes > 0;
  },
};
