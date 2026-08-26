//! Ces tests exercent la façade FFI exactement comme l'application iOS l'appellera :
//! par les mêmes fonctions publiques, avec les mêmes chaînes JSON. Ils tournent sur
//! n'importe quelle machine, donc le cœur mobile reste prouvable sans Mac.

use ghostpass_crypto_ffi::{default_kdf_params, master_password_hash, recover, register, Account};
use serde_json::Value;

const EMAIL: &str = "clara@stackops.ch";
const PASSWORD: &str = "correct horse battery staple";
const NOUVEAU: &str = "un tout autre mot de passe, bien assez long";

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

// ─── Coffres partagés ───

/// Deux comptes distincts, comme deux membres d'une équipe.
fn deux_comptes() -> (std::sync::Arc<Account>, std::sync::Arc<Account>) {
    let admin = register(PASSWORD.into(), EMAIL.into()).unwrap().account();
    let membre = register(
        "un autre mot de passe long".into(),
        "kevin@stackops.ch".into(),
    )
    .unwrap()
    .account();
    (admin, membre)
}

#[test]
fn un_membre_ouvre_le_coffre_partage_que_l_admin_lui_a_scelle() {
    let (admin, membre) = deux_comptes();

    let creation = admin.create_org().unwrap();
    let chiffre = creation.org().encrypt_item(item_json()).unwrap();

    let scelle = admin
        .seal_org_key_for_member(creation.org(), membre.public_key())
        .unwrap();
    let org_du_membre = membre.open_org(admin.public_key(), scelle).unwrap();

    let clair: Value = serde_json::from_str(&org_du_membre.decrypt_item(chiffre).unwrap()).unwrap();
    assert_eq!(clair["data"]["data"]["password"], "s3cr3t");
}

#[test]
fn l_admin_retrouve_son_propre_coffre_par_le_sceau_qu_il_s_est_adresse() {
    let admin = register(PASSWORD.into(), EMAIL.into()).unwrap().account();
    let creation = admin.create_org().unwrap();
    let chiffre = creation.org().encrypt_item(item_json()).unwrap();

    // Le serveur ne stocke que `sealed_for_self` : au prochain déverrouillage, c'est par lui
    // que l'admin retrouve l'Org Key, exactement comme un membre ordinaire.
    let org = admin
        .open_org(admin.public_key(), creation.sealed_for_self())
        .unwrap();
    assert!(org.decrypt_item(chiffre).is_ok());
}

#[test]
fn un_sceau_forge_par_un_tiers_est_refuse() {
    let (admin, membre) = deux_comptes();
    let intrus = register(
        "encore un mot de passe long".into(),
        "intrus@ailleurs.test".into(),
    )
    .unwrap()
    .account();

    // L'intrus scelle SA propre Org Key vers le membre : techniquement valide, mais elle ne
    // vient pas de l'admin. C'est ce qu'un serveur actif tenterait pour lire le coffre.
    let creation = intrus.create_org().unwrap();
    let contrefacon = intrus
        .seal_org_key_for_member(creation.org(), membre.public_key())
        .unwrap();

    assert!(membre.open_org(admin.public_key(), contrefacon).is_err());
}

#[test]
fn apres_rotation_l_ancienne_org_key_ne_lit_plus_les_items_reenveloppes() {
    let admin = register(PASSWORD.into(), EMAIL.into()).unwrap().account();
    let ancienne = admin.create_org().unwrap().org();
    let chiffre = ancienne.encrypt_item(item_json()).unwrap();

    let nouvelle = admin.create_org().unwrap().org();
    let reenveloppe = nouvelle
        .rewrap_item(ancienne.clone(), chiffre.clone())
        .unwrap();

    // La nouvelle clé lit l'item ré-enveloppé, l'ancienne non : c'est la révocation.
    assert!(nouvelle.decrypt_item(reenveloppe.clone()).is_ok());
    assert!(ancienne.decrypt_item(reenveloppe).is_err());
    // Le contenu n'a pas été re-chiffré, seule l'enveloppe de la clé a changé.
    let a: Value = serde_json::from_str(&chiffre).unwrap();
    let b: Value = serde_json::from_str(&nouvelle.rewrap_item(ancienne, chiffre).unwrap()).unwrap();
    assert_eq!(a["encrypted_data"], b["encrypted_data"]);
}

