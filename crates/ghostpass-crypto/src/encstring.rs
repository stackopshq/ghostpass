//! Format sérialisable d'une donnée chiffrée : `2.<nonce_b64>.<ciphertext_b64>`.
//! Le préfixe numérique identifie l'algorithme (`2` = XChaCha20-Poly1305), ce qui
//! laisse la porte ouverte à une migration d'algorithme sans casser l'existant.

use crate::error::{CryptoError, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use core::fmt;
use core::str::FromStr;

const TYPE_XCHACHA20POLY1305: u8 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncString {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

impl EncString {
    pub fn new(nonce: Vec<u8>, ciphertext: Vec<u8>) -> Self {
        Self { nonce, ciphertext }
    }
}

impl fmt::Display for EncString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}.{}.{}",
            TYPE_XCHACHA20POLY1305,
            STANDARD.encode(&self.nonce),
            STANDARD.encode(&self.ciphertext),
        )
    }
}

impl FromStr for EncString {
    type Err = CryptoError;

    fn from_str(s: &str) -> Result<Self> {
        let mut parts = s.split('.');
        let ty: u8 = parts
            .next()
            .and_then(|t| t.parse().ok())
            .ok_or(CryptoError::InvalidEncString)?;
        if ty != TYPE_XCHACHA20POLY1305 {
            return Err(CryptoError::InvalidEncString);
        }
        let nonce_b64 = parts.next().ok_or(CryptoError::InvalidEncString)?;
        let ct_b64 = parts.next().ok_or(CryptoError::InvalidEncString)?;
        if parts.next().is_some() {
            return Err(CryptoError::InvalidEncString);
        }
        let nonce = STANDARD
            .decode(nonce_b64)
            .map_err(|_| CryptoError::InvalidEncString)?;
        let ciphertext = STANDARD
            .decode(ct_b64)
            .map_err(|_| CryptoError::InvalidEncString)?;
        Ok(EncString::new(nonce, ciphertext))
    }
}

// Sérialisation : une `EncString` voyage sous sa forme textuelle compacte.
impl serde::Serialize for EncString {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> serde::Deserialize<'de> for EncString {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> core::result::Result<Self, D::Error> {
        let s = <String as serde::Deserialize>::deserialize(deserializer)?;
        EncString::from_str(&s).map_err(serde::de::Error::custom)
    }
}
