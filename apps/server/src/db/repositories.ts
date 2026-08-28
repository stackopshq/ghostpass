import type { DB } from "./database.js";
import type {
  AuditLogRow,
  CollectionAccessRow,
  CollectionPermission,
  CollectionRow,
  EmergencyAccessRow,
  EmergencyRole,
  EmergencyStatus,
  GroupCollectionAccessRow,
  LoginEventRow,
  MemberStatus,
  OrgGroupMemberRow,
  OrgGroupRow,
  OrgItemRow,
  OrgMemberRow,
  OrgRole,
  OrgRow,
  PasskeyRow,
  SendRow,
  UserRow,
  VaultItemRow,
  WebAuthnCredentialRow,
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
  async create(db: DB, u: NewUser): Promise<void> {
    await db
      .insertInto("users")
      .values({
        id: u.id,
        email: u.email,
        kdf_params: u.kdfParams,
        server_password_hash: u.serverPasswordHash,
        password_salt: u.passwordSalt,
        encrypted_user_key: u.encryptedUserKey,
        encrypted_private_key: u.encryptedPrivateKey,
        public_key: u.publicKey,
        mfa_secret: null,
        mfa_enabled: 0,
        mfa_last_counter: 0,
        encrypted_user_key_recovery: null,
        recovery_auth_hash: null,
        recovery_salt: null,
        created_at: Date.now(),
      })
      .execute();
  },

  findByEmail(db: DB, email: string): Promise<UserRow | undefined> {
    return db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
  },

  findById(db: DB, id: string): Promise<UserRow | undefined> {
    return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  },

  async setMfaSecret(db: DB, userId: string, secret: string): Promise<void> {
    // (Re)configure le secret, repasse en non activé et réinitialise l'anti-rejeu.
    await db
      .updateTable("users")
      .set({ mfa_secret: secret, mfa_enabled: 0, mfa_last_counter: 0 })
      .where("id", "=", userId)
      .execute();
  },

  async setMfaEnabled(db: DB, userId: string, enabled: boolean): Promise<void> {
    await db
      .updateTable("users")
      .set({ mfa_enabled: enabled ? 1 : 0 })
      .where("id", "=", userId)
      .execute();
  },

  async setMfaLastCounter(db: DB, userId: string, counter: number): Promise<void> {
    await db
      .updateTable("users")
      .set({ mfa_last_counter: counter })
      .where("id", "=", userId)
      .execute();
  },

  async setRecovery(
    db: DB,
    userId: string,
    r: { encryptedUserKeyRecovery: string; recoveryAuthHash: string; recoverySalt: string },
  ): Promise<void> {
    await db
      .updateTable("users")
      .set({
        encrypted_user_key_recovery: r.encryptedUserKeyRecovery,
        recovery_auth_hash: r.recoveryAuthHash,
        recovery_salt: r.recoverySalt,
      })
      .where("id", "=", userId)
      .execute();
  },

  async resetPassword(
    db: DB,
    userId: string,
    r: { serverPasswordHash: string; passwordSalt: string; encryptedUserKey: string },
  ): Promise<void> {
    await db
      .updateTable("users")
      .set({
        server_password_hash: r.serverPasswordHash,
        password_salt: r.passwordSalt,
        encrypted_user_key: r.encryptedUserKey,
      })
      .where("id", "=", userId)
      .execute();
  },
};

export const sessions = {
  async create(
    db: DB,
    s: { id: string; userId: string; tokenHash: string; ttlMs: number },
  ): Promise<void> {
    const now = Date.now();
    await db
      .insertInto("sessions")
      .values({
        id: s.id,
        user_id: s.userId,
        token_hash: s.tokenHash,
        created_at: now,
        expires_at: now + s.ttlMs,
      })
      .execute();
  },

  /// Renvoie l'utilisateur associé à un token valide (non expiré), sinon undefined.
  findValidUser(db: DB, tokenHash: string): Promise<UserRow | undefined> {
    return db
      .selectFrom("sessions as s")
      .innerJoin("users as u", "u.id", "s.user_id")
      .where("s.token_hash", "=", tokenHash)
      .where("s.expires_at", ">", Date.now())
      .selectAll("u")
      .executeTakeFirst();
  },

  async deleteByTokenHash(db: DB, tokenHash: string): Promise<void> {
    await db.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
  },

  async deleteByUser(db: DB, userId: string): Promise<void> {
    await db.deleteFrom("sessions").where("user_id", "=", userId).execute();
  },
};

