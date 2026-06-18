//! Items de coffre et leur chiffrement, sur le modèle « item key ».
//!
//! Chaque item possède une **item key** symétrique aléatoire :
//! - le contenu (JSON) est chiffré par l'item key ;
//! - l'item key est chiffrée par une **clé d'enveloppe** (l'USK pour un coffre perso,
//!   ou l'Org Key pour un coffre partagé).
//!
//! Conséquence : partager ou faire tourner la clé parente ne touche qu'à l'item key
//! (petite), jamais au payload (potentiellement gros). Voir [`rewrap_item_key`].

use crate::encstring::EncString;
use crate::error::{CryptoError, Result};
use crate::rng::random_array;
use crate::symmetric;
use crate::util::to_array_32;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Contenu typé d'un item de coffre.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", content = "data")]
pub enum ItemData {
    Login(Login),
    SecureNote(SecureNote),
    Card(Card),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Login {
    pub username: String,
    pub password: String,
    pub uris: Vec<String>,
    pub totp: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct SecureNote {
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct Card {
    pub cardholder: String,
    pub number: String,
    pub exp_month: String,
    pub exp_year: String,
    pub code: String,
}

/// Un item de coffre en clair (nom + notes communs + contenu typé).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct VaultItem {
    pub name: String,
    pub notes: Option<String>,
    /// Chemin de classement, ex. `"Travail/Serveurs"` (chiffré comme le reste).
    /// `#[serde(default)]` : les items chiffrés avant l'ajout du champ se déchiffrent à `None`.
    #[serde(default)]
    pub folder: Option<String>,
    pub data: ItemData,
}

/// Représentation chiffrée d'un item, telle que stockée côté serveur.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncryptedItem {
    /// Item key, chiffrée par la clé d'enveloppe (USK ou Org Key).
    pub encrypted_key: EncString,
    /// Contenu de l'item (JSON), chiffré par l'item key.
    pub encrypted_data: EncString,
}

/// Chiffre un item : génère une item key fraîche, chiffre le contenu, puis enveloppe l'item key.
pub fn encrypt_item(wrapping_key: &[u8; 32], item: &VaultItem) -> Result<EncryptedItem> {
    let item_key = Zeroizing::new(random_array::<32>());
    let payload = Zeroizing::new(serde_json::to_vec(item).map_err(|_| CryptoError::Encryption)?);
    let encrypted_data = symmetric::encrypt(&item_key, &payload)?;
    let encrypted_key = symmetric::encrypt(wrapping_key, item_key.as_slice())?;
    Ok(EncryptedItem {
        encrypted_key,
        encrypted_data,
    })
}

/// Déchiffre un item : ouvre l'item key avec la clé d'enveloppe, puis le contenu.
pub fn decrypt_item(wrapping_key: &[u8; 32], enc: &EncryptedItem) -> Result<VaultItem> {
    let item_key = Zeroizing::new(to_array_32(symmetric::decrypt(wrapping_key, &enc.encrypted_key)?)?);
    let payload = Zeroizing::new(symmetric::decrypt(&item_key, &enc.encrypted_data)?);
    serde_json::from_slice(&payload).map_err(|_| CryptoError::Decryption)
}

/// Ré-enveloppe l'item key d'une clé d'enveloppe vers une autre, **sans** déchiffrer le contenu.
/// Brique de base de la rotation d'Org Key (révocation).
pub fn rewrap_item_key(
    old_wrapping_key: &[u8; 32],
    new_wrapping_key: &[u8; 32],
    enc: &EncryptedItem,
) -> Result<EncryptedItem> {
    let item_key =
        Zeroizing::new(to_array_32(symmetric::decrypt(old_wrapping_key, &enc.encrypted_key)?)?);
    let encrypted_key = symmetric::encrypt(new_wrapping_key, item_key.as_slice())?;
    Ok(EncryptedItem {
        encrypted_key,
        encrypted_data: enc.encrypted_data.clone(),
    })
}
