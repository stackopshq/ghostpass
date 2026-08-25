//! Ces tests exercent la façade FFI exactement comme l'application iOS l'appellera :
//! par les mêmes fonctions publiques, avec les mêmes chaînes JSON. Ils tournent sur
//! n'importe quelle machine, donc le cœur mobile reste prouvable sans Mac.

use ghostpass_crypto_ffi::{default_kdf_params, master_password_hash, recover, register, Account};
use serde_json::Value;

const EMAIL: &str = "clara@stackops.ch";
const PASSWORD: &str = "correct horse battery staple";

fn item_json() -> String {
    serde_json::json!({
        "name": "Serveur de test",
        "notes": "note privée",
        "folder": "Travail/Serveurs",
        "data": {
            "kind": "Login",
            "data": {
                "username": "clara",
                "password": "s3cr3t",
                "uris": ["https://exemple.test"],
                "totp": null,
                "password_history": []
            }
        }
    })
    .to_string()
}

/// Le blob d'inscription, tel que le serveur le renverra à la connexion suivante.
fn blob_fields(blob: &str) -> (String, String, String) {
    let v: Value = serde_json::from_str(blob).unwrap();
    (
        v["kdf_params"].to_string(),
        v["encrypted_user_key"].as_str().unwrap().to_string(),
        v["encrypted_private_key"].as_str().unwrap().to_string(),
    )
}

#[test]
fn inscription_puis_deverrouillage_rouvre_le_meme_coffre() {
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let enc = reg.account().encrypt_item(item_json()).unwrap();

    let (kdf, euk, epk) = blob_fields(&reg.blob());
    let account = Account::unlock(PASSWORD.into(), EMAIL.into(), kdf, euk, epk).unwrap();

    let clair: Value = serde_json::from_str(&account.decrypt_item(enc).unwrap()).unwrap();
    assert_eq!(clair["name"], "Serveur de test");
    assert_eq!(clair["data"]["data"]["password"], "s3cr3t");
    assert_eq!(clair["folder"], "Travail/Serveurs");
    assert_eq!(account.public_key(), reg.account().public_key());
}

#[test]
fn le_hash_envoye_au_serveur_est_celui_de_l_inscription() {
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let v: Value = serde_json::from_str(&reg.blob()).unwrap();
    let attendu = v["master_password_hash"].as_str().unwrap();

    let calcule =
        master_password_hash(PASSWORD.into(), EMAIL.into(), v["kdf_params"].to_string()).unwrap();
    assert_eq!(calcule, attendu, "le login serait refusé par le serveur");
}

#[test]
fn un_mauvais_mot_de_passe_ne_deverrouille_pas() {
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let (kdf, euk, epk) = blob_fields(&reg.blob());
    assert!(Account::unlock("mauvais".into(), EMAIL.into(), kdf, euk, epk).is_err());
}

#[test]
fn les_parametres_kdf_par_defaut_sont_acceptes_comme_forts() {
    let params = default_kdf_params().unwrap();
    let v: Value = serde_json::from_str(&params).unwrap();
    assert!(v["mem_cost_kib"].as_u64().unwrap() >= 64 * 1024);
    // `unlock` refuse des paramètres faibles : s'il va jusqu'à l'erreur de déchiffrement,
    // c'est que le contrôle de robustesse a laissé passer les paramètres par défaut.
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let (_, euk, epk) = blob_fields(&reg.blob());
    assert!(Account::unlock(PASSWORD.into(), EMAIL.into(), params, euk, epk).is_ok());
}

#[test]
fn la_passkey_rouvre_le_coffre_sans_mot_de_passe() {
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let account = reg.account();
    let enc = account.encrypt_item(item_json()).unwrap();

    // Le secret PRF vient de WebAuthn côté iOS ; ici on en simule un.
    let prf = base64_secret();
    let wrapped = account.wrap_user_key_for_passkey(prf.clone()).unwrap();
    let (_, _, epk) = blob_fields(&reg.blob());

    let sans_mdp = Account::with_passkey(prf, wrapped, epk).unwrap();
    let clair: Value = serde_json::from_str(&sans_mdp.decrypt_item(enc).unwrap()).unwrap();
    assert_eq!(clair["data"]["data"]["username"], "clara");
}

#[test]
fn la_cle_de_recuperation_rouvre_le_coffre_et_change_le_mot_de_passe() {
    let reg = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let enc = reg.account().encrypt_item(item_json()).unwrap();
    let kit: Value = serde_json::from_str(&reg.account().create_recovery().unwrap()).unwrap();

    let (kdf, _, epk) = blob_fields(&reg.blob());
    let res = recover(
        kit["recovery_key"].as_str().unwrap().into(),
        EMAIL.into(),
        "nouveau mot de passe maître".into(),
        kdf,
        kit["encrypted_user_key_recovery"].as_str().unwrap().into(),
        epk,
    )
    .unwrap();

    let clair: Value = serde_json::from_str(&res.account().decrypt_item(enc).unwrap()).unwrap();
    assert_eq!(clair["name"], "Serveur de test");
    assert!(!res.reset().is_empty());
}

/// 32 octets déterministes en base64, pour tenir lieu de secret PRF dans les tests.
fn base64_secret() -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode([7u8; 32])
}
