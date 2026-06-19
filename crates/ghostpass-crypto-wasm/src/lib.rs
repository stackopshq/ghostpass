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
use crypto_box::PublicKey;
use ghostpass_crypto::{keys, org, sharing, vault, EncString, EncryptedItem, KdfParams, VaultItem};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

fn js_err<E: core::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// Décode une clé symétrique de 32 octets depuis sa représentation base64.
fn decode_key_32(b64: &str) -> Result<[u8; 32], JsError> {
    let bytes = STANDARD.decode(b64).map_err(js_err)?;
    bytes
        .try_into()
        .map_err(|_| JsError::new("clé de 32 octets invalide"))
}

/// Reconstruit une clé publique de partage X25519 depuis sa représentation base64.
fn decode_public_key(b64: &str) -> Result<PublicKey, JsError> {
    let bytes = STANDARD.decode(b64).map_err(js_err)?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| JsError::new("clé publique invalide"))?;
    Ok(PublicKey::from(arr))
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
        params.ensure_strong().map_err(js_err)?;
        let euk = encrypted_user_key.parse().map_err(js_err)?;
        let epk = encrypted_private_key.parse().map_err(js_err)?;
        let account_keys =
            keys::unlock(password.as_bytes(), email, params, &euk, &epk).map_err(js_err)?;
        Ok(Account { keys: account_keys })
    }

    /// Hash d'authentification (base64) à envoyer au serveur lors d'une connexion.
    pub fn master_password_hash(
        password: &str,
        email: &str,
        kdf_params_json: &str,
    ) -> Result<String, JsError> {
        let params: KdfParams = serde_json::from_str(kdf_params_json).map_err(js_err)?;
        params.ensure_strong().map_err(js_err)?;
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
        params.ensure_strong().map_err(js_err)?;
        let euk_rec: EncString = encrypted_user_key_recovery.parse().map_err(js_err)?;
        let epk: EncString = encrypted_private_key.parse().map_err(js_err)?;
        let (account_keys, reset) = keys::recover(
            recovery_key,
            email,
            new_password.as_bytes(),
            params,
            &euk_rec,
            &epk,
        )
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

    // ─── Passkey passwordless (extension PRF WebAuthn) ───
    /// Enveloppe l'USK avec le secret PRF (base64) d'une passkey, pour le déverrouillage sans
    /// mot de passe. Renvoie l'`EncString` à stocker côté serveur.
    pub fn wrap_user_key_for_passkey(&self, prf_secret_b64: &str) -> Result<String, JsError> {
        let prf = decode_key_32(prf_secret_b64)?;
        let wrapped = keys::wrap_user_key_for_passkey(&self.keys.user_key, &prf).map_err(js_err)?;
        Ok(wrapped.to_string())
    }

    /// Déverrouille un compte SANS mot de passe à partir du secret PRF (base64) de la passkey,
    /// de l'USK enveloppée par PRF et de la clé privée chiffrée.
    pub fn unlock_with_passkey(
        prf_secret_b64: &str,
        prf_wrapped_user_key: &str,
        encrypted_private_key: &str,
    ) -> Result<Account, JsError> {
        let prf = decode_key_32(prf_secret_b64)?;
        let wrapped: EncString = prf_wrapped_user_key.parse().map_err(js_err)?;
        let epk: EncString = encrypted_private_key.parse().map_err(js_err)?;
        let account_keys = keys::unlock_with_passkey(&prf, &wrapped, &epk).map_err(js_err)?;
        Ok(Account { keys: account_keys })
    }
}

// ─── Partage / organisations ───────────────────────────────────────────────

/// Contexte d'une organisation : détient l'Org Key en mémoire WASM (jamais exposée au JS).
#[wasm_bindgen]
pub struct Org {
    org_key: Zeroizing<[u8; 32]>,
}

#[wasm_bindgen]
impl Org {
    /// Chiffre un item (JSON `VaultItem`) sous l'Org Key. Renvoie un JSON `EncryptedItem`.
    pub fn encrypt_item(&self, item_json: &str) -> Result<String, JsError> {
        let item: VaultItem = serde_json::from_str(item_json).map_err(js_err)?;
        let enc = vault::encrypt_item(&self.org_key, &item).map_err(js_err)?;
        serde_json::to_string(&enc).map_err(js_err)
    }

    /// Déchiffre un JSON `EncryptedItem` sous l'Org Key. Renvoie le JSON `VaultItem`.
    pub fn decrypt_item(&self, encrypted_item_json: &str) -> Result<String, JsError> {
        let enc: EncryptedItem = serde_json::from_str(encrypted_item_json).map_err(js_err)?;
        let item = vault::decrypt_item(&self.org_key, &enc).map_err(js_err)?;
        serde_json::to_string(&item).map_err(js_err)
    }

    /// Ré-enveloppe un item d'une ancienne Org Key vers celle-ci (rotation / révocation),
    /// sans déchiffrer le contenu.
    pub fn rewrap_item(&self, old_org: &Org, encrypted_item_json: &str) -> Result<String, JsError> {
        let enc: EncryptedItem = serde_json::from_str(encrypted_item_json).map_err(js_err)?;
        let rewrapped =
            vault::rewrap_item_key(&old_org.org_key, &self.org_key, &enc).map_err(js_err)?;
        serde_json::to_string(&rewrapped).map_err(js_err)
    }
}

