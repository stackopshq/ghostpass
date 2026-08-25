//! Binding UniFFI du cœur crypto, pour les applications mobiles natives (iOS, Android).
//!
//! C'est le pendant exact de `ghostpass-crypto-wasm` : même découpage, mêmes noms, mêmes
//! échanges en JSON. Tout le chiffrement reste **dans le cœur Rust** ; Swift ne manipule
//! qu'un objet `Account` opaque et des données déjà chiffrées. Aucune clé en clair ne
//! traverse la frontière FFI, donc rien de sensible ne peut atterrir dans un log Swift,
//! un crash report ou une capture d'écran de débogueur.
//!
//! Périmètre : cycle de vie du compte, coffre personnel et passkey — ce dont l'application
//! v1 a besoin. Le partage d'organisation et l'accès d'urgence existent dans le cœur et
//! dans le binding WASM ; ils seront ajoutés ici quand l'application les exposera, pas avant.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ghostpass_crypto::{keys, vault, EncString, EncryptedItem, KdfParams, VaultItem};
use std::sync::Arc;

uniffi::setup_scaffolding!();

/// Erreur unique côté FFI : le détail cryptographique ne doit pas fuiter dans un type
/// structuré que l'appelant serait tenté d'inspecter — un message suffit à diagnostiquer.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum GhostpassError {
    #[error("{message}")]
    Crypto { message: String },
}

fn err<E: core::fmt::Display>(e: E) -> GhostpassError {
    GhostpassError::Crypto {
        message: e.to_string(),
    }
}

/// Décode une clé symétrique de 32 octets depuis sa représentation base64.
fn decode_key_32(b64: &str) -> Result<[u8; 32], GhostpassError> {
    let bytes = STANDARD.decode(b64).map_err(err)?;
    bytes.try_into().map_err(|_| GhostpassError::Crypto {
        message: "clé de 32 octets invalide".to_string(),
    })
}

/// Paramètres KDF par défaut (JSON), à stocker avec le compte côté serveur.
#[uniffi::export]
pub fn default_kdf_params() -> Result<String, GhostpassError> {
    serde_json::to_string(&KdfParams::default()).map_err(err)
}

/// Hash d'authentification (base64) à envoyer au serveur lors d'une connexion.
#[uniffi::export]
pub fn master_password_hash(
    password: String,
    email: String,
    kdf_params_json: String,
) -> Result<String, GhostpassError> {
    let params: KdfParams = serde_json::from_str(&kdf_params_json).map_err(err)?;
    params.ensure_strong().map_err(err)?;
    keys::master_password_hash(password.as_bytes(), &email, params).map_err(err)
}

/// Crée un compte : génère les clés et le blob chiffré d'inscription.
#[uniffi::export]
pub fn register(password: String, email: String) -> Result<Arc<Registration>, GhostpassError> {
    let (account_keys, blob) =
        keys::register(password.as_bytes(), &email, KdfParams::default()).map_err(err)?;
    let blob_json = serde_json::to_string(&blob).map_err(err)?;
    Ok(Arc::new(Registration {
        account: Arc::new(Account { keys: account_keys }),
        blob_json,
    }))
}

/// Récupère un compte via sa clé de récupération et réinitialise le mot de passe maître.
#[uniffi::export]
pub fn recover(
    recovery_key: String,
    email: String,
    new_password: String,
    kdf_params_json: String,
    encrypted_user_key_recovery: String,
    encrypted_private_key: String,
) -> Result<Arc<RecoveryResult>, GhostpassError> {
    let params: KdfParams = serde_json::from_str(&kdf_params_json).map_err(err)?;
    params.ensure_strong().map_err(err)?;
    let euk_rec: EncString = encrypted_user_key_recovery.parse().map_err(err)?;
    let epk: EncString = encrypted_private_key.parse().map_err(err)?;
    let (account_keys, reset) = keys::recover(
        &recovery_key,
        &email,
        new_password.as_bytes(),
        params,
        &euk_rec,
        &epk,
    )
    .map_err(err)?;
    let reset_json = serde_json::to_string(&reset).map_err(err)?;
    Ok(Arc::new(RecoveryResult {
        account: Arc::new(Account { keys: account_keys }),
        reset_json,
    }))
}

/// Résultat d'une inscription : le `blob` (JSON à envoyer au serveur) et l'`Account` (les clés).
#[derive(uniffi::Object)]
pub struct Registration {
    account: Arc<Account>,
    blob_json: String,
}

#[uniffi::export]
impl Registration {
    /// JSON du `RegistrationBlob` à transmettre au serveur (qui ne peut rien en déchiffrer).
    pub fn blob(&self) -> String {
        self.blob_json.clone()
    }

