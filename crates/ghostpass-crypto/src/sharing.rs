//! Partage de secrets via chiffrement à clé publique (X25519, sealed box).
//!
//! Pour partager une clé (p. ex. une Org Key) avec un membre, on la « scelle » avec
//! sa clé publique : seul le détenteur de la clé privée correspondante peut l'ouvrir.
//! Le serveur ne voit que du chiffré.

use crate::error::{CryptoError, Result};
use crate::rng::OsRng;
use crypto_box::{PublicKey, SecretKey};

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

/// Scelle `plaintext` pour une clé publique destinataire (anonyme, sans clé d'expéditeur).
pub fn seal(recipient: &PublicKey, plaintext: &[u8]) -> Result<Vec<u8>> {
    recipient
        .seal(&mut OsRng, plaintext)
        .map_err(|_| CryptoError::Encryption)
}

/// Ouvre un message scellé avec la clé privée du destinataire.
pub fn unseal(recipient_secret: &SecretKey, sealed: &[u8]) -> Result<Vec<u8>> {
    recipient_secret
        .unseal(sealed)
        .map_err(|_| CryptoError::Decryption)
}
