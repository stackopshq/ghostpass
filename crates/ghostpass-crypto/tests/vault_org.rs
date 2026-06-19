//! Tests d'intégration : items de coffre (chiffrement par item key) et partage/rotation d'Org Key.

use ghostpass_crypto::{
    org, sharing,
    vault::{self, Card, EncryptedItem, ItemData, Login, SecureNote, VaultItem},
};

fn sample_login() -> VaultItem {
    VaultItem {
        name: "GitHub".into(),
        notes: Some("compte pro".into()),
        folder: Some("Travail/Serveurs".into()),
        data: ItemData::Login(Login {
            username: "kevin".into(),
            password: "s3cr3t!".into(),
            uris: vec!["https://github.com".into()],
            totp: Some("otpauth://...".into()),
            password_history: vec!["old-pw".into()],
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
            folder: None,
            data,
        };
        let enc = vault::encrypt_item(&key, &item).unwrap();
        assert_eq!(item, vault::decrypt_item(&key, &enc).unwrap());
    }
}

#[test]
fn vault_each_item_uses_a_distinct_item_key() {
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

    assert_eq!(enc.encrypted_data, rewrapped.encrypted_data);
    assert_ne!(enc.encrypted_key, rewrapped.encrypted_key);
    assert_eq!(item, vault::decrypt_item(&new_key, &rewrapped).unwrap());
    assert!(vault::decrypt_item(&old_key, &rewrapped).is_err());
}

#[test]
fn authenticated_box_round_trip() {
    // L'admin chiffre vers le membre ; le membre vérifie que ça vient bien de l'admin.
    let admin = sharing::generate_keypair();
    let member = sharing::generate_keypair();
    let sealed = sharing::box_seal(&admin.secret, &member.public, b"org key secrete").unwrap();
    let opened = sharing::box_open(&member.secret, &admin.public, &sealed).unwrap();
    assert_eq!(opened, b"org key secrete");
}

#[test]
fn authenticated_box_rejects_forged_sender() {
    // Ouvrir avec une mauvaise clé publique d'expéditeur doit échouer (authenticité).
    let admin = sharing::generate_keypair();
    let member = sharing::generate_keypair();
    let intruder = sharing::generate_keypair();
    let sealed = sharing::box_seal(&admin.secret, &member.public, b"x").unwrap();
    assert!(sharing::box_open(&member.secret, &intruder.public, &sealed).is_err());
}

#[test]
fn other_member_cannot_open() {
    let admin = sharing::generate_keypair();
    let member = sharing::generate_keypair();
    let intruder = sharing::generate_keypair();
    let sealed = sharing::box_seal(&admin.secret, &member.public, b"org key secrete").unwrap();
    assert!(sharing::box_open(&intruder.secret, &admin.public, &sealed).is_err());
}

#[test]
fn org_key_seal_open_round_trip() {
    let admin = sharing::generate_keypair();
    let member = sharing::generate_keypair();
    let org_key = org::generate_org_key();
    let sealed = org::seal_org_key_for_member(&admin.secret, &member.public, &org_key).unwrap();
    let opened = org::open_org_key(&member.secret, &admin.public, &sealed).unwrap();
    assert_eq!(org_key, opened);
}

#[test]
fn rotation_revokes_access_for_removed_member() {
    let admin = sharing::generate_keypair();
    let alice = sharing::generate_keypair();
    let bob = sharing::generate_keypair();
    let org_key = org::generate_org_key();

    let item = sample_login();
    let shared_item: EncryptedItem = vault::encrypt_item(&org_key, &item).unwrap();

    // On révoque Bob : rotation avec Alice comme seul membre restant, distribuée par l'admin.
    let rotation = org::rotate_org_key(
        &admin.secret,
        &org_key,
        std::slice::from_ref(&alice.public),
        std::slice::from_ref(&shared_item),
    )
    .unwrap();

    // Alice récupère la nouvelle Org Key (vérifiée comme venant de l'admin) et lit l'item.
    let alice_new_key = org::open_org_key(
        &alice.secret,
        &admin.public,
        &rotation.sealed_for_members[0],
    )
    .unwrap();
    let rewrapped = &rotation.rewrapped_items[0];
    assert_eq!(
        item,
        vault::decrypt_item(&alice_new_key, rewrapped).unwrap()
    );

    // L'ancienne Org Key ne déchiffre plus l'item re-enveloppé.
    assert!(vault::decrypt_item(&org_key, rewrapped).is_err());

    // Bob n'a reçu aucune nouvelle clé.
    assert_eq!(rotation.sealed_for_members.len(), 1);
    let _ = bob;
}

#[test]
fn emergency_access_read_and_takeover() {
    use ghostpass_crypto::{keys, KdfParams};
    let params = KdfParams {
        mem_cost_kib: 64 * 1024,
        time_cost: 3,
        parallelism: 1,
    };

    // Le grantor s'inscrit et chiffre un item ; le contact (grantee) s'inscrit aussi.
    let (grantor, gblob) = keys::register(b"grantorpw", "g@x.ch", params).unwrap();
    let item = sample_login();
    let enc = vault::encrypt_item(&grantor.user_key, &item).unwrap();
    let (grantee, _) = keys::register(b"granteepw", "c@x.ch", params).unwrap();

    // Le grantor scelle son USK pour le contact ; le contact l'ouvre (origine vérifiée).
    let sealed = sharing::box_seal(
        &grantor.secret_key,
        &grantee.public_key,
        grantor.user_key.as_slice(),
    )
    .unwrap();
    let recovered: [u8; 32] = sharing::box_open(&grantee.secret_key, &grantor.public_key, &sealed)
        .unwrap()
        .try_into()
        .unwrap();
    assert_eq!(recovered, *grantor.user_key);

    // Lecture : le contact déchiffre l'item du grantor avec l'USK récupéré.
    assert_eq!(vault::decrypt_item(&recovered, &enc).unwrap(), item);

    // Takeover : nouveau mot de passe maître ; le grantor peut rouvrir (clé privée inchangée).
    let reset = keys::takeover_reset(&recovered, "g@x.ch", b"newmasterpw", params).unwrap();
    let reopened = keys::unlock(
        b"newmasterpw",
        "g@x.ch",
        params,
        &reset.encrypted_user_key,
        &gblob.encrypted_private_key,
    )
    .unwrap();
    assert_eq!(*reopened.user_key, *grantor.user_key);
}
