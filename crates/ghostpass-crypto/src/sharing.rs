//! Partage de secrets par chiffrement à clé publique X25519, **authentifié**.
//!
//! Pour distribuer une clé (p. ex. une Org Key) à un membre, l'admin la chiffre avec SA clé
//! privée vers la clé publique du membre (`crypto_box` / ChaChaBox). Le membre peut alors
//! vérifier que le message provient bien de l'admin : un tiers (ou un serveur actif) qui ne
//! possède pas la clé privée de l'admin ne peut pas forger une Org Key valide.
//! C'est la différence avec une *sealed box* anonyme (cf. audit de sécurité).

use crate::error::{CryptoError, Result};
use crate::rng::OsRng;
use crypto_box::aead::generic_array::GenericArray;
use crypto_box::aead::{Aead, AeadCore};
use crypto_box::{ChaChaBox, PublicKey, SecretKey};

const NONCE_LEN: usize = 24;

/// Paire de clés de partage d'un utilisateur.
pub struct KeyPair {
    pub secret: SecretKey,
    pub public: PublicKey,
}

/// Génère une nouvelle paire de clés X25519.
pub fn generate_keypair() -> KeyPair {
    let secret = SecretKey::generate(&mut OsRng);
    let public = secret.public_key();
    KeyPair { secret, public }
}

/// Chiffre `plaintext` de l'expéditeur (sa clé privée) vers un destinataire (sa clé publique).
/// Renvoie `nonce (24 o) || ciphertext`. Le destinataire pourra vérifier l'origine.
pub fn box_seal(
    sender_secret: &SecretKey,
    recipient_public: &PublicKey,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let b = ChaChaBox::new(recipient_public, sender_secret);
    let nonce = ChaChaBox::generate_nonce(&mut OsRng);
    let ciphertext = b.encrypt(&nonce, plaintext).map_err(|_| CryptoError::Encryption)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Ouvre un message produit par [`box_seal`], en vérifiant qu'il provient de `sender_public`.
pub fn box_open(
    recipient_secret: &SecretKey,
    sender_public: &PublicKey,
    data: &[u8],
) -> Result<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return Err(CryptoError::Decryption);
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let b = ChaChaBox::new(sender_public, recipient_secret);
    let nonce = GenericArray::from_slice(nonce_bytes);
    b.decrypt(nonce, ciphertext).map_err(|_| CryptoError::Decryption)
}
