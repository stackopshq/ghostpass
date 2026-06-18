//! Tests d'intégration : items de coffre (chiffrement par item key) et rotation d'Org Key.

use ghostpass_crypto::{
    org,
    vault::{self, Card, EncryptedItem, ItemData, Login, SecureNote, VaultItem},
};

fn sample_login() -> VaultItem {
    VaultItem {
        name: "GitHub".into(),
        notes: Some("compte pro".into()),
        data: ItemData::Login(Login {
            username: "kevin".into(),
            password: "s3cr3t!".into(),
            uris: vec!["https://github.com".into()],
            totp: Some("otpauth://...".into()),
        }),
    }
}

#[test]
fn vault_item_round_trip_login() {
    let wrapping_key = [11u8; 32];
    let item = sample_login();
    let enc = vault::encrypt_item(&wrapping_key, &item).unwrap();
    let dec = vault::decrypt_item(&wrapping_key, &enc).unwrap();
    assert_eq!(item, dec);
}

#[test]
fn vault_item_round_trip_all_kinds() {
    let key = [22u8; 32];
    for data in [
        ItemData::SecureNote(SecureNote {
            content: "code du coffre maison".into(),
        }),
        ItemData::Card(Card {
            cardholder: "Kevin S".into(),
            number: "4111111111111111".into(),
            exp_month: "12".into(),
            exp_year: "2030".into(),
            code: "123".into(),
        }),
    ] {
        let item = VaultItem {
            name: "item".into(),
            notes: None,
            data,
        };
        let enc = vault::encrypt_item(&key, &item).unwrap();
        assert_eq!(item, vault::decrypt_item(&key, &enc).unwrap());
    }
}

#[test]
fn vault_each_item_uses_a_distinct_item_key() {
    // Deux chiffrements du même item avec la même clé d'enveloppe doivent produire des
    // item keys (et donc des ciphertexts) différents.
    let key = [33u8; 32];
    let item = sample_login();
    let a = vault::encrypt_item(&key, &item).unwrap();
    let b = vault::encrypt_item(&key, &item).unwrap();
    assert_ne!(a.encrypted_key, b.encrypted_key);
    assert_ne!(a.encrypted_data, b.encrypted_data);
}

#[test]
fn vault_wrong_wrapping_key_fails() {
    let enc = vault::encrypt_item(&[1u8; 32], &sample_login()).unwrap();
    assert!(vault::decrypt_item(&[2u8; 32], &enc).is_err());
}

#[test]
fn rewrap_item_key_changes_envelope_not_content() {
    let old_key = [4u8; 32];
    let new_key = [5u8; 32];
    let item = sample_login();
    let enc = vault::encrypt_item(&old_key, &item).unwrap();

    let rewrapped = vault::rewrap_item_key(&old_key, &new_key, &enc).unwrap();

    // Le payload chiffré est inchangé (on n'a pas re-chiffré le contenu)...
    assert_eq!(enc.encrypted_data, rewrapped.encrypted_data);
    // ...mais l'enveloppe a changé.
    assert_ne!(enc.encrypted_key, rewrapped.encrypted_key);
    // Déchiffrable avec la nouvelle clé, plus avec l'ancienne.
    assert_eq!(item, vault::decrypt_item(&new_key, &rewrapped).unwrap());
    assert!(vault::decrypt_item(&old_key, &rewrapped).is_err());
}

#[test]
fn org_key_seal_open_round_trip() {
    let member = ghostpass_crypto::sharing::generate_keypair();
    let org_key = org::generate_org_key();
    let sealed = org::seal_org_key_for_member(&member.public, &org_key).unwrap();
    let opened = org::open_org_key(&member.secret, &sealed).unwrap();
    assert_eq!(org_key, opened);
}

#[test]
fn rotation_revokes_access_for_removed_member() {
    use ghostpass_crypto::sharing;

    // Deux membres partagent une organisation et son Org Key.
    let alice = sharing::generate_keypair();
    let bob = sharing::generate_keypair();
    let org_key = org::generate_org_key();

    // Un item partagé est chiffré sous l'Org Key.
    let item = sample_login();
    let shared_item: EncryptedItem = vault::encrypt_item(&org_key, &item).unwrap();

    // On révoque Bob : rotation avec Alice comme seul membre restant.
    let rotation = org::rotate_org_key(
        &org_key,
        std::slice::from_ref(&alice.public),
        std::slice::from_ref(&shared_item),
    )
    .unwrap();

    // Alice récupère la nouvelle Org Key et peut toujours lire l'item.
    let alice_new_key = org::open_org_key(&alice.secret, &rotation.sealed_for_members[0]).unwrap();
    let rewrapped = &rotation.rewrapped_items[0];
    assert_eq!(
        item,
        vault::decrypt_item(&alice_new_key, rewrapped).unwrap()
    );

    // L'ancienne Org Key (que Bob pourrait avoir conservée) ne déchiffre plus l'item re-scellé.
    assert!(vault::decrypt_item(&org_key, rewrapped).is_err());

    // Bob n'a reçu aucune nouvelle clé scellée pour lui.
    assert_eq!(rotation.sealed_for_members.len(), 1);
    let _ = bob; // Bob est exclu de la rotation
}
