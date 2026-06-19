//! Dérivation de clés du modèle zero-knowledge.
//!
//! ```text
//! Master Password + email ─Argon2id─► Master Key (32 o)
//!                                          │
//!                       ┌──────────────────┴───────────────────┐
//!                  HKDF-Expand                            HKDF-Expand
//!                  (info "enc")                           (info "auth")
//!                       │                                       │
//!                 Encryption Key                       Master Password Hash
//!            (protège l'USK, reste client)        (envoyé au serveur pour l'auth)
//! ```
//!
//! La séparation de domaine par `info` garantit que le hash d'auth (connu du serveur)
//! ne permet pas de remonter à la clé de chiffrement : HKDF-Expand est à sens unique.

use crate::error::{CryptoError, Result};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const KEY_LEN: usize = 32;

const INFO_ENC: &[u8] = b"stackops:user-encryption-key:v1";
const INFO_AUTH: &[u8] = b"stackops:master-password-auth:v1";

/// Paramètres Argon2id, stockés par utilisateur pour pouvoir être durcis dans le temps.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    /// Coût mémoire en Kio.
    pub mem_cost_kib: u32,
    /// Nombre d'itérations.
    pub time_cost: u32,
    /// Degré de parallélisme.
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // Cible raisonnable côté client (64 Mio, 3 passes), alignée sur les recommandations OWASP.
        Self {
            mem_cost_kib: 64 * 1024,
            time_cost: 3,
            parallelism: 4,
        }
    }
}

/// Planchers de sécurité des paramètres KDF.
pub const MIN_MEM_COST_KIB: u32 = 64 * 1024;
pub const MIN_TIME_COST: u32 = 3;

impl KdfParams {
    /// Rejette des paramètres affaiblis. À appeler côté client sur tout `KdfParams` reçu du
    /// serveur AVANT dérivation, pour empêcher une attaque de downgrade de KDF : un serveur
    /// malveillant ne doit pas pouvoir imposer un coût trivial qui rendrait le hash d'auth
    /// bruteforçable hors-ligne.
    pub fn ensure_strong(&self) -> Result<()> {
        if self.mem_cost_kib < MIN_MEM_COST_KIB
            || self.time_cost < MIN_TIME_COST
            || self.parallelism < 1
        {
            return Err(CryptoError::WeakKdfParams);
        }
        Ok(())
    }
}

/// Dérive un salt déterministe de 16 octets à partir de l'email normalisé.
/// Déterministe ⇒ pas besoin de stocker un salt côté serveur avant la connexion.
fn email_salt(email: &str) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(b"stackops-pwm-salt:v1");
    hasher.update(email.trim().to_lowercase().as_bytes());
    let digest = hasher.finalize();
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&digest[..16]);
    salt
}

/// Dérive la Master Key (jamais transmise) depuis le mot de passe maître et l'email.
///
/// L'anti-downgrade est appliqué ICI (chokepoint unique) : tout chemin — register, unlock,
/// master_password_hash, recover, et tous les bindings (WASM, futur FFI natif) — refuse des
/// paramètres KDF affaiblis qu'un serveur malveillant tenterait d'imposer.
pub fn derive_master_key(password: &[u8], email: &str, params: KdfParams) -> Result<[u8; KEY_LEN]> {
    params.ensure_strong()?;
    let salt = email_salt(email);
    let argon = argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(
            params.mem_cost_kib,
            params.time_cost,
            params.parallelism,
            Some(KEY_LEN),
        )
        .map_err(|_| CryptoError::KeyDerivation)?,
    );
    let mut master_key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password, &salt, &mut master_key)
        .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(master_key)
}

fn expand(prk: &[u8; KEY_LEN], info: &[u8]) -> [u8; KEY_LEN] {
    let hk = Hkdf::<Sha256>::from_prk(prk).expect("PRK de 32 octets : longueur valide");
    let mut okm = [0u8; KEY_LEN];
    hk.expand(info, &mut okm)
        .expect("OKM de 32 octets : longueur valide");
    okm
}

/// Clé de chiffrement (protège l'User Symmetric Key). Reste sur le client.
pub fn derive_encryption_key(master_key: &[u8; KEY_LEN]) -> [u8; KEY_LEN] {
    expand(master_key, INFO_ENC)
}

/// Hash d'authentification envoyé au serveur (qui le re-hashe à son tour).
pub fn derive_auth_hash(master_key: &[u8; KEY_LEN]) -> [u8; KEY_LEN] {
    expand(master_key, INFO_AUTH)
}
