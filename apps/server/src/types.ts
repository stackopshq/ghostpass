/// Lignes de la base (telles que stockées). Tous les champs `encrypted_*` sont des blobs
/// que le serveur ne peut pas déchiffrer.

export interface UserRow {
  id: string;
  email: string;
  kdf_params: string;
  server_password_hash: string;
  password_salt: string;
  encrypted_user_key: string;
  encrypted_private_key: string;
  public_key: string;
  mfa_secret: string | null;
  mfa_enabled: number;
  mfa_last_counter: number;
  encrypted_user_key_recovery: string | null;
  recovery_auth_hash: string | null;
  recovery_salt: string | null;
  created_at: number;
}

export type EmergencyRole = "view" | "takeover";
export type EmergencyStatus = "invited" | "accepted" | "requested" | "granted";

export interface EmergencyAccessRow {
  id: string;
  grantor_id: string;
  grantee_id: string;
  role: EmergencyRole;
  wait_days: number;
  status: EmergencyStatus;
  sealed_user_key: string;
  requested_at: number | null;
  created_at: number;
}

export interface LoginEventRow {
  id: string;
  user_id: string;
  ip: string;
  user_agent: string;
  new_device: number;
  created_at: number;
}

export interface WebAuthnCredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string;
  created_at: number;
}

export interface SendRow {
  id: string;
  ciphertext: string;
  iv: string;
  created_at: number;
  expires_at: number;
  max_views: number;
  views: number;
}

export interface VaultItemRow {
  id: string;
  user_id: string;
  encrypted_key: string;
  encrypted_data: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
}

export interface OrgRow {
  id: string;
  name: string;
  created_at: number;
}

export type OrgRole = "admin" | "member" | "readonly";
export type MemberStatus = "invited" | "active";

export interface OrgMemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: MemberStatus;
  encrypted_org_key: string | null;
  sealed_by_user_id: string | null;
  created_at: number;
}

export interface CollectionRow {
  id: string;
  org_id: string;
  name: string;
  created_at: number;
}

export interface OrgItemRow {
  id: string;
  collection_id: string;
  encrypted_key: string;
  encrypted_data: string;
  created_at: number;
  updated_at: number;
}

export type CollectionPermission = "read" | "write" | "manage";

export interface CollectionAccessRow {
  id: string;
  collection_id: string;
  user_id: string;
  permission: CollectionPermission;
  created_at: number;
}
