//! Organisations : Org Key, distribution aux membres et rotation (révocation).
//!
//! L'Org Key est une clé symétrique qui protège les item keys d'un coffre partagé.
//! Elle est distribuée à chaque membre **scellée avec sa clé publique** ([`crate::sharing`]).
//! Pour révoquer un membre, on **fait tourner** l'Org Key : nouvelle clé, re-scellée pour
//! les membres restants uniquement, et item keys ré-enveloppées. Le membre révoqué conserve
//! peut-être l'ancienne Org Key, mais elle ne déchiffre plus rien après rotation.

use crate::error::Result;
use crate::rng::random_array;
use crate::util::to_array_32;
use crate::vault::{self, EncryptedItem};
use crate::{sharing, symmetric};
use crypto_box::{PublicKey, SecretKey};

use crate::encstring::EncString;

/// Génère une nouvelle Org Key aléatoire.
pub fn generate_org_key() -> [u8; 32] {
    random_array::<32>()
}

/// Scelle l'Org Key pour un membre (chiffrement vers sa clé publique).
pub fn seal_org_key_for_member(member_public: &PublicKey, org_key: &[u8; 32]) -> Result<Vec<u8>> {
    sharing::seal(member_public, org_key)
}

/// Ouvre l'Org Key scellée avec la clé privée du membre.
pub fn open_org_key(member_secret: &SecretKey, sealed: &[u8]) -> Result<[u8; 32]> {
    to_array_32(sharing::unseal(member_secret, sealed)?)
}

/// Chiffre une clé symétrique (p. ex. une item key) directement avec l'Org Key.
pub fn wrap_with_org_key(org_key: &[u8; 32], key: &[u8; 32]) -> Result<EncString> {
    symmetric::encrypt(org_key, key)
}

/// Résultat d'une rotation d'Org Key (révocation d'un ou plusieurs membres).
pub struct RotationResult {
    /// Nouvelle Org Key (à conserver côté client pendant l'opération).
    pub new_org_key: [u8; 32],
    /// Nouvelle Org Key scellée pour chaque membre **restant**, dans l'ordre fourni.
    pub sealed_for_members: Vec<Vec<u8>>,
    /// Items partagés, item keys ré-enveloppées sous la nouvelle Org Key.
    pub rewrapped_items: Vec<EncryptedItem>,
}

/// Fait tourner l'Org Key : génère une nouvelle clé, la scelle pour les membres restants
/// et ré-enveloppe toutes les item keys partagées. Les contenus ne sont pas re-chiffrés.
pub fn rotate_org_key(
    old_org_key: &[u8; 32],
    remaining_member_publics: &[PublicKey],
    shared_items: &[EncryptedItem],
) -> Result<RotationResult> {
    let new_org_key = generate_org_key();

    let mut sealed_for_members = Vec::with_capacity(remaining_member_publics.len());
    for member_public in remaining_member_publics {
        sealed_for_members.push(seal_org_key_for_member(member_public, &new_org_key)?);
    }

    let mut rewrapped_items = Vec::with_capacity(shared_items.len());
    for item in shared_items {
        rewrapped_items.push(vault::rewrap_item_key(old_org_key, &new_org_key, item)?);
    }

    Ok(RotationResult {
        new_org_key,
        sealed_for_members,
        rewrapped_items,
    })
}
