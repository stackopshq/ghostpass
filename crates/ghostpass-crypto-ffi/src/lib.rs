//! Binding UniFFI du cœur crypto, pour les applications mobiles natives (iOS, Android).
//!
//! C'est le pendant exact de `ghostpass-crypto-wasm` : même découpage, mêmes noms, mêmes
//! échanges en JSON. Tout le chiffrement reste **dans le cœur Rust** ; Swift ne manipule
//! qu'un objet `Account` opaque et des données déjà chiffrées. Aucune clé en clair ne
//! traverse la frontière FFI, donc rien de sensible ne peut atterrir dans un log Swift,
//! un crash report ou une capture d'écran de débogueur.
//!
//! Périmètre : cycle de vie du compte, coffre personnel, passkey, coffres partagés et accès
//! d'urgence. Les deux derniers sont transposés du binding WASM sans en changer les noms ni
//! les échanges, pour qu'un coffre partagé écrit depuis le web s'ouvre depuis l'iPhone.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use crypto_box::PublicKey;
use ghostpass_crypto::{
    keys, org, sharing, symmetric, vault, EncString, EncryptedItem, KdfParams, VaultItem,
};
use std::sync::Arc;
use zeroize::Zeroizing;

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

/// Décode une clé publique de partage (X25519, 32 octets) depuis sa représentation base64.
fn decode_public_key(b64: &str) -> Result<PublicKey, GhostpassError> {
    Ok(PublicKey::from(decode_key_32(b64)?))
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

// ─── Partage ponctuel ──────────────────────────────────────────────────────────

/// Un secret scellé pour être partagé une fois : le serveur stocke `ciphertext` et `nonce`,
/// la clé voyage à part — dans le fragment d'une URL, que les navigateurs n'envoient jamais.
/// Le serveur héberge donc quelque chose qu'il ne peut pas lire.
#[derive(uniffi::Record)]
pub struct SealedSend {
    pub ciphertext: String,
    pub nonce: String,
    /// À placer dans le fragment du lien, jamais dans son chemin ni sa requête.
    pub key: String,
}

/// Scelle un secret sous une clé neuve, tirée pour ce seul partage.
#[uniffi::export]
pub fn seal_send(plaintext: String) -> Result<SealedSend, GhostpassError> {
    // `generate_org_key` tire 256 bits du générateur du cœur : c'est la seule fonction
    // publique qui le fasse, son nom vient de son premier usage. Le tirage reste en Rust —
    // Swift n'a pas à produire de matière cryptographique.
    let key = org::generate_org_key();
    let enc = symmetric::encrypt(&key, plaintext.as_bytes()).map_err(err)?;
    Ok(SealedSend {
        ciphertext: STANDARD.encode(&enc.ciphertext),
        nonce: STANDARD.encode(&enc.nonce),
        key: STANDARD.encode(key),
    })
}

/// Ouvre un secret partagé. Rend une erreur si la clé ne correspond pas — il n'y a pas de
/// demi-succès : l'authentification du chiffre l'interdit.
#[uniffi::export]
pub fn open_send(key: String, nonce: String, ciphertext: String) -> Result<String, GhostpassError> {
    let key = decode_key_32(&key)?;
    let enc = EncString::new(
        STANDARD.decode(nonce).map_err(err)?,
        STANDARD.decode(ciphertext).map_err(err)?,
    );
    let clair = symmetric::decrypt(&key, &enc).map_err(err)?;
    String::from_utf8(clair).map_err(|_| GhostpassError::Crypto {
        message: "le secret partagé n'est pas du texte".to_string(),
    })
}

// ─── Partage / organisations ───────────────────────────────────────────────

/// Contexte d'une organisation : détient l'Org Key en mémoire Rust, jamais exposée à Swift.
#[derive(uniffi::Object)]
pub struct Org {
    org_key: Zeroizing<[u8; 32]>,
}

#[uniffi::export]
impl Org {
    /// Chiffre un item (JSON `VaultItem`) sous l'Org Key. Renvoie un JSON `EncryptedItem`.
    pub fn encrypt_item(&self, item_json: String) -> Result<String, GhostpassError> {
        let item: VaultItem = serde_json::from_str(&item_json).map_err(err)?;
        let enc = vault::encrypt_item(&self.org_key, &item).map_err(err)?;
        serde_json::to_string(&enc).map_err(err)
    }

    /// Déchiffre un JSON `EncryptedItem` sous l'Org Key. Renvoie le JSON `VaultItem`.
    pub fn decrypt_item(&self, encrypted_item_json: String) -> Result<String, GhostpassError> {
        let enc: EncryptedItem = serde_json::from_str(&encrypted_item_json).map_err(err)?;
        let item = vault::decrypt_item(&self.org_key, &enc).map_err(err)?;
        serde_json::to_string(&item).map_err(err)
    }

    /// Ré-enveloppe un item d'une ancienne Org Key vers celle-ci (rotation / révocation),
    /// **sans** déchiffrer le contenu.
    pub fn rewrap_item(
        &self,
        old_org: Arc<Org>,
        encrypted_item_json: String,
    ) -> Result<String, GhostpassError> {
        let enc: EncryptedItem = serde_json::from_str(&encrypted_item_json).map_err(err)?;
        let rewrapped =
            vault::rewrap_item_key(&old_org.org_key, &self.org_key, &enc).map_err(err)?;
        serde_json::to_string(&rewrapped).map_err(err)
    }
}

/// Résultat de la création d'une org : le contexte `Org` et l'Org Key scellée pour le créateur,
/// à stocker côté serveur comme entrée du membre-admin.
///
/// Le binding WASM protège son accesseur par un « ne peut être appelé qu'une fois », parce que
/// son `Org` n'est pas clonable. Ici l'objet est derrière un `Arc` : le partager ne duplique pas
/// la clé, qui ne quitte de toute façon jamais le Rust. Le verrou n'aurait rien protégé.
#[derive(uniffi::Object)]
pub struct OrgCreation {
    org: Arc<Org>,
    sealed_for_self: String,
}

#[uniffi::export]
impl OrgCreation {
    /// Org Key scellée pour le créateur (base64), à transmettre au serveur.
    pub fn sealed_for_self(&self) -> String {
        self.sealed_for_self.clone()
    }

    /// Contexte `Org` correspondant.
    pub fn org(&self) -> Arc<Org> {
        Arc::clone(&self.org)
    }
}

/// Coffre d'un donneur ouvert par son contact de confiance, le temps d'un accès d'urgence.
#[derive(uniffi::Object)]
pub struct EmergencyVault {
    user_key: Zeroizing<[u8; 32]>,
}

#[uniffi::export]
impl EmergencyVault {
    /// Lecture : déchiffre un item du coffre du donneur avec son USK récupéré.
    pub fn decrypt_item(&self, encrypted_item_json: String) -> Result<String, GhostpassError> {
        let enc: EncryptedItem = serde_json::from_str(&encrypted_item_json).map_err(err)?;
        let item = vault::decrypt_item(&self.user_key, &enc).map_err(err)?;
        serde_json::to_string(&item).map_err(err)
    }

    /// Reprise : prépare la réinitialisation du mot de passe maître du donneur à partir de son
    /// USK récupéré. Renvoie un JSON `{ master_password_hash, encrypted_user_key }`.
    pub fn takeover(
        &self,
        grantor_email: String,
        kdf_params_json: String,
        new_password: String,
    ) -> Result<String, GhostpassError> {
        let params: KdfParams = serde_json::from_str(&kdf_params_json).map_err(err)?;
        params.ensure_strong().map_err(err)?;
        let reset = keys::takeover_reset(
            &self.user_key,
            &grantor_email,
            new_password.as_bytes(),
            params,
        )
        .map_err(err)?;
        serde_json::to_string(&reset).map_err(err)
    }
}

#[uniffi::export]
impl Account {
    /// Crée une organisation : génère une Org Key et la scelle, de façon authentifiée, pour soi.
    pub fn create_org(&self) -> Result<Arc<OrgCreation>, GhostpassError> {
        let org_key = org::generate_org_key();
        let sealed = sharing::box_seal(&self.keys.secret_key, &self.keys.public_key, &org_key)
            .map_err(err)?;
        Ok(Arc::new(OrgCreation {
            org: Arc::new(Org {
                org_key: Zeroizing::new(org_key),
            }),
            sealed_for_self: STANDARD.encode(sealed),
        }))
    }

    /// Ouvre une Org Key reçue d'un admin, **en vérifiant qu'elle provient de sa clé publique**.
    /// Sans cette vérification, un serveur actif pourrait substituer une Org Key de son choix.
    pub fn open_org(
        &self,
        admin_public_key: String,
        sealed: String,
    ) -> Result<Arc<Org>, GhostpassError> {
        let admin_public = decode_public_key(&admin_public_key)?;
        let sealed_bytes = STANDARD.decode(sealed).map_err(err)?;
        let org_key =
            org::open_org_key(&self.keys.secret_key, &admin_public, &sealed_bytes).map_err(err)?;
        Ok(Arc::new(Org {
            org_key: Zeroizing::new(org_key),
        }))
    }

    /// Scelle l'Org Key pour un membre, en tant qu'admin émetteur. Renvoie le blob base64.
    pub fn seal_org_key_for_member(
        &self,
        org: Arc<Org>,
        member_public_key: String,
    ) -> Result<String, GhostpassError> {
        let member_public = decode_public_key(&member_public_key)?;
        let sealed =
            org::seal_org_key_for_member(&self.keys.secret_key, &member_public, &org.org_key)
                .map_err(err)?;
        Ok(STANDARD.encode(sealed))
    }

    /// Scelle l'USK du compte pour un contact de confiance (accès d'urgence), de façon
    /// authentifiée. Le blob part au serveur et n'est ouvrable qu'avec la clé privée du contact.
    pub fn seal_user_key_for(&self, contact_public_key: String) -> Result<String, GhostpassError> {
        let contact_public = decode_public_key(&contact_public_key)?;
        let sealed = sharing::box_seal(
            &self.keys.secret_key,
            &contact_public,
            self.keys.user_key.as_slice(),
        )
        .map_err(err)?;
        Ok(STANDARD.encode(sealed))
    }

    /// (Contact) Ouvre un accès d'urgence reçu d'un donneur : récupère son USK en mémoire Rust,
    /// en vérifiant que le blob provient bien de la clé publique du donneur.
    pub fn open_emergency(
        &self,
        grantor_public_key: String,
        sealed: String,
    ) -> Result<Arc<EmergencyVault>, GhostpassError> {
        let grantor_public = decode_public_key(&grantor_public_key)?;
        let sealed_bytes = STANDARD.decode(sealed).map_err(err)?;
        let opened = sharing::box_open(&self.keys.secret_key, &grantor_public, &sealed_bytes)
            .map_err(err)?;
        let arr: [u8; 32] = opened.try_into().map_err(|_| GhostpassError::Crypto {
            message: "USK d'urgence invalide".to_string(),
        })?;
        Ok(Arc::new(EmergencyVault {
            user_key: Zeroizing::new(arr),
        }))
    }
}
