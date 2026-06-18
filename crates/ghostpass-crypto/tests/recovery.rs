//! Tests d'intégration : kit de récupération de compte (zero-knowledge, sans backdoor).

use ghostpass_crypto::{keys, KdfParams};

fn fast_params() -> KdfParams {
    KdfParams { mem_cost_kib: 8 * 1024, time_cost: 1, parallelism: 1 }
}

#[test]
fn recovery_restores_vault_and_resets_password() {
    let params = fast_params();
    let (keys_orig, blob) = keys::register(b"ancien-mdp", "kevin@stackops.ch", params).unwrap();

    // Génération du kit de récupération pour l'USK du compte.
    let recovery = keys::create_recovery(&keys_orig.user_key).unwrap();

    // Plus tard : mot de passe oublié → récupération avec la clé + nouveau mot de passe.
    let (keys_rec, reset) = keys::recover(
        &recovery.recovery_key,
        "kevin@stackops.ch",
        b"nouveau-mdp",
        params,
        &recovery.encrypted_user_key_recovery,
        &blob.encrypted_private_key,
    )
    .unwrap();

    // L'USK récupérée est bien la même (le coffre reste lisible).
    assert_eq!(*keys_orig.user_key, *keys_rec.user_key);

    // Le blob de réinitialisation permet ensuite de se connecter avec le NOUVEAU mot de passe...
    let keys_after = keys::unlock(
        b"nouveau-mdp",
        "kevin@stackops.ch",
        reset.kdf_params,
        &reset.encrypted_user_key,
        &blob.encrypted_private_key,
    )
    .unwrap();
    assert_eq!(*keys_orig.user_key, *keys_after.user_key);

    // ...et l'ancien mot de passe ne fonctionne plus avec le nouveau blob.
    assert!(keys::unlock(
        b"ancien-mdp",
        "kevin@stackops.ch",
        reset.kdf_params,
        &reset.encrypted_user_key,
        &blob.encrypted_private_key,
    )
    .is_err());
}

#[test]
fn recovery_with_wrong_key_fails() {
    let params = fast_params();
    let (keys_orig, blob) = keys::register(b"mdp", "a@b.ch", params).unwrap();
    let recovery = keys::create_recovery(&keys_orig.user_key).unwrap();

    // Une clé de récupération erronée (même format) ne doit pas déchiffrer l'USK.
    let bogus = ghostpass_crypto::keys::create_recovery(&[0u8; 32]).unwrap().recovery_key;
    let result = keys::recover(
        &bogus,
        "a@b.ch",
        b"nouveau",
        params,
        &recovery.encrypted_user_key_recovery,
        &blob.encrypted_private_key,
    );
    assert!(result.is_err());
}