/// Résultat de la création d'une org : le contexte `Org` + l'Org Key scellée pour le créateur
/// (à stocker côté serveur comme entrée du membre-admin).
#[wasm_bindgen]
pub struct OrgCreation {
    org: Option<Org>,
    sealed_for_self: String,
}

#[wasm_bindgen]
impl OrgCreation {
    /// Org Key scellée pour le créateur (base64), à transmettre au serveur.
    #[wasm_bindgen(getter)]
    pub fn sealed_for_self(&self) -> String {
        self.sealed_for_self.clone()
    }

    /// Récupère le contexte `Org` (les clés). Ne peut être appelé qu'une fois.
    pub fn org(&mut self) -> Result<Org, JsError> {
        self.org
            .take()
            .ok_or_else(|| JsError::new("org déjà consommée"))
    }
}

#[wasm_bindgen]
impl Account {
    /// Crée une organisation : génère une Org Key et la scelle (authentifiée) pour soi-même.
    pub fn create_org(&self) -> Result<OrgCreation, JsError> {
        let org_key = org::generate_org_key();
        let sealed = sharing::box_seal(&self.keys.secret_key, &self.keys.public_key, &org_key)
            .map_err(js_err)?;
        Ok(OrgCreation {
            org: Some(Org {
                org_key: Zeroizing::new(org_key),
            }),
            sealed_for_self: STANDARD.encode(sealed),
        })
    }

    /// Ouvre une Org Key reçue d'un admin, en vérifiant qu'elle provient de sa clé publique.
    pub fn open_org(&self, admin_public_key: &str, sealed: &str) -> Result<Org, JsError> {
        let admin_public = decode_public_key(admin_public_key)?;
        let sealed_bytes = STANDARD.decode(sealed).map_err(js_err)?;
        let org_key = org::open_org_key(&self.keys.secret_key, &admin_public, &sealed_bytes)
            .map_err(js_err)?;
        Ok(Org {
            org_key: Zeroizing::new(org_key),
        })
    }

    /// Scelle l'Org Key pour un membre (en tant qu'admin émetteur). Renvoie le blob base64.
    pub fn seal_org_key_for_member(
        &self,
        org: &Org,
        member_public_key: &str,
    ) -> Result<String, JsError> {
        let member_public = decode_public_key(member_public_key)?;
        let sealed =
            org::seal_org_key_for_member(&self.keys.secret_key, &member_public, &org.org_key)
                .map_err(js_err)?;
        Ok(STANDARD.encode(sealed))
    }

    // ─── Accès d'urgence ───
    /// Scelle l'USK du compte pour un contact de confiance (accès d'urgence), authentifié.
    /// Le blob (base64) est stocké côté serveur et n'est ouvrable qu'avec la clé privée du contact.
    pub fn seal_user_key_for(&self, contact_public_key: &str) -> Result<String, JsError> {
        let contact_public = decode_public_key(contact_public_key)?;
        let sealed = sharing::box_seal(
            &self.keys.secret_key,
            &contact_public,
            self.keys.user_key.as_slice(),
        )
        .map_err(js_err)?;
        Ok(STANDARD.encode(sealed))
    }

    /// (Contact) Ouvre un accès d'urgence reçu d'un grantor : récupère son USK en mémoire WASM,
    /// en vérifiant que le blob provient bien de la clé publique du grantor.
    pub fn open_emergency(
        &self,
        grantor_public_key: &str,
        sealed: &str,
    ) -> Result<EmergencyVault, JsError> {
        let grantor_public = decode_public_key(grantor_public_key)?;
        let sealed_bytes = STANDARD.decode(sealed).map_err(js_err)?;
        let opened = sharing::box_open(&self.keys.secret_key, &grantor_public, &sealed_bytes)
            .map_err(js_err)?;
        let arr: [u8; 32] = opened
            .try_into()
            .map_err(|_| JsError::new("USK d'urgence invalide"))?;
        Ok(EmergencyVault {
            user_key: Zeroizing::new(arr),
        })
    }
}

/// Accès d'urgence ouvert côté contact : détient l'USK du grantor (jamais exposée au JS).
#[wasm_bindgen]
pub struct EmergencyVault {
    user_key: Zeroizing<[u8; 32]>,
}

#[wasm_bindgen]
impl EmergencyVault {
    /// Lecture : déchiffre un item du coffre du grantor avec son USK récupéré.
    pub fn decrypt_item(&self, encrypted_item_json: &str) -> Result<String, JsError> {
        let enc: EncryptedItem = serde_json::from_str(encrypted_item_json).map_err(js_err)?;
        let item = vault::decrypt_item(&self.user_key, &enc).map_err(js_err)?;
        serde_json::to_string(&item).map_err(js_err)
    }

    /// Takeover : prépare la réinitialisation du mot de passe maître du grantor à partir de son
    /// USK récupéré. Renvoie un JSON `{ master_password_hash, encrypted_user_key }`.
    pub fn takeover(
        &self,
        grantor_email: &str,
        kdf_params_json: &str,
        new_password: &str,
    ) -> Result<String, JsError> {
        let params: KdfParams = serde_json::from_str(kdf_params_json).map_err(js_err)?;
        params.ensure_strong().map_err(js_err)?;
        let reset = keys::takeover_reset(
            &self.user_key,
            grantor_email,
            new_password.as_bytes(),
            params,
        )
        .map_err(js_err)?;
        serde_json::to_string(&reset).map_err(js_err)
    }
}
