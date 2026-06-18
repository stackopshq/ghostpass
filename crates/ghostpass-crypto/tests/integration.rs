//! Tests d'intégration du cœur crypto : ils valident le comportement de bout en bout
//! du modèle zero-knowledge (inscription, déverrouillage, partage, détection d'altération).

use std::str::FromStr;

use ghostpass_crypto::{
    encstring::EncString,
    kdf::{self, KdfParams},
    keys, symmetric,
};

/// Paramètres KDF minimaux *valides* (= planchers `ensure_strong`) pour des tests rapides.
/// `derive_master_key` rejette désormais tout paramètre sous les planchers (anti-downgrade).
fn fast_params() -> KdfParams {
    KdfParams {
        mem_cost_kib: 64 * 1024,
        time_cost: 3,
        parallelism: 1,
    }
}

#[test]
fn symmetric_round_trip() {
    let key = [7u8; 32];
    let message = b"mot de passe secret du coffre";
    let enc = symmetric::encrypt(&key, message).unwrap();
    let dec = symmetric::decrypt(&key, &enc).unwrap();
    assert_eq!(dec, message);
}

#[test]
fn symmetric_wrong_key_fails() {
    let enc = symmetric::encrypt(&[1u8; 32], b"secret").unwrap();
    assert!(symmetric::decrypt(&[2u8; 32], &enc).is_err());
}

#[test]
fn symmetric_tamper_is_detected() {
    let key = [9u8; 32];
    let mut enc = symmetric::encrypt(&key, b"donnees integres").unwrap();
    // On retourne un bit du ciphertext : l'AEAD doit refuser de déchiffrer.
    enc.ciphertext[0] ^= 0x01;
    assert!(symmetric::decrypt(&key, &enc).is_err());
}

#[test]
fn encstring_serialization_round_trip() {
    let enc = symmetric::encrypt(&[3u8; 32], b"abc").unwrap();
    let serialized = enc.to_string();
    assert!(serialized.starts_with("2."));
    let parsed = EncString::from_str(&serialized).unwrap();
    assert_eq!(enc, parsed);
}

#[test]
fn encstring_rejects_garbage() {
    assert!(EncString::from_str("pas valide").is_err());
    assert!(EncString::from_str("9.AAAA.AAAA").is_err()); // mauvais type d'algo
}

#[test]
fn master_key_is_deterministic() {
    let p = fast_params();
    let k1 = kdf::derive_master_key(b"motdepasse", "Kevin@Stackops.CH", p).unwrap();
    let k2 = kdf::derive_master_key(b"motdepasse", "kevin@stackops.ch ", p).unwrap();
    // L'email est normalisé (casse + espaces) ⇒ même clé.
    assert_eq!(k1, k2);

    let k3 = kdf::derive_master_key(b"autre", "kevin@stackops.ch", p).unwrap();
    assert_ne!(k1, k3);
}

#[test]
fn kdf_params_rejects_downgrade() {
    // Les paramètres par défaut sont acceptés ; des paramètres affaiblis (potentiel downgrade
    // imposé par un serveur malveillant) sont refusés côté client.
    assert!(KdfParams::default().ensure_strong().is_ok());
    let weak = KdfParams { mem_cost_kib: 8 * 1024, time_cost: 1, parallelism: 1 };
    assert!(weak.ensure_strong().is_err());
}

#[test]
fn enc_and_auth_keys_differ() {
    let mk = kdf::derive_master_key(b"pw", "a@b.ch", fast_params()).unwrap();
    let enc = kdf::derive_encryption_key(&mk);
    let auth = kdf::derive_auth_hash(&mk);
    // Séparation de domaine : les deux sous-clés doivent être indépendantes.
    assert_ne!(enc, auth);
}

#[test]
fn register_then_unlock_recovers_same_keys() {
    let params = fast_params();
    let (keys_at_register, blob) = keys::register(b"hunter2", "kevin@stackops.ch", params).unwrap();

    let keys_at_unlock = keys::unlock(
        b"hunter2",
        "kevin@stackops.ch",
        params,
        &blob.encrypted_user_key,
        &blob.encrypted_private_key,
    )
    .unwrap();

    // L'USK et la clé publique récupérées doivent être identiques à l'inscription.
    assert_eq!(*keys_at_register.user_key, *keys_at_unlock.user_key);
    assert_eq!(
        keys_at_register.public_key.as_bytes(),
        keys_at_unlock.public_key.as_bytes()
    );
}

#[test]
fn unlock_with_wrong_password_fails() {
    let params = fast_params();
    let (_, blob) = keys::register(b"bonmotdepasse", "kevin@stackops.ch", params).unwrap();

    let result = keys::unlock(
        b"mauvaismotdepasse",
        "kevin@stackops.ch",
        params,
        &blob.encrypted_user_key,
        &blob.encrypted_private_key,
    );
    assert!(result.is_err());
}

#[test]
fn auth_hash_is_stable_and_password_dependent() {
    let params = fast_params();
    let h1 = keys::master_password_hash(b"pw", "kevin@stackops.ch", params).unwrap();
    let h2 = keys::master_password_hash(b"pw", "kevin@stackops.ch", params).unwrap();
    let h3 = keys::master_password_hash(b"PW", "kevin@stackops.ch", params).unwrap();
    assert_eq!(h1, h2);
    assert_ne!(h1, h3);
}
// (Les tests de partage/box authentifiée sont dans tests/vault_org.rs.)
