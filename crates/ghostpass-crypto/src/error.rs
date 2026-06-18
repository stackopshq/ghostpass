//! Types d'erreur du cœur crypto. Volontairement opaques : on ne révèle jamais
//! *pourquoi* un déchiffrement échoue (pas d'oracle de padding/auth).

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CryptoError {
    #[error("échec de la dérivation de clé")]
    KeyDerivation,
    #[error("échec du chiffrement")]
    Encryption,
    #[error("échec du déchiffrement (données corrompues ou mauvaise clé)")]
    Decryption,
    #[error("format de chaîne chiffrée invalide")]
    InvalidEncString,
    #[error("longueur invalide")]
    InvalidLength,
}

pub type Result<T> = core::result::Result<T, CryptoError>;
