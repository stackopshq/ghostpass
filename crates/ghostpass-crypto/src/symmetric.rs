//! Chiffrement symétrique authentifié (AEAD) via XChaCha20-Poly1305.
//! Nonce de 24 octets tiré aléatoirement à chaque chiffrement.

use crate::encstring::EncString;
use crate::error::{CryptoError, Result};
use crate::rng::random_array;
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{Key, KeyInit, XChaCha20Poly1305, XNonce};

pub const NONCE_LEN: usize = 24;

/// Chiffre `plaintext` avec une clé de 32 octets ; renvoie une `EncString` sérialisable.
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<EncString> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce_bytes = random_array::<NONCE_LEN>();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::Encryption)?;
    Ok(EncString::new(nonce_bytes.to_vec(), ciphertext))
}

/// Déchiffre une `EncString` ; échoue si l'authentification (tag Poly1305) est invalide.
pub fn decrypt(key: &[u8; 32], enc: &EncString) -> Result<Vec<u8>> {
    if enc.nonce.len() != NONCE_LEN {
        return Err(CryptoError::Decryption);
    }
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XNonce::from_slice(&enc.nonce);
    cipher
        .decrypt(nonce, enc.ciphertext.as_ref())
        .map_err(|_| CryptoError::Decryption)
}
