//! Binding WASM du cœur crypto, pour la web app et l'extension navigateur.
//!
//! Tout le chiffrement reste **dans le module WASM** : les clés en clair ne sont jamais
//! exposées au JavaScript. Le JS manipule un objet `Account` opaque et échange avec lui
//! des données déjà chiffrées (JSON `EncryptedItem`) ou publiques (clé publique en base64).
//!
//! Les structures (blob d'inscription, items, paramètres KDF) transitent en **JSON**, ce qui
//! garde l'interface simple et stable côté JS.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ghostpass_crypto::{keys, vault, EncString, EncryptedItem, KdfParams, VaultItem};
use wasm_bindgen::prelude::*;

fn js_err<E: core::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// Compte déverrouillé : détient les clés en mémoire WASM (jamais exposées en clair au JS).
#[wasm_bindgen]
pub struct Account {
    keys: keys::AccountKeys,
}

/// Résultat d'une inscription : le `blob` (JSON à envoyer au serveur) et l'`Account` (les clés).
#[wasm_bindgen]
pub struct Registration {
    account: Option<Account>,
    blob_json: String,
}

#[wasm_bindgen]
impl Registration {
    /// JSON du `RegistrationBlob` à transmettre au serveur (qui ne peut rien en déchiffrer).
    #[wasm_bindgen(getter)]
    pub fn blob(&self) -> String {
        self.blob_json.clone()
    }

    /// Récupère l'`Account` (les clés en mémoire). Ne peut être appelé qu'une fois.
    pub fn account(&mut self) -> Result<Account, JsError> {
        self.account
            .take()
            .ok_or_else(|| JsError::new("account déjà consommé"))
    }
}

/// Résultat d'une récupération : le `reset` (JSON à envoyer au serveur) + l'`Account` rouvert.
#[wasm_bindgen]
pub struct RecoveryResult {
    account: Option<Account>,
    reset_json: String,
}

#[wasm_bindgen]
impl RecoveryResult {
    /// JSON du `ResetBlob` (nouveau hash d'auth, preuve de récupération, nouvelle USK enveloppée).
    #[wasm_bindgen(getter)]
    pub fn reset(&self) -> String {
        self.reset_json.clone()
    }

    pub fn account(&mut self) -> Result<Account, JsError> {
        self.account
            .take()
            .ok_or_else(|| JsError::new("compte déjà consommé"))
    }
}

#[wasm_bindgen]
impl Account {
    /// Paramètres KDF par défaut (JSON), à stocker avec le compte côté serveur.
    pub fn default_kdf_params() -> Result<String, JsError> {
        serde_json::to_string(&KdfParams::default()).map_err(js_err)
    }

    /// Crée un compte : génère les clés et le blob chiffré d'inscription.
    pub fn register(password: &str, email: &str) -> Result<Registration, JsError> {
        let (account_keys, blob) =
            keys::register(password.as_bytes(), email, KdfParams::default()).map_err(js_err)?;
        let blob_json = serde_json::to_string(&blob).map_err(js_err)?;
        Ok(Registration {
            account: Some(Account { keys: account_keys }),
            blob_json,
        })
    }

    /// Déverrouille un compte existant à partir des blobs chiffrés (format `EncString`).
    pub fn unlock(
        password: &str,
        email: &str,
        kdf_params_json: &str,
        encrypted_user_key: &str,
        encrypted_private_key: &str,
    ) -> Result<Account, JsError> {
        let params: KdfParams = serde_json::from_str(kdf_params_json).map_err(js_err)?;
        let euk = encrypted_user_key.parse().map_err(js_err)?;
        let epk = encrypted_private_key.parse().map_err(js_err)?;
        let account_keys =
            keys::unlock(password.as_bytes(), email, params, &euk, &epk).map_err(js_err)?;
        Ok(Account {
            keys: account_keys,
        })
    }

    /// Hash d'authentification (base64) à envoyer au serveur lors d'une connexion.
    pub fn master_password_hash(
        password: &str,
        email: &str,
        kdf_params_json: &str,
    ) -> Result<String, JsError> {
        let params: KdfParams = serde_json::from_str(kdf_params_json).map_err(js_err)?;
        keys::master_password_hash(password.as_bytes(), email, params).map_err(js_err)
    }

    /// Crée un kit de récupération. Renvoie un JSON
    /// `{ recovery_key, recovery_auth_hash, encrypted_user_key_recovery }`.
    /// `recovery_key` est à AFFICHER à l'utilisateur ; les deux autres champs partent au serveur.
    pub fn create_recovery(&self) -> Result<String, JsError> {
        let artifacts = keys::create_recovery(&self.keys.user_key).map_err(js_err)?;
        serde_json::to_string(&artifacts).map_err(js_err)
    }

    /// Récupère un compte via sa clé de récupération et réinitialise le mot de passe maître.
    pub fn recover(
        recovery_key: &str,
        email: &str,
        new_password: &str,
        kdf_params_json: &str,
        encrypted_user_key_recovery: &str,
        encrypted_private_key: &str,
    ) -> Result<RecoveryResult, JsError> {
        let params: KdfParams = serde_json::from_str(kdf_params_json).map_err(js_err)?;
        let euk_rec: EncString = encrypted_user_key_recovery.parse().map_err(js_err)?;
        let epk: EncString = encrypted_private_key.parse().map_err(js_err)?;
        let (account_keys, reset) =
            keys::recover(recovery_key, email, new_password.as_bytes(), params, &euk_rec, &epk)
                .map_err(js_err)?;
        let reset_json = serde_json::to_string(&reset).map_err(js_err)?;
        Ok(RecoveryResult {
            account: Some(Account { keys: account_keys }),
            reset_json,
        })
    }

    /// Clé publique de partage (base64), à publier côté serveur pour recevoir des secrets partagés.
    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> String {
        STANDARD.encode(self.keys.public_key.as_bytes())
    }

    /// Chiffre un item de coffre (JSON `VaultItem`) avec l'USK. Renvoie un JSON `EncryptedItem`.
    pub fn encrypt_item(&self, item_json: &str) -> Result<String, JsError> {
        let item: VaultItem = serde_json::from_str(item_json).map_err(js_err)?;
        let enc = vault::encrypt_item(&self.keys.user_key, &item).map_err(js_err)?;
        serde_json::to_string(&enc).map_err(js_err)
    }

    /// Déchiffre un JSON `EncryptedItem` avec l'USK. Renvoie le JSON `VaultItem`.
    pub fn decrypt_item(&self, encrypted_item_json: &str) -> Result<String, JsError> {
        let enc: EncryptedItem = serde_json::from_str(encrypted_item_json).map_err(js_err)?;
        let item = vault::decrypt_item(&self.keys.user_key, &enc).map_err(js_err)?;
        serde_json::to_string(&item).map_err(js_err)
    }
}
