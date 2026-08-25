import XCTest

@testable import Ghostpass

/// Tests de contrat : la couture entre le JSON du serveur, le JSON du cœur Rust et les
/// types Swift. C'est là que se sont logées les deux régressions qui rendaient l'app
/// inutilisable — une connexion impossible, puis un coffre qui restait vide.
///
/// Rien ici n'a besoin du réseau ni de l'interface : les charges utiles sont les octets
/// exacts que renvoie le backend, recopiés depuis une réponse réelle.
final class ContractTests: XCTestCase {

    // ─── Réponses d'authentification ───

    /// Le serveur stocke `kdf_params` en colonne TEXT et la renvoie **verbatim** :
    /// `kdfParams` est une chaîne contenant du JSON, jamais un objet JSON. L'attendre
    /// comme un objet, puis le ré-encoder, produisait une chaîne doublement échappée que
    /// serde rejette — et toute connexion échouait dès le hash d'authentification.
    func testPreloginRenvoieLesParametresKdfSousFormeDeChaine() throws {
        let json = Data(#"{"kdfParams":"{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}"}"#.utf8)
        let res = try JSONDecoder().decode(PreloginResponse.self, from: json)
        XCTAssertEqual(res.kdfParams, #"{"mem_cost_kib":65536,"time_cost":3,"parallelism":4}"#)
    }

    /// La chaîne doit arriver au cœur Rust telle quelle : c'est elle, et pas une version
    /// re-sérialisée, qui doit produire un hash d'authentification.
    func testLesParametresKdfDuServeurSontAcceptesParLeCoeur() throws {
        let json = Data(#"{"kdfParams":"{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}"}"#.utf8)
        let kdf = try JSONDecoder().decode(PreloginResponse.self, from: json).kdfParams
        XCTAssertNoThrow(
            try masterPasswordHash(
                password: "correct horse battery staple", email: "clara@ghostpass.test",
                kdfParamsJson: kdf))
    }

    func testLoginRenvoieLesBlobsEtLesParametresKdf() throws {
        let json = Data(#"""
            {"token":"tok","kdfParams":"{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}",
             "encryptedUserKey":"2.aaa.bbb","encryptedPrivateKey":"2.ccc.ddd"}
            """#.utf8)
        let res = try JSONDecoder().decode(LoginResponse.self, from: json)
        XCTAssertEqual(res.token, "tok")
        XCTAssertEqual(res.encryptedUserKey, "2.aaa.bbb")
        XCTAssertTrue(res.kdfParams.hasPrefix("{"), "kdfParams doit rester du JSON brut")
    }

    // ─── Items du coffre ───

    /// `created_at` / `updated_at` / `deleted_at` sont des colonnes `INTEGER` et sortent
    /// en millisecondes depuis l'epoch. Les attendre en `String` faisait échouer le
    /// décodage de la liste **entière** : le coffre restait vide, sans autre explication
    /// qu'un « Réponse inattendue du serveur ».
    func testLesHorodatagesDesItemsSontDesEntiers() throws {
        let json = Data(#"""
            {"items":[{"id":"abc","encryptedKey":"2.k.k","encryptedData":"2.d.d",
             "createdAt":1787669299110,"updatedAt":1787669299110,"deletedAt":null}]}
            """#.utf8)
        struct Envelope: Decodable { let items: [EncryptedItemDTO] }
        let items = try JSONDecoder().decode(Envelope.self, from: json).items
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].updatedAt, 1_787_669_299_110)
        XCTAssertNil(items[0].deletedAt)

        // La preuve par l'absurde, pour que la raison du type ne se perde pas : attendre
        // une chaîne fait échouer le décodage, et il échoue pour la liste entière.
        struct Ancien: Decodable { let updatedAt: String? }
        struct AncienneEnveloppe: Decodable { let items: [Ancien] }
        XCTAssertThrowsError(try JSONDecoder().decode(AncienneEnveloppe.self, from: json))
    }

    // ─── Aller-retour à travers le cœur Rust ───

    private func compteDeTest() throws -> Account {
        let reg = try register(password: "correct horse battery staple", email: "clara@ghostpass.test")
        return reg.account()
    }

    /// Chiffrer puis déchiffrer un item doit le rendre à l'identique. Ce test tient les
    /// noms de champs serde (`password_history`, `exp_month`, …) : un seul qui diverge et
    /// le champ se perd en silence, ce qu'aucune erreur ne signalerait.
    func testUnItemSurvitAuChiffrementEtAuDechiffrement() throws {
        let account = try compteDeTest()
        let items: [VaultItem] = [
            VaultItem(
                name: "Forgejo", notes: "compte de service", folder: "Travail/Serveurs",
                data: .login(
                    Login(
                        username: "clara", password: "s3cret", uris: ["https://git.stackops.ch"],
                        totp: "otpauth://totp/x", passwordHistory: ["ancien1", "ancien2"]))),
            VaultItem(
                name: "Note", notes: nil, folder: nil,
                data: .secureNote(SecureNote(content: "à ne pas oublier"))),
            VaultItem(
                name: "Carte", notes: nil, folder: nil,
                data: .card(
                    Card(
                        cardholder: "Clara", number: "4111111111111111", expMonth: "04",
                        expYear: "2030", code: "123"))),
        ]
        for item in items {
            let (key, data) = try VaultStore.encrypt(item, with: account)
            let dto = EncryptedItemDTO(
                id: "x", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)
            XCTAssertEqual(try VaultStore.decrypt(dto, with: account), item, "aller-retour de « \(item.name) »")
        }
    }

    /// Une clé d'enveloppe étrangère ne doit rien pouvoir ouvrir.
    func testUnAutreCompteNeDechiffrePas() throws {
        let (a, b) = (try compteDeTest(), try compteDeTest())
        let item = VaultItem(name: "x", notes: nil, folder: nil, data: .secureNote(SecureNote(content: "y")))
        let (key, data) = try VaultStore.encrypt(item, with: a)
        let dto = EncryptedItemDTO(
            id: "x", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)
        XCTAssertThrowsError(try VaultStore.decrypt(dto, with: b))
    }

    // ─── Registre des dossiers ───

    /// Le nom du registre doit être exactement celui de la web app : un octet NUL suivi
    /// de `gp:folders`. À un octet près, l'item cesse d'être filtré et apparaît dans la
    /// liste comme une ligne fantôme.
    func testLeNomDuRegistreCommenceParUnOctetNul() {
        XCTAssertEqual(VaultConstants.foldersItemName, "\u{0}gp:folders")
        XCTAssertEqual(Array(VaultConstants.foldersItemName.utf8).first, 0)
    }

    /// Le registre tel que l'écrit la web app — un `SecureNote` dont le contenu est la
    /// liste des dossiers — traverse le cœur et doit être reconnu comme à masquer.
    func testLeRegistreEcritParLaWebAppEstFiltre() throws {
        let account = try compteDeTest()
        let registre = VaultItem(
            name: VaultConstants.foldersItemName, notes: nil, folder: nil,
            data: .secureNote(SecureNote(content: #"["Travail/Serveurs"]"#)))
        let (key, data) = try VaultStore.encrypt(registre, with: account)
        let dto = EncryptedItemDTO(
            id: "r", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)

        let relu = try VaultStore.decrypt(dto, with: account)
        XCTAssertTrue(VaultStore.isRegistry(relu), "le registre doit être masqué")

        let ordinaire = VaultItem(
            name: "gp:folders", notes: nil, folder: nil,
            data: .secureNote(SecureNote(content: "")))
        XCTAssertFalse(
            VaultStore.isRegistry(ordinaire),
            "un item que l'utilisateur pourrait nommer ainsi ne doit pas disparaître")
    }


    /// Le trousseau du simulateur survit à la désinstallation : un test qui ne le vide pas
    /// hérite de l'état laissé par le précédent.
    private func viderLeTrousseau() {
        for clef in [
            Keychain.Key.serverURL, Keychain.Key.email, Keychain.Key.token,
            Keychain.Key.kdfParams, Keychain.Key.encryptedUserKey,
            Keychain.Key.encryptedPrivateKey, Keychain.Key.masterPassword,
            Keychain.Key.biometricsEnabled,
        ] {
            Keychain.remove(clef)
        }
    }

    // ─── Déverrouillage biométrique ───

    /// Activer la biométrie dépose le mot de passe maître dans le trousseau. On ne l'y met
    /// qu'après avoir prouvé qu'il ouvre réellement le coffre : sans cette vérification,
    /// une faute de frappe enfermerait l'utilisateur derrière un secret qui n'ouvre rien.
    @MainActor
    func testActiverLaBiometrieRefuseUnMotDePasseFaux() throws {
        viderLeTrousseau()
        defer { viderLeTrousseau() }
        let mail = "biometrie@ghostpass.test"
        let motDePasse = "correct horse battery staple"
        let blob = try JSONSerialization.jsonObject(
            with: Data(try register(password: motDePasse, email: mail).blob().utf8))
        let champs = try XCTUnwrap(blob as? [String: Any])

        // Une session telle que l'app en dépose une après une connexion réussie.
        Keychain.set(mail, for: Keychain.Key.email)
        Keychain.set(
            String(decoding: try JSONSerialization.data(withJSONObject: champs["kdf_params"]!), as: UTF8.self),
            for: Keychain.Key.kdfParams)
        Keychain.set(try XCTUnwrap(champs["encrypted_user_key"] as? String), for: Keychain.Key.encryptedUserKey)
        Keychain.set(try XCTUnwrap(champs["encrypted_private_key"] as? String), for: Keychain.Key.encryptedPrivateKey)
        let store = VaultStore()
        XCTAssertFalse(store.enableBiometrics(password: "ce n'est pas le bon"))
        XCTAssertFalse(store.isBiometricEnabled, "un mot de passe faux ne doit rien activer")
        XCTAssertNotNil(store.errorMessage)
    }

    /// Sans session enregistrée, il n'y a rien à confier au trousseau.
    @MainActor
    func testActiverLaBiometrieSansSessionEchoue() {
        viderLeTrousseau()
        defer { viderLeTrousseau() }
        let store = VaultStore()
        XCTAssertFalse(store.enableBiometrics(password: "peu importe"))
        XCTAssertFalse(store.isBiometricEnabled)
    }
}
