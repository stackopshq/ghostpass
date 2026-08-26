//! Prépare le coffre de test consommé par les tests iOS de bout en bout.
//!
//! N'effectue aucun appel réseau : imprime sur la sortie standard le JSON d'inscription
//! et les items déjà chiffrés, que `tools/ios/run-ios-tests.sh` transmet au serveur.
//! Le chiffrement passe par le **même binding** que l'application, ce qui garantit que
//! le coffre amorcé est exactement celui qu'elle saura rouvrir.
//!
//! Usage : `cargo run -p ghostpass-crypto-ffi --example seed-vault -- <email> <mot de passe>`

use ghostpass_crypto_ffi::{register, Account};
use std::sync::Arc;

/// Un `VaultItem` en clair, tel que le sérialise serde côté cœur.
fn vault_item(name: &str, data: &str) -> String {
    format!(
        r#"{{"name":{},"notes":null,"folder":null,"data":{}}}"#,
        serde_json::to_string(name).expect("un nom est toujours sérialisable"),
        data
    )
}

/// Chiffre un item et le présente sous les noms de champs qu'attend l'API HTTP.
fn encrypted(account: &Account, item: String) -> serde_json::Value {
    let enc: serde_json::Value = serde_json::from_str(
        &account
            .encrypt_item(item)
            .expect("le chiffrement ne doit pas échouer"),
    )
    .expect("le cœur renvoie du JSON");
    serde_json::json!({
        "encryptedKey": enc["encrypted_key"],
        "encryptedData": enc["encrypted_data"],
    })
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (email, password) = match (args.next(), args.next()) {
        (Some(e), Some(p)) => (e, p),
        _ => {
            eprintln!("usage : seed-vault <email> <mot de passe maître>");
            std::process::exit(2);
        }
    };

    let registration = register(password, email.clone()).expect("inscription");
    let blob: serde_json::Value =
        serde_json::from_str(&registration.blob()).expect("le blob est du JSON");
    let account: Arc<Account> = registration.account();

    // L'item de registre des dossiers, écrit exactement comme le fait la web app : un
    // `SecureNote` dont le nom commence par un octet NUL. L'application doit le filtrer ;
    // le voir apparaître dans la liste est la régression que ce coffre sert à détecter.
    let folders = vault_item(
        "\u{0}gp:folders",
        r#"{"kind":"SecureNote","data":{"content":"[\"Travail/Serveurs\"]"}}"#,
    );
    let demo = vault_item(
        "GitHub",
        r#"{"kind":"Login","data":{"username":"clara","password":"hunter2","uris":["https://github.com"],"totp":null,"password_history":[]}}"#,
    );

    // Un identifiant pointant sur la page de test locale : c'est lui qui doit remonter
    // en tête quand le remplissage est demandé depuis cette page.
    let local = vault_item(
        "Site local",
        r#"{"kind":"Login","data":{"username":"clara","password":"local-s3cret","uris":["http://127.0.0.1:8099"],"totp":null,"password_history":[]}}"#,
    );

    let out = serde_json::json!({
        "registration": {
            "email": email,
            "masterPasswordHash": blob["master_password_hash"],
            // Le serveur stocke les paramètres KDF en TEXT : on lui envoie une chaîne.
            "kdfParams": serde_json::to_string(&blob["kdf_params"]).expect("kdf sérialisable"),
            "encryptedUserKey": blob["encrypted_user_key"],
            "encryptedPrivateKey": blob["encrypted_private_key"],
            "publicKey": account.public_key(),
        },
        "items": [encrypted(&account, folders), encrypted(&account, demo), encrypted(&account, local)],
    });
    println!("{out}");
}
