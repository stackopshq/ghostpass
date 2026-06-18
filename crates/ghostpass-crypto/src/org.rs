//! Organisations : Org Key, distribution **authentifiée** aux membres et rotation (révocation).
//!
//! L'Org Key protège les item keys d'un coffre partagé. Elle est distribuée à chaque membre
//! via une box authentifiée admin→membre ([`crate::sharing::box_seal`]) : le membre vérifie
//! qu'elle provient bien de l'admin (un serveur actif ne peut pas la substituer).
//!
//! Révoquer un membre = rotation : nouvelle Org Key (re-distribuée aux membres restants) et
//! item keys ré-enveloppées. ⚠️ La rotation empêche le membre révoqué de déchiffrer les
//! *nouvelles* enveloppes, mais ne re-protège PAS les secrets qu'il a déjà pu voir : ceux-ci
//! doivent être changés (rotation des mots de passe) côté utilisateur.

use crate::encstring::EncString;
use crate::error::Result;
use crate::rng::random_array;
use crate::util::to_array_32;
use crate::vault::{self, EncryptedItem};
use crate::{sharing, symmetric};
use crypto_box::{PublicKey, SecretKey};

/// Génère une nouvelle Org Key aléatoire.
pub fn generate_org_key() -> [u8; 32] {
    random_array::<32>()
}

/// Distribue l'Org Key à un membre : chiffrée par l'admin (sa clé privée) vers la clé publique
/// du membre, de façon authentifiée.
pub fn seal_org_key_for_member(
    admin_secret: &SecretKey,
    member_public: &PublicKey,
    org_key: &[u8; 32],
) -> Result<Vec<u8>> {
    sharing::box_seal(admin_secret, member_public, org_key)
}

/// Ouvre l'Org Key reçue, en vérifiant qu'elle provient bien de l'admin (`admin_public`).
pub fn open_org_key(
    member_secret: &SecretKey,
    admin_public: &PublicKey,
    sealed: &[u8],
) -> Result<[u8; 32]> {
    to_array_32(sharing::box_open(member_secret, admin_public, sealed)?)
}

/// Chiffre une clé symétrique (p. ex. une item key) directement avec l'Org Key.
pub fn wrap_with_org_key(org_key: &[u8; 32], key: &[u8; 32]) -> Result<EncString> {
    symmetric::encrypt(org_key, key)
}

/// Résultat d'une rotation d'Org Key (révocation d'un ou plusieurs membres).
pub struct RotationResult {
    /// Nouvelle Org Key (à conserver côté client pendant l'opération).
    pub new_org_key: [u8; 32],
    /// Nouvelle Org Key distribuée à chaque membre **restant**, dans l'ordre fourni.
    pub sealed_for_members: Vec<Vec<u8>>,
    /// Items partagés, item keys ré-enveloppées sous la nouvelle Org Key.
    pub rewrapped_items: Vec<EncryptedItem>,
}

/// Fait tourner l'Org Key : nouvelle clé distribuée (authentifiée) par l'admin aux membres
/// restants, et item keys ré-enveloppées. Les contenus ne sont pas re-chiffrés.
pub fn rotate_org_key(
    admin_secret: &SecretKey,
    old_org_key: &[u8; 32],
    remaining_member_publics: &[PublicKey],
    shared_items: &[EncryptedItem],
) -> Result<RotationResult> {
    let new_org_key = generate_org_key();

    let mut sealed_for_members = Vec::with_capacity(remaining_member_publics.len());
    for member_public in remaining_member_publics {
        sealed_for_members.push(seal_org_key_for_member(admin_secret, member_public, &new_org_key)?);
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
