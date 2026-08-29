//! Prépare le coffre de test consommé par les tests iOS de bout en bout.
//!
//! N'effectue aucun appel réseau : imprime sur la sortie standard le JSON d'inscription
//! et les items déjà chiffrés, que `tools/ios/run-ios-tests.sh` transmet au serveur.
//! Le chiffrement passe par le **même binding** que l'application, ce qui garantit que
//! le coffre amorcé est exactement celui qu'elle saura rouvrir.
//!
//! Usage : `cargo run -p ghostpass-crypto-ffi --example seed-vault -- <email> <mot de passe>`
//!
//! Avec `--vitrine` en troisième argument, quelques items supplémentaires viennent
//! s'ajouter. Ils ne servent qu'aux captures de la fiche App Store : un coffre à deux
//! entrées ne montre pas ce que fait le produit. Les tests, eux, s'appuient sur le compte
//! exact ci-dessous — d'où un drapeau plutôt qu'un enrichissement systématique, qui
//! ferait mentir leurs décomptes.

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

    let vitrine = args.next().is_some_and(|a| a == "--vitrine");

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
    //
    // Il porte un secret TOTP — le vecteur de test usuel de la RFC 4648 — parce que sans
    // lui rien ne permet d'exercer le remplissage des codes à usage unique : l'extension
    // ne publie d'identité de code que pour les entrées dont le secret est exploitable,
    // et un coffre sans TOTP rendrait ce chemin intestable.
    let local = vault_item(
        "Site local",
        r#"{"kind":"Login","data":{"username":"clara","password":"local-s3cret","uris":["http://127.0.0.1:8099"],"totp":"JBSWY3DPEHPK3PXP","password_history":[]}}"#,
    );

    // La vitrine : des entrées plausibles, aux noms reconnaissables, dont une avec un
    // second facteur et une carte — de quoi montrer que le coffre ne range pas que des
    // mots de passe.
    let mut items = vec![
        encrypted(&account, folders),
        encrypted(&account, demo),
        encrypted(&account, local),
    ];
    if vitrine {
        for (nom, data) in [
            (
                "Gmail",
                r#"{"kind":"Login","data":{"username":"clara.vanacker@gmail.com","password":"Wq7!fRk2$mZp9Lx","uris":["https://mail.google.com"],"totp":"JBSWY3DPEHPK3PXP","password_history":[]}}"#,
            ),
            (
                "Amazon",
                r#"{"kind":"Login","data":{"username":"clara.vanacker","password":"T4#vNs8qLd2!Wm","uris":["https://amazon.fr"],"totp":null,"password_history":[]}}"#,
            ),
            (
                "Netflix",
                r#"{"kind":"Login","data":{"username":"clara@stackops.ch","password":"Zx9$bKt5!nQv3R","uris":["https://netflix.com"],"totp":null,"password_history":[]}}"#,
            ),
            (
                "Banque",
                r#"{"kind":"Login","data":{"username":"FR7630001007","password":"Hn4!pXw8$cJm6T","uris":[],"totp":"JBSWY3DPEHPK3PXP","password_history":[]}}"#,
            ),
            (
                "Carte bleue",
                r#"{"kind":"Card","data":{"cardholder":"CLARA VANACKER","number":"4111111111111111","exp_month":"09","exp_year":"2029","code":"123"}}"#,
            ),
            (
                "Codes de secours",
                r#"{"kind":"SecureNote","data":{"content":"Codes de récupération à usage unique. À conserver hors ligne."}}"#,
            ),
        ] {
            items.push(encrypted(&account, vault_item(nom, data)));
        }
    }

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
        "items": items,
    });
    println!("{out}");
}
