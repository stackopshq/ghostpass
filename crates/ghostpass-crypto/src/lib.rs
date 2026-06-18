//! Cœur cryptographique de GhostPass.
//!
//! Conçu pour être compilé en natif (clients desktop/mobile via FFI) et en WASM
//! (web + extension navigateur). Aucune logique réseau ici : uniquement des
//! primitives et la hiérarchie de clés du modèle zero-knowledge.
//!
//! Principe : le serveur ne stocke que des données chiffrées qu'il ne peut pas lire.
//! Tout le chiffrement/déchiffrement a lieu sur le client.

mod rng;
mod util;

pub mod encstring;
pub mod error;
pub mod kdf;
pub mod keys;
pub mod org;
pub mod sharing;
pub mod symmetric;
pub mod vault;

pub use encstring::EncString;
pub use error::{CryptoError, Result};
pub use kdf::KdfParams;
pub use keys::{
    create_recovery, master_password_hash, recover, register, unlock, AccountKeys,
    RecoveryArtifacts, RegistrationBlob, ResetBlob,
};
pub use vault::{Card, EncryptedItem, ItemData, Login, SecureNote, VaultItem};
