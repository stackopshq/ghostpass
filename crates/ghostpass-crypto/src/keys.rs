//! Hiérarchie de clés de compte : assemble KDF + AEAD + partage pour produire
//! l'inscription et le déverrouillage zero-knowledge.
//!
//! - **User Symmetric Key (USK)** : clé aléatoire qui protège réellement le coffre ;
//!   stockée chiffrée par la clé de chiffrement dérivée du mot de passe maître.
//!   ⇒ changer de mot de passe ne re-chiffre que l'USK, pas tout le coffre.
//! - **Paire de clés de partage** : clé privée chiffrée par l'USK ; clé publique en clair.

use crate::encstring::EncString;
use crate::error::{CryptoError, Result};
use crate::kdf::{self, KdfParams};
use crate::rng::random_array;
use crate::util::to_array_32;
use crate::{sharing, symmetric};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use crypto_box::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Clés en clair détenues uniquement en mémoire après déverrouillage (jamais persistées en clair).
pub struct AccountKeys {
    /// User Symmetric Key.
    pub user_key: Zeroizing<[u8; 32]>,
    /// Clé privée de partage.
    pub secret_key: SecretKey,
    /// Clé publique de partage.
    pub public_key: PublicKey,
}

/// Données chiffrées produites à l'inscription, destinées au serveur.
/// Le serveur ne peut rien en déchiffrer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegistrationBlob {
    pub kdf_params: KdfParams,
    /// Hash d'authentification (base64) — le serveur le re-hashe avant stockage.
    pub master_password_hash: String,
    pub encrypted_user_key: EncString,
    pub encrypted_private_key: EncString,
    pub public_key: [u8; 32],
}

/// Crée un nouveau compte : génère l'USK et la paire de clés, et chiffre tout ce qui
/// doit être stocké côté serveur.
pub fn register(
    password: &[u8],
    email: &str,
    params: KdfParams,
) -> Result<(AccountKeys, RegistrationBlob)> {
    let master_key = Zeroizing::new(kdf::derive_master_key(password, email, params)?);
    let encryption_key = Zeroizing::new(kdf::derive_encryption_key(&master_key));
    let auth_hash = Zeroizing::new(kdf::derive_auth_hash(&master_key));

    // USK aléatoire, chiffrée par la clé de chiffrement.
    let user_key = Zeroizing::new(random_array::<32>());
    let encrypted_user_key = symmetric::encrypt(&encryption_key, user_key.as_slice())?;

    // Paire de clés de partage ; clé privée chiffrée par l'USK.
    let keypair = sharing::generate_keypair();
    let secret_bytes = Zeroizing::new(keypair.secret.to_bytes());
    let encrypted_private_key = symmetric::encrypt(&user_key, secret_bytes.as_slice())?;

    let blob = RegistrationBlob {
        kdf_params: params,
        master_password_hash: STANDARD.encode(auth_hash.as_slice()),
        encrypted_user_key,
        encrypted_private_key,
        public_key: *keypair.public.as_bytes(),
    };
    let keys = AccountKeys {
        user_key,
        secret_key: keypair.secret,
        public_key: keypair.public,
    };
    Ok((keys, blob))
}

/// Déverrouille un compte existant à partir du mot de passe maître et des blobs chiffrés.
pub fn unlock(
    password: &[u8],
    email: &str,
    params: KdfParams,
    encrypted_user_key: &EncString,
    encrypted_private_key: &EncString,
) -> Result<AccountKeys> {
    let master_key = Zeroizing::new(kdf::derive_master_key(password, email, params)?);
    let encryption_key = Zeroizing::new(kdf::derive_encryption_key(&master_key));

    let user_key = Zeroizing::new(to_array_32(symmetric::decrypt(
        &encryption_key,
        encrypted_user_key,
    )?)?);
    let secret_bytes = Zeroizing::new(to_array_32(symmetric::decrypt(
        &user_key,
        encrypted_private_key,
    )?)?);

    let secret_key = SecretKey::from(*secret_bytes);
    let public_key = secret_key.public_key();

    Ok(AccountKeys {
        user_key,
        secret_key,
        public_key,
    })
}

/// Recalcule le hash d'authentification (base64) à envoyer au serveur lors d'une connexion.
pub fn master_password_hash(password: &[u8], email: &str, params: KdfParams) -> Result<String> {
    let master_key = Zeroizing::new(kdf::derive_master_key(password, email, params)?);
    let auth_hash = Zeroizing::new(kdf::derive_auth_hash(&master_key));
    Ok(STANDARD.encode(auth_hash.as_slice()))
}

/// Artefacts du kit de récupération. `recovery_key` est à AFFICHER une seule fois à
/// l'utilisateur (à conserver hors-ligne) ; les deux autres champs partent au serveur.
/// La clé de récupération est traitée comme un « second mot de passe maître » : elle dérive
/// une clé de chiffrement (qui enveloppe l'USK) et un hash d'auth (preuve côté serveur).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecoveryArtifacts {
    pub recovery_key: String,
    pub recovery_auth_hash: String,
    pub encrypted_user_key_recovery: EncString,
}

/// Données produites lors d'une réinitialisation via le kit de récupération.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResetBlob {
    pub master_password_hash: String,
    pub recovery_auth_hash: String,
    pub kdf_params: KdfParams,
    pub encrypted_user_key: EncString,
}

