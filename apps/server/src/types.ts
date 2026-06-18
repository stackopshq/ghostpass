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
  encrypted_user_key_recovery: string | null;
  recovery_auth_hash: string | null;
  recovery_salt: string | null;
  created_at: number;
}

export interface VaultItemRow {
  id: string;
  user_id: string;
  encrypted_key: string;
  encrypted_data: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
}