    /// Le compte déverrouillé issu de l'inscription.
    pub fn account(&self) -> Arc<Account> {
        Arc::clone(&self.account)
    }
}

/// Résultat d'une récupération : le `reset` (JSON à envoyer au serveur) + l'`Account` rouvert.
#[derive(uniffi::Object)]
pub struct RecoveryResult {
    account: Arc<Account>,
    reset_json: String,
}

#[uniffi::export]
impl RecoveryResult {
    /// JSON du `ResetBlob` (nouveau hash d'auth, preuve de récupération, nouvelle USK enveloppée).
    pub fn reset(&self) -> String {
        self.reset_json.clone()
    }

    pub fn account(&self) -> Arc<Account> {
        Arc::clone(&self.account)
    }
}

/// Compte déverrouillé : détient les clés côté Rust (jamais exposées en clair à Swift).
#[derive(uniffi::Object)]
pub struct Account {
    keys: keys::AccountKeys,
}

#[uniffi::export]
impl Account {
    /// Déverrouille un compte existant à partir des blobs chiffrés (format `EncString`).
    #[uniffi::constructor]
    pub fn unlock(
        password: String,
        email: String,
        kdf_params_json: String,
        encrypted_user_key: String,
        encrypted_private_key: String,
    ) -> Result<Arc<Self>, GhostpassError> {
        let params: KdfParams = serde_json::from_str(&kdf_params_json).map_err(err)?;
        params.ensure_strong().map_err(err)?;
        let euk = encrypted_user_key.parse().map_err(err)?;
        let epk = encrypted_private_key.parse().map_err(err)?;
        let account_keys =
            keys::unlock(password.as_bytes(), &email, params, &euk, &epk).map_err(err)?;
        Ok(Arc::new(Account { keys: account_keys }))
    }

    /// Déverrouille un compte SANS mot de passe à partir du secret PRF (base64) de la passkey,
    /// de l'USK enveloppée par PRF et de la clé privée chiffrée.
    #[uniffi::constructor]
    pub fn with_passkey(
        prf_secret_b64: String,
        prf_wrapped_user_key: String,
        encrypted_private_key: String,
    ) -> Result<Arc<Self>, GhostpassError> {
        let prf = decode_key_32(&prf_secret_b64)?;
        let wrapped: EncString = prf_wrapped_user_key.parse().map_err(err)?;
        let epk: EncString = encrypted_private_key.parse().map_err(err)?;
        let account_keys = keys::unlock_with_passkey(&prf, &wrapped, &epk).map_err(err)?;
        Ok(Arc::new(Account { keys: account_keys }))
    }

    /// Clé publique de partage (base64), à publier côté serveur pour recevoir des secrets partagés.
    pub fn public_key(&self) -> String {
        STANDARD.encode(self.keys.public_key.as_bytes())
    }

    /// Chiffre un item de coffre (JSON `VaultItem`) avec l'USK. Renvoie un JSON `EncryptedItem`.
    pub fn encrypt_item(&self, item_json: String) -> Result<String, GhostpassError> {
        let item: VaultItem = serde_json::from_str(&item_json).map_err(err)?;
        let enc = vault::encrypt_item(&self.keys.user_key, &item).map_err(err)?;
        serde_json::to_string(&enc).map_err(err)
    }

    /// Déchiffre un JSON `EncryptedItem` avec l'USK. Renvoie le JSON `VaultItem`.
    pub fn decrypt_item(&self, encrypted_item_json: String) -> Result<String, GhostpassError> {
        let enc: EncryptedItem = serde_json::from_str(&encrypted_item_json).map_err(err)?;
        let item = vault::decrypt_item(&self.keys.user_key, &enc).map_err(err)?;
        serde_json::to_string(&item).map_err(err)
    }

    /// Crée un kit de récupération. Renvoie un JSON
    /// `{ recovery_key, recovery_auth_hash, encrypted_user_key_recovery }`.
    /// `recovery_key` est à AFFICHER à l'utilisateur ; les deux autres champs partent au serveur.
    pub fn create_recovery(&self) -> Result<String, GhostpassError> {
        let artifacts = keys::create_recovery(&self.keys.user_key).map_err(err)?;
        serde_json::to_string(&artifacts).map_err(err)
    }

    /// Enveloppe l'USK avec le secret PRF (base64) d'une passkey, pour le déverrouillage sans
    /// mot de passe. Renvoie l'`EncString` à stocker côté serveur.
    pub fn wrap_user_key_for_passkey(
        &self,
        prf_secret_b64: String,
    ) -> Result<String, GhostpassError> {
        let prf = decode_key_32(&prf_secret_b64)?;
        let wrapped = keys::wrap_user_key_for_passkey(&self.keys.user_key, &prf).map_err(err)?;
        Ok(wrapped.to_string())
    }
}