/// Enveloppe l'USK avec le secret PRF d'une passkey (déverrouillage passwordless).
/// Le secret PRF (32 o, fourni par l'authentificateur) sert directement de clé d'enveloppe :
/// haute entropie, et le sel PRF assure la séparation par usage.
pub fn wrap_user_key_for_passkey(user_key: &[u8; 32], prf_secret: &[u8; 32]) -> Result<EncString> {
    symmetric::encrypt(prf_secret, user_key)
}

/// Déverrouille un compte sans mot de passe : désenveloppe l'USK avec le secret PRF de la passkey,
/// puis reconstitue la clé privée de partage (chiffrée par l'USK).
pub fn unlock_with_passkey(
    prf_secret: &[u8; 32],
    prf_wrapped_user_key: &EncString,
    encrypted_private_key: &EncString,
) -> Result<AccountKeys> {
    let user_key = Zeroizing::new(to_array_32(symmetric::decrypt(
        prf_secret,
        prf_wrapped_user_key,
    )?)?);
    let secret_bytes = Zeroizing::new(to_array_32(symmetric::decrypt(
        &user_key,
        encrypted_private_key,
    )?)?);
    let secret_key = SecretKey::from(*secret_bytes);
    let public_key = secret_key.public_key();
    Ok(AccountKeys {
        user_key,
        secret_key,
        public_key,
    })
}

/// Données pour réinitialiser le mot de passe maître à partir d'une USK déjà connue (accès
/// d'urgence « takeover »). L'USK ne change pas — seule son enveloppe par le nouveau mot de
/// passe est régénérée, donc `encrypted_private_key` reste valide.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeoverReset {
    pub master_password_hash: String,
    pub encrypted_user_key: EncString,
}

/// Prépare la réinitialisation du mot de passe maître à partir de l'USK récupérée (takeover).
pub fn takeover_reset(
    user_key: &[u8; 32],
    email: &str,
    new_password: &[u8],
    params: KdfParams,
) -> Result<TakeoverReset> {
    let new_master_key = Zeroizing::new(kdf::derive_master_key(new_password, email, params)?);
    let new_enc_key = Zeroizing::new(kdf::derive_encryption_key(&new_master_key));
    let new_auth_hash = Zeroizing::new(kdf::derive_auth_hash(&new_master_key));
    let encrypted_user_key = symmetric::encrypt(&new_enc_key, user_key)?;
    Ok(TakeoverReset {
        master_password_hash: STANDARD.encode(new_auth_hash.as_slice()),
        encrypted_user_key,
    })
}

/// Crée un kit de récupération pour une USK : génère une clé de récupération, l'utilise pour
/// envelopper l'USK et prépare la preuve d'authentification associée.
pub fn create_recovery(user_key: &[u8; 32]) -> Result<RecoveryArtifacts> {
    let recovery_key = Zeroizing::new(random_array::<32>());
    let enc_key = Zeroizing::new(kdf::derive_encryption_key(&recovery_key));
    let auth_hash = Zeroizing::new(kdf::derive_auth_hash(&recovery_key));
    let encrypted_user_key_recovery = symmetric::encrypt(&enc_key, user_key)?;
    Ok(RecoveryArtifacts {
        recovery_key: STANDARD.encode(recovery_key.as_slice()),
        recovery_auth_hash: STANDARD.encode(auth_hash.as_slice()),
        encrypted_user_key_recovery,
    })
}

/// Récupère l'accès via la clé de récupération et réinitialise le mot de passe maître.
/// Renvoie le compte déverrouillé et le blob de réinitialisation à transmettre au serveur.
/// L'USK ne change pas : seule son enveloppe (par le mot de passe) est régénérée, donc
/// `encrypted_private_key` reste valide.
pub fn recover(
    recovery_key_b64: &str,
    email: &str,
    new_password: &[u8],
    params: KdfParams,
    encrypted_user_key_recovery: &EncString,
    encrypted_private_key: &EncString,
) -> Result<(AccountKeys, ResetBlob)> {
    let recovery_key = Zeroizing::new(to_array_32(
        STANDARD
            .decode(recovery_key_b64)
            .map_err(|_| CryptoError::InvalidLength)?,
    )?);
    let rec_enc_key = Zeroizing::new(kdf::derive_encryption_key(&recovery_key));

    let user_key = Zeroizing::new(to_array_32(symmetric::decrypt(
        &rec_enc_key,
        encrypted_user_key_recovery,
    )?)?);
    let secret_bytes = Zeroizing::new(to_array_32(symmetric::decrypt(
        &user_key,
        encrypted_private_key,
    )?)?);
    let secret_key = SecretKey::from(*secret_bytes);
    let public_key = secret_key.public_key();

    let new_master_key = Zeroizing::new(kdf::derive_master_key(new_password, email, params)?);
    let new_enc_key = Zeroizing::new(kdf::derive_encryption_key(&new_master_key));
    let new_auth_hash = Zeroizing::new(kdf::derive_auth_hash(&new_master_key));
    let encrypted_user_key = symmetric::encrypt(&new_enc_key, user_key.as_slice())?;

    let reset = ResetBlob {
        master_password_hash: STANDARD.encode(new_auth_hash.as_slice()),
        recovery_auth_hash: STANDARD
            .encode(Zeroizing::new(kdf::derive_auth_hash(&recovery_key)).as_slice()),
        kdf_params: params,
        encrypted_user_key,
    };
    let keys = AccountKeys {
        user_key,
        secret_key,
        public_key,
    };
    Ok((keys, reset))
}
