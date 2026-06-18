//! Utilitaires internes partagés entre modules.

use crate::error::{CryptoError, Result};

/// Convertit un vecteur d'octets en tableau de 32, en échouant proprement si la taille diffère.
pub(crate) fn to_array_32(v: Vec<u8>) -> Result<[u8; 32]> {
    v.try_into().map_err(|_| CryptoError::InvalidLength)
}