export const vaultItems = {
  listByUser(db: DB, userId: string): Promise<VaultItemRow[]> {
    return db
      .selectFrom("vault_items")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .orderBy("updated_at", "desc")
      .execute();
  },

  listDeleted(db: DB, userId: string): Promise<VaultItemRow[]> {
    return db
      .selectFrom("vault_items")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is not", null)
      .orderBy("deleted_at", "desc")
      .execute();
  },

  async create(
    db: DB,
    item: { id: string; userId: string; encryptedKey: string; encryptedData: string },
  ): Promise<VaultItemRow> {
    const now = Date.now();
    await db
      .insertInto("vault_items")
      .values({
        id: item.id,
        user_id: item.userId,
        encrypted_key: item.encryptedKey,
        encrypted_data: item.encryptedData,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .execute();
    return db
      .selectFrom("vault_items")
      .selectAll()
      .where("id", "=", item.id)
      .executeTakeFirstOrThrow();
  },

  async update(
    db: DB,
    args: { id: string; userId: string; encryptedKey: string; encryptedData: string },
  ): Promise<VaultItemRow | undefined> {
    const result = await db
      .updateTable("vault_items")
      .set({
        encrypted_key: args.encryptedKey,
        encrypted_data: args.encryptedData,
        updated_at: Date.now(),
      })
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return undefined;
    return db.selectFrom("vault_items").selectAll().where("id", "=", args.id).executeTakeFirst();
  },

  /// Soft-delete : déplace vers la corbeille (n'agit que sur un item actif).
  async softDelete(db: DB, args: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .updateTable("vault_items")
      .set({ deleted_at: Date.now() })
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  },

  /// Restaure un item de la corbeille.
  async restore(db: DB, args: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .updateTable("vault_items")
      .set({ deleted_at: null })
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .where("deleted_at", "is not", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  },

  /// Suppression définitive (purge depuis la corbeille).
  async remove(db: DB, args: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("vault_items")
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const emergencyAccess = {
  async create(
    db: DB,
    e: {
      id: string;
      grantorId: string;
      granteeId: string;
      role: EmergencyRole;
      waitDays: number;
      sealedUserKey: string;
    },
  ): Promise<void> {
    await db
      .insertInto("emergency_access")
      .values({
        id: e.id,
        grantor_id: e.grantorId,
        grantee_id: e.granteeId,
        role: e.role,
        wait_days: e.waitDays,
        status: "invited",
        sealed_user_key: e.sealedUserKey,
        requested_at: null,
        created_at: Date.now(),
      })
      .execute();
  },

  findById(db: DB, id: string): Promise<EmergencyAccessRow | undefined> {
    return db.selectFrom("emergency_access").selectAll().where("id", "=", id).executeTakeFirst();
  },

  listAsGrantor(
    db: DB,
    grantorId: string,
  ): Promise<Array<EmergencyAccessRow & { grantee_email: string }>> {
    return db
      .selectFrom("emergency_access as ea")
      .innerJoin("users as u", "u.id", "ea.grantee_id")
      .where("ea.grantor_id", "=", grantorId)
      .orderBy("ea.created_at")
      .selectAll("ea")
      .select("u.email as grantee_email")
      .execute();
  },

  listAsGrantee(
    db: DB,
    granteeId: string,
  ): Promise<
    Array<
      EmergencyAccessRow & {
        grantor_email: string;
        grantor_public_key: string;
        grantor_kdf_params: string;
      }
    >
  > {
    return db
      .selectFrom("emergency_access as ea")
      .innerJoin("users as u", "u.id", "ea.grantor_id")
      .where("ea.grantee_id", "=", granteeId)
      .orderBy("ea.created_at")
      .selectAll("ea")
      .select([
        "u.email as grantor_email",
        "u.public_key as grantor_public_key",
        "u.kdf_params as grantor_kdf_params",
      ])
      .execute();
  },

  async setStatus(db: DB, id: string, status: EmergencyStatus): Promise<void> {
    await db.updateTable("emergency_access").set({ status }).where("id", "=", id).execute();
  },

  async setRequested(db: DB, id: string): Promise<void> {
    await db
      .updateTable("emergency_access")
      .set({ status: "requested", requested_at: Date.now() })
      .where("id", "=", id)
      .execute();
  },

  async clearRequest(db: DB, id: string): Promise<void> {
    await db
      .updateTable("emergency_access")
      .set({ status: "accepted", requested_at: null })
      .where("id", "=", id)
      .execute();
  },

  async remove(db: DB, id: string): Promise<boolean> {
    const result = await db
      .deleteFrom("emergency_access")
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const loginEvents = {
  /// Enregistre une connexion et indique si l'appareil (user-agent) est nouveau pour l'utilisateur.
  async record(
    db: DB,
    e: { id: string; userId: string; ip: string; userAgent: string },
  ): Promise<{ newDevice: boolean }> {
    const seen = await db
      .selectFrom("login_events")
      .select("id")
      .where("user_id", "=", e.userId)
      .where("user_agent", "=", e.userAgent)
      .limit(1)
      .executeTakeFirst();
    const newDevice = !seen;
    await db
      .insertInto("login_events")
      .values({
        id: e.id,
        user_id: e.userId,
        ip: e.ip,
        user_agent: e.userAgent,
        new_device: newDevice ? 1 : 0,
        created_at: Date.now(),
      })
      .execute();
    return { newDevice };
  },

  listByUser(db: DB, userId: string, limit = 20): Promise<LoginEventRow[]> {
    return db
      .selectFrom("login_events")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  },
};

/// Journal d'audit sécurité (append-only). `record` insère un événement ; `listByUser` renvoie
/// l'historique de l'utilisateur (le plus récent d'abord).
export const audit = {
  async record(
    db: DB,
    e: {
      id: string;
      userId: string | null;
      actorEmail: string | null;
      action: string;
      target: string | null;
      ip: string;
    },
  ): Promise<void> {
    await db
      .insertInto("audit_log")
      .values({
        id: e.id,
        user_id: e.userId,
        actor_email: e.actorEmail,
        action: e.action,
        target: e.target,
        ip: e.ip,
        created_at: Date.now(),
      })
      .execute();
  },

  listByUser(db: DB, userId: string, limit = 100): Promise<AuditLogRow[]> {
    return db
      .selectFrom("audit_log")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  },
};

export const passkeys = {
  async create(
    db: DB,
    c: {
      id: string;
      userId: string;
      publicKey: string;
      counter: number;
      transports: string | null;
      name: string;
      prfWrappedUserKey: string;
    },
  ): Promise<void> {
    await db
      .insertInto("passkeys")
      .values({
        id: c.id,
        user_id: c.userId,
        public_key: c.publicKey,
        counter: c.counter,
        transports: c.transports,
        name: c.name,
        prf_wrapped_user_key: c.prfWrappedUserKey,
        created_at: Date.now(),
      })
      .execute();
  },

  listByUser(db: DB, userId: string): Promise<PasskeyRow[]> {
    return db
      .selectFrom("passkeys")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute();
  },

  findById(db: DB, id: string): Promise<PasskeyRow | undefined> {
    return db.selectFrom("passkeys").selectAll().where("id", "=", id).executeTakeFirst();
  },

  async updateCounter(db: DB, id: string, counter: number): Promise<void> {
    await db.updateTable("passkeys").set({ counter }).where("id", "=", id).execute();
  },

  async remove(db: DB, args: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("passkeys")
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const webauthnCredentials = {
  async create(
    db: DB,
    c: {
      id: string;
      userId: string;
      publicKey: string;
      counter: number;
      transports: string | null;
      name: string;
    },
  ): Promise<void> {
    await db
      .insertInto("webauthn_credentials")
      .values({
        id: c.id,
        user_id: c.userId,
        public_key: c.publicKey,
        counter: c.counter,
        transports: c.transports,
        name: c.name,
        created_at: Date.now(),
      })
      .execute();
  },

  listByUser(db: DB, userId: string): Promise<WebAuthnCredentialRow[]> {
    return db
      .selectFrom("webauthn_credentials")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute();
  },

  findById(db: DB, id: string): Promise<WebAuthnCredentialRow | undefined> {
    return db
      .selectFrom("webauthn_credentials")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  },

  async updateCounter(db: DB, id: string, counter: number): Promise<void> {
    await db.updateTable("webauthn_credentials").set({ counter }).where("id", "=", id).execute();
  },

  async remove(db: DB, args: { id: string; userId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("webauthn_credentials")
      .where("id", "=", args.id)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const sends = {
  async create(
    db: DB,
    s: { id: string; ciphertext: string; iv: string; expiresAt: number; maxViews: number },
  ): Promise<void> {
    await db
      .insertInto("sends")
      .values({
        id: s.id,
        ciphertext: s.ciphertext,
        iv: s.iv,
        created_at: Date.now(),
        expires_at: s.expiresAt,
        max_views: s.maxViews,
        views: 0,
      })
      .execute();
  },

  get(db: DB, id: string): Promise<SendRow | undefined> {
    return db.selectFrom("sends").selectAll().where("id", "=", id).executeTakeFirst();
  },

  async incrementViews(db: DB, id: string): Promise<void> {
    await db
      .updateTable("sends")
      .set((eb) => ({ views: eb("views", "+", 1) }))
      .where("id", "=", id)
      .execute();
  },

  async remove(db: DB, id: string): Promise<void> {
    await db.deleteFrom("sends").where("id", "=", id).execute();
  },
};

export const organizations = {
  async create(db: DB, o: { id: string; name: string }): Promise<void> {
    await db
      .insertInto("organizations")
      .values({ id: o.id, name: o.name, created_at: Date.now() })
      .execute();
  },
  findById(db: DB, id: string): Promise<OrgRow | undefined> {
    return db.selectFrom("organizations").selectAll().where("id", "=", id).executeTakeFirst();
  },

  /// Organisations sans aucune collection : cul-de-sac où rien ne peut être rangé, puisqu'un
  /// secret partagé s'attache à une collection et non à l'organisation. Lu par le rattrapage.
  listWithoutCollections(db: DB): Promise<OrgRow[]> {
    return db
      .selectFrom("organizations as o")
      .selectAll("o")
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("collections as c").select("c.id").whereRef("c.org_id", "=", "o.id"),
          ),
        ),
      )
      .orderBy("o.created_at")
      .execute();
  },

  /// Supprime l'organisation. Toutes les tables filles (`org_members`, `collections`,
  /// `org_groups`, et par transitivité `org_items` et les tables d'accès) sont en
  /// `ON DELETE CASCADE` : cet appel efface donc les secrets partagés de l'org. La route qui
  /// l'expose refuse tant qu'il reste des collections, des items ou d'autres membres actifs.
  /// Renvoie `false` si aucune ligne n'a été supprimée (org déjà absente).
  async remove(db: DB, id: string): Promise<boolean> {
    const result = await db.deleteFrom("organizations").where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
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
  async create(db: DB, m: NewMember): Promise<void> {
    await db
      .insertInto("org_members")
      .values({
        id: m.id,
        org_id: m.orgId,
        user_id: m.userId,
        role: m.role,
        status: m.status,
        encrypted_org_key: m.encryptedOrgKey,
        sealed_by_user_id: m.sealedByUserId,
        created_at: Date.now(),
      })
      .execute();
  },

  findByOrgAndUser(db: DB, orgId: string, userId: string): Promise<OrgMemberRow | undefined> {
    return db
      .selectFrom("org_members")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  },

  /// Change le rôle d'un membre (sans toucher aux clés).
  async setRole(
    db: DB,
    args: { orgId: string; userId: string; role: OrgRole },
  ): Promise<void> {
    await db
      .updateTable("org_members")
      .set({ role: args.role })
      .where("org_id", "=", args.orgId)
      .where("user_id", "=", args.userId)
      .execute();
  },

  listByOrg(db: DB, orgId: string): Promise<OrgMemberRow[]> {
    return db
      .selectFrom("org_members")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("created_at")
      .execute();
  },

  /// Orgs où l'utilisateur est membre (tous statuts), avec le nom de l'organisation.
  listForUser(db: DB, userId: string): Promise<Array<OrgMemberRow & { name: string }>> {
    return db
      .selectFrom("org_members as m")
      .innerJoin("organizations as o", "o.id", "m.org_id")
      .where("m.user_id", "=", userId)
      .orderBy("o.name")
      .selectAll("m")
      .select("o.name as name")
      .execute();
  },

  async setActive(db: DB, id: string): Promise<void> {
    await db.updateTable("org_members").set({ status: "active" }).where("id", "=", id).execute();
  },

  /// Met à jour l'Org Key scellée d'un membre (lors d'une rotation).
  async setKey(
    db: DB,
    args: { orgId: string; userId: string; encryptedOrgKey: string; sealedByUserId: string },
  ): Promise<void> {
    await db
      .updateTable("org_members")
      .set({ encrypted_org_key: args.encryptedOrgKey, sealed_by_user_id: args.sealedByUserId })
      .where("org_id", "=", args.orgId)
      .where("user_id", "=", args.userId)
      .execute();
  },

  async remove(db: DB, args: { orgId: string; userId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("org_members")
      .where("org_id", "=", args.orgId)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const collections = {
  /// `isDefault` marque la collection créée avec l'organisation. Elle est unique par org : la
  /// création par un utilisateur ne la pose jamais.
  async create(
    db: DB,
    c: { id: string; orgId: string; name: string; isDefault?: boolean },
  ): Promise<void> {
    await db
      .insertInto("collections")
      .values({
        id: c.id,
        org_id: c.orgId,
        name: c.name,
        is_default: c.isDefault ? 1 : 0,
        created_at: Date.now(),
      })
      .execute();
  },

  /// La collection par défaut d'une org, ou `undefined` si elle n'en a pas : c'est le cas des
  /// organisations qui possédaient déjà des collections quand le rattrapage est passé.
  findDefault(db: DB, orgId: string): Promise<CollectionRow | undefined> {
    return db
      .selectFrom("collections")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("is_default", "=", 1)
      .orderBy("created_at")
      .executeTakeFirst();
  },
  listByOrg(db: DB, orgId: string): Promise<CollectionRow[]> {
    return db
      .selectFrom("collections")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("name")
      .execute();
  },
  findById(db: DB, id: string): Promise<CollectionRow | undefined> {
    return db.selectFrom("collections").selectAll().where("id", "=", id).executeTakeFirst();
  },
};

export const orgItems = {
  async create(
    db: DB,
    item: { id: string; collectionId: string; encryptedKey: string; encryptedData: string },
  ): Promise<OrgItemRow> {
    const now = Date.now();
    await db
      .insertInto("org_items")
      .values({
        id: item.id,
        collection_id: item.collectionId,
        encrypted_key: item.encryptedKey,
        encrypted_data: item.encryptedData,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return db
      .selectFrom("org_items")
      .selectAll()
      .where("id", "=", item.id)
      .executeTakeFirstOrThrow();
  },
  listByCollection(db: DB, collectionId: string): Promise<OrgItemRow[]> {
    return db
      .selectFrom("org_items")
      .selectAll()
      .where("collection_id", "=", collectionId)
      .orderBy("updated_at", "desc")
      .execute();
  },

  /// Tous les items partagés d'une org (toutes collections) — utile pour la rotation.
  listByOrg(db: DB, orgId: string): Promise<OrgItemRow[]> {
    return db
      .selectFrom("org_items as i")
      .innerJoin("collections as c", "c.id", "i.collection_id")
      .where("c.org_id", "=", orgId)
      .selectAll("i")
      .execute();
  },

  /// Ré-enveloppe l'item key (rotation) ; le contenu chiffré reste inchangé.
  async setEncryptedKey(db: DB, args: { id: string; encryptedKey: string }): Promise<void> {
    await db
      .updateTable("org_items")
      .set({ encrypted_key: args.encryptedKey, updated_at: Date.now() })
      .where("id", "=", args.id)
      .execute();
  },
  async update(
    db: DB,
    args: { id: string; collectionId: string; encryptedKey: string; encryptedData: string },
  ): Promise<OrgItemRow | undefined> {
    const result = await db
      .updateTable("org_items")
      .set({
        encrypted_key: args.encryptedKey,
        encrypted_data: args.encryptedData,
        updated_at: Date.now(),
      })
      .where("id", "=", args.id)
      .where("collection_id", "=", args.collectionId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) return undefined;
    return db.selectFrom("org_items").selectAll().where("id", "=", args.id).executeTakeFirst();
  },
  async remove(db: DB, args: { id: string; collectionId: string }): Promise<boolean> {
    const result = await db
      .deleteFrom("org_items")
      .where("id", "=", args.id)
      .where("collection_id", "=", args.collectionId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  },
};

export const collectionAccess = {
  /// Accorde (ou met à jour) la permission d'un utilisateur sur une collection.
  async grant(
    db: DB,
    a: { id: string; collectionId: string; userId: string; permission: CollectionPermission },
  ): Promise<void> {
    await db
      .insertInto("collection_access")
      .values({
        id: a.id,
        collection_id: a.collectionId,
        user_id: a.userId,
        permission: a.permission,
        created_at: Date.now(),
      })
      .onConflict((oc) =>
        oc.columns(["collection_id", "user_id"]).doUpdateSet({
          permission: (eb) => eb.ref("excluded.permission"),
        }),
      )
      .execute();
  },

  findFor(
    db: DB,
    collectionId: string,
    userId: string,
  ): Promise<CollectionAccessRow | undefined> {
    return db
      .selectFrom("collection_access")
      .selectAll()
      .where("collection_id", "=", collectionId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
  },

  /// Collections d'une org auxquelles l'utilisateur a un accès explicite.
  listCollectionsForUser(db: DB, orgId: string, userId: string): Promise<CollectionRow[]> {
    return db
      .selectFrom("collections as c")
      .innerJoin("collection_access as a", "a.collection_id", "c.id")
      .where("c.org_id", "=", orgId)
      .where("a.user_id", "=", userId)
      .orderBy("c.name")
      .selectAll("c")
      .execute();
  },
};

/// Store éphémère partagé (usage unique + TTL) : challenges WebAuthn, état SSO/PKCE. En base
/// pour fonctionner en multi-instance. `take` consomme et vérifie l'expiration.
export const ephemeral = {
  async put(db: DB, key: string, value: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    await db
      .insertInto("auth_ephemeral")
      .values({ key, value, expires_at: expiresAt })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value, expires_at: expiresAt }))
      .execute();
  },

  async take(db: DB, key: string): Promise<string | null> {
    const row = await db
      .selectFrom("auth_ephemeral")
      .select(["value", "expires_at"])
      .where("key", "=", key)
      .executeTakeFirst();
    await db.deleteFrom("auth_ephemeral").where("key", "=", key).execute();
    if (!row || row.expires_at < Date.now()) return null;
    return row.value;
  },

  /// Balaye les entrées expirées (à appeler périodiquement).
  async purgeExpired(db: DB): Promise<void> {
    await db.deleteFrom("auth_ephemeral").where("expires_at", "<", Date.now()).execute();
  },
};

// ─── Groupes d'organisation (contrôle d'accès) ───

export const orgGroups = {
  async create(db: DB, g: { id: string; orgId: string; name: string }): Promise<void> {
    await db
      .insertInto("org_groups")
      .values({ id: g.id, org_id: g.orgId, name: g.name, created_at: Date.now() })
      .execute();
  },

  listByOrg(db: DB, orgId: string): Promise<OrgGroupRow[]> {
    return db
      .selectFrom("org_groups")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("name")
      .execute();
  },

  findById(db: DB, id: string): Promise<OrgGroupRow | undefined> {
    return db.selectFrom("org_groups").selectAll().where("id", "=", id).executeTakeFirst();
  },

  async remove(db: DB, id: string): Promise<boolean> {
    const r = await db.deleteFrom("org_groups").where("id", "=", id).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  },
};

export const orgGroupMembers = {
  async add(db: DB, m: { id: string; groupId: string; userId: string }): Promise<void> {
    await db
      .insertInto("org_group_members")
      .values({ id: m.id, group_id: m.groupId, user_id: m.userId, created_at: Date.now() })
      .onConflict((oc) => oc.columns(["group_id", "user_id"]).doNothing())
      .execute();
  },

  async remove(db: DB, args: { groupId: string; userId: string }): Promise<boolean> {
    const r = await db
      .deleteFrom("org_group_members")
      .where("group_id", "=", args.groupId)
      .where("user_id", "=", args.userId)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  },

  /// Membres d'un groupe, avec l'email de chacun.
  listByGroup(db: DB, groupId: string): Promise<Array<OrgGroupMemberRow & { email: string }>> {
    return db
      .selectFrom("org_group_members as gm")
      .innerJoin("users as u", "u.id", "gm.user_id")
      .where("gm.group_id", "=", groupId)
      .orderBy("u.email")
      .selectAll("gm")
      .select("u.email as email")
      .execute();
  },

  /// Groupes d'une org auxquels l'utilisateur appartient.
  listGroupsForUser(db: DB, orgId: string, userId: string): Promise<OrgGroupRow[]> {
    return db
      .selectFrom("org_groups as g")
      .innerJoin("org_group_members as gm", "gm.group_id", "g.id")
      .where("g.org_id", "=", orgId)
      .where("gm.user_id", "=", userId)
      .orderBy("g.name")
      .selectAll("g")
      .execute();
  },
};

export const groupCollectionAccess = {
  /// Accorde (ou met à jour) la permission d'un groupe sur une collection.
  async grant(
    db: DB,
    a: { id: string; groupId: string; collectionId: string; permission: CollectionPermission },
  ): Promise<void> {
    await db
      .insertInto("group_collection_access")
      .values({
        id: a.id,
        group_id: a.groupId,
        collection_id: a.collectionId,
        permission: a.permission,
        created_at: Date.now(),
      })
      .onConflict((oc) =>
        oc.columns(["group_id", "collection_id"]).doUpdateSet({
          permission: (eb) => eb.ref("excluded.permission"),
        }),
      )
      .execute();
  },

  async revoke(db: DB, args: { groupId: string; collectionId: string }): Promise<boolean> {
    const r = await db
      .deleteFrom("group_collection_access")
      .where("group_id", "=", args.groupId)
      .where("collection_id", "=", args.collectionId)
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  },

  listByGroup(db: DB, groupId: string): Promise<GroupCollectionAccessRow[]> {
    return db
      .selectFrom("group_collection_access")
      .selectAll()
      .where("group_id", "=", groupId)
      .execute();
  },

  /// Collections d'une org accessibles à l'utilisateur via ses groupes.
  listCollectionsForUser(db: DB, orgId: string, userId: string): Promise<CollectionRow[]> {
    return db
      .selectFrom("collections as c")
      .innerJoin("group_collection_access as a", "a.collection_id", "c.id")
      .innerJoin("org_group_members as gm", "gm.group_id", "a.group_id")
      .where("c.org_id", "=", orgId)
      .where("gm.user_id", "=", userId)
      .distinct()
      .selectAll("c")
      .execute();
  },

  /// Permissions que les groupes de l'utilisateur lui confèrent sur une collection donnée.
  async permissionsForUserOnCollection(
    db: DB,
    collectionId: string,
    userId: string,
  ): Promise<CollectionPermission[]> {
    const rows = await db
      .selectFrom("group_collection_access as a")
      .innerJoin("org_group_members as gm", "gm.group_id", "a.group_id")
      .where("a.collection_id", "=", collectionId)
      .where("gm.user_id", "=", userId)
      .select("a.permission")
      .execute();
    return rows.map((r) => r.permission);
  },
};