// ─── Accès d'urgence ───

#[test]
fn le_contact_de_confiance_lit_le_coffre_du_donneur() {
    let (donneur, contact) = deux_comptes();
    let chiffre = donneur.encrypt_item(item_json()).unwrap();

    let scelle = donneur.seal_user_key_for(contact.public_key()).unwrap();
    let coffre = contact
        .open_emergency(donneur.public_key(), scelle)
        .unwrap();

    let clair: Value = serde_json::from_str(&coffre.decrypt_item(chiffre).unwrap()).unwrap();
    assert_eq!(clair["name"], "Serveur de test");
}

#[test]
fn un_acces_d_urgence_adresse_a_quelqu_un_d_autre_ne_s_ouvre_pas() {
    let (donneur, contact) = deux_comptes();
    let tiers = register(
        "un mot de passe bien assez long".into(),
        "tiers@ailleurs.test".into(),
    )
    .unwrap()
    .account();

    let scelle = donneur.seal_user_key_for(contact.public_key()).unwrap();
    assert!(tiers.open_emergency(donneur.public_key(), scelle).is_err());
}

#[test]
fn la_reprise_ouvre_le_coffre_du_donneur_avec_un_nouveau_mot_de_passe() {
    // On garde le blob d'inscription du donneur : la reprise ne ré-enveloppe que l'USK, la
    // clé privée de partage reste celle d'origine et doit venir du même compte.
    let inscription = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let donneur = inscription.account();
    let (kdf, _, epk) = blob_fields(&inscription.blob());
    let chiffre = donneur.encrypt_item(item_json()).unwrap();

    let contact = register(
        "un autre mot de passe long".into(),
        "kevin@stackops.ch".into(),
    )
    .unwrap()
    .account();
    let scelle = donneur.seal_user_key_for(contact.public_key()).unwrap();
    let coffre = contact
        .open_emergency(donneur.public_key(), scelle)
        .unwrap();

    let reset: Value = serde_json::from_str(
        &coffre
            .takeover(EMAIL.into(), kdf.clone(), NOUVEAU.into())
            .unwrap(),
    )
    .unwrap();
    let euk = reset["encrypted_user_key"].as_str().unwrap().to_string();

    let repris = Account::unlock(NOUVEAU.into(), EMAIL.into(), kdf, euk, epk).unwrap();
    let clair: Value = serde_json::from_str(&repris.decrypt_item(chiffre).unwrap()).unwrap();
    assert_eq!(clair["data"]["data"]["password"], "s3cr3t");
}

#[test]
fn l_ancien_mot_de_passe_du_donneur_ne_vaut_plus_apres_la_reprise() {
    let inscription = register(PASSWORD.into(), EMAIL.into()).unwrap();
    let donneur = inscription.account();
    let (kdf, _, epk) = blob_fields(&inscription.blob());

    let contact = register(
        "un autre mot de passe long".into(),
        "kevin@stackops.ch".into(),
    )
    .unwrap()
    .account();
    let scelle = donneur.seal_user_key_for(contact.public_key()).unwrap();
    let coffre = contact
        .open_emergency(donneur.public_key(), scelle)
        .unwrap();

    let reset: Value = serde_json::from_str(
        &coffre
            .takeover(EMAIL.into(), kdf.clone(), NOUVEAU.into())
            .unwrap(),
    )
    .unwrap();
    let euk = reset["encrypted_user_key"].as_str().unwrap().to_string();

    assert!(Account::unlock(PASSWORD.into(), EMAIL.into(), kdf, euk, epk).is_err());
}
