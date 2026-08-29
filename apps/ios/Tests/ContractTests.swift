import SwiftUI
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
        let json = Data(
            #"{"kdfParams":"{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}"}"#.utf8)
        let res = try JSONDecoder().decode(PreloginResponse.self, from: json)
        XCTAssertEqual(res.kdfParams, #"{"mem_cost_kib":65536,"time_cost":3,"parallelism":4}"#)
    }

    /// La chaîne doit arriver au cœur Rust telle quelle : c'est elle, et pas une version
    /// re-sérialisée, qui doit produire un hash d'authentification.
    func testLesParametresKdfDuServeurSontAcceptesParLeCoeur() throws {
        let json = Data(
            #"{"kdfParams":"{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}"}"#.utf8)
        let kdf = try JSONDecoder().decode(PreloginResponse.self, from: json).kdfParams
        XCTAssertNoThrow(
            try masterPasswordHash(
                password: "correct horse battery staple", email: "clara@ghostpass.test",
                kdfParamsJson: kdf))
    }

    func testLoginRenvoieLesBlobsEtLesParametresKdf() throws {
        let json = Data(
            #"""
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
        let json = Data(
            #"""
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
        let reg = try register(
            password: "correct horse battery staple", email: "clara@ghostpass.test")
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
            XCTAssertEqual(
                try VaultStore.decrypt(dto, with: account), item, "aller-retour de « \(item.name) »"
            )
        }
    }

    /// Une clé d'enveloppe étrangère ne doit rien pouvoir ouvrir.
    func testUnAutreCompteNeDechiffrePas() throws {
        let (a, b) = (try compteDeTest(), try compteDeTest())
        let item = VaultItem(
            name: "x", notes: nil, folder: nil, data: .secureNote(SecureNote(content: "y")))
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
            Keychain.Key.token, Keychain.Key.masterPassword, Keychain.Key.biometricsEnabled,
        ] {
            Keychain.remove(clef)
        }
        SharedStore.clear()
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
        SharedStore.save(
            SharedStore.Session(
                serverURL: "http://127.0.0.1:3111", email: mail,
                kdfParams: String(
                    decoding: try JSONSerialization.data(withJSONObject: champs["kdf_params"]!),
                    as: UTF8.self),
                encryptedUserKey: try XCTUnwrap(champs["encrypted_user_key"] as? String),
                encryptedPrivateKey: try XCTUnwrap(champs["encrypted_private_key"] as? String)))
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

/// Le conteneur partagé entre l'application et l'extension de remplissage.
final class SharedStoreTests: XCTestCase {
    override func setUp() { SharedStore.clear() }
    override func tearDown() { SharedStore.clear() }

    /// Sans groupe d'applications, l'extension ne voit ni le coffre ni la session : elle
    /// s'ouvre sur un écran vide, et rien dans l'application ne le laisse deviner. Ce test
    /// tient la configuration — entitlements des deux cibles comprises.
    func testLeGroupeDApplicationsEstAccessible() {
        XCTAssertTrue(
            SharedStore.isShared,
            "groupe \(SharedStore.appGroup) inaccessible : vérifiez les fichiers .entitlements")
    }

    func testLaSessionSeRelitEtSEfface() throws {
        XCTAssertNil(SharedStore.load())
        let session = SharedStore.Session(
            serverURL: "http://127.0.0.1:3111", email: "clara@ghostpass.test",
            kdfParams: #"{"mem_cost_kib":65536,"time_cost":3,"parallelism":4}"#,
            encryptedUserKey: "2.uuu.uuu", encryptedPrivateKey: "2.ppp.ppp")
        SharedStore.save(session)
        XCTAssertEqual(try XCTUnwrap(SharedStore.load()), session)
        SharedStore.clear()
        XCTAssertNil(SharedStore.load())
    }
}

/// Copie locale du coffre : ce sont les blobs chiffrés du serveur, reposés tels quels.
final class VaultCacheTests: XCTestCase {
    private let items = [
        EncryptedItemDTO(
            id: "a", encryptedKey: "2.kkk.kkk", encryptedData: "2.ddd.ddd",
            updatedAt: 1_787_669_299_110, deletedAt: nil)
    ]

    override func setUp() { VaultCache.clear() }
    override func tearDown() { VaultCache.clear() }

    /// Sans copie locale, un coffre sans réseau s'affiche vide — ce qui ressemble à s'y
    /// méprendre à un coffre qu'on aurait perdu.
    func testLaCopieLocaleSeRelit() throws {
        XCTAssertNil(VaultCache.load(), "on part d'un cache vide")
        VaultCache.save(items)
        let relu = try XCTUnwrap(VaultCache.load())
        XCTAssertEqual(relu.map(\.id), ["a"])
        XCTAssertEqual(relu.first?.encryptedData, "2.ddd.ddd")
        XCTAssertEqual(relu.first?.updatedAt, 1_787_669_299_110)
    }

    /// Se déconnecter doit effacer la copie : laisser le coffre d'un compte sur
    /// l'appareil après son départ serait une fuite, même chiffré.
    func testLaCopieLocaleSEfface() {
        VaultCache.save(items)
        XCTAssertNotNil(VaultCache.load())
        VaultCache.clear()
        XCTAssertNil(VaultCache.load())
    }
}

/// Générateur et TOTP : ils ne touchent pas au cœur Rust, mais ils doivent se comporter
/// exactement comme leurs équivalents de la web app — un mot de passe généré ici et un
/// code lu là doivent être de même nature, sinon les deux clients divergent en silence.
final class GeneratorAndTotpTests: XCTestCase {

    // ─── Générateur ───

    func testLeMotDePasseRespecteLaLongueurDemandee() {
        for longueur in [8, 20, 64, 128] {
            var options = GeneratorOptions()
            options.length = longueur
            XCTAssertEqual(PasswordGenerator.generate(options).count, longueur)
        }
    }

    /// Cocher « chiffres » et n'en obtenir aucun serait un mot de passe qui ne respecte
    /// pas la consigne — le générateur garantit au moins un caractère par jeu demandé.
    func testChaqueJeuDemandeEstRepresente() {
        var options = GeneratorOptions()
        options.length = 8
        for _ in 0..<200 {
            let mot = PasswordGenerator.generate(options)
            XCTAssertTrue(mot.contains { $0.isLowercase }, "minuscule absente de « \(mot) »")
            XCTAssertTrue(mot.contains { $0.isUppercase }, "majuscule absente de « \(mot) »")
            XCTAssertTrue(mot.contains { $0.isNumber }, "chiffre absent de « \(mot) »")
            XCTAssertTrue(
                mot.contains { "!@#$%^&*()-_=+[]{};:,.?/".contains($0) },
                "symbole absent de « \(mot) »")
        }
    }

    func testUnSeulJeuNeProduitQueCeJeu() {
        var options = GeneratorOptions(
            length: 40, lowercase: false, uppercase: false, digits: true, symbols: false)
        options.length = 40
        let mot = PasswordGenerator.generate(options)
        XCTAssertTrue(mot.allSatisfy(\.isNumber), "« \(mot) » ne devrait contenir que des chiffres")
    }

    /// Tout décocher ne doit pas rendre un mot de passe vide.
    func testAucunJeuRetombeSurLesMinuscules() {
        let options = GeneratorOptions(
            length: 16, lowercase: false, uppercase: false, digits: false, symbols: false)
        let mot = PasswordGenerator.generate(options)
        XCTAssertEqual(mot.count, 16)
        XCTAssertTrue(mot.allSatisfy(\.isLowercase))
    }

    func testDeuxAppelsNeDonnentPasLeMemeMotDePasse() {
        let options = GeneratorOptions()
        XCTAssertNotEqual(PasswordGenerator.generate(options), PasswordGenerator.generate(options))
    }

    // ─── TOTP ───

    /// Vecteurs de la RFC 6238 (secret ASCII « 12345678901234567890 », SHA-1, 8 chiffres).
    /// S'ils passent, la mécanique est celle que tout le monde attend.
    func testVecteursDeLaRfc6238() throws {
        let config = OtpConfig(
            secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", period: 30, digits: 8, algorithm: .sha1)
        let attendus: [(TimeInterval, String)] = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
        ]
        for (instant, attendu) in attendus {
            let resultat = try XCTUnwrap(
                Totp.code(for: config, at: Date(timeIntervalSince1970: instant)))
            XCTAssertEqual(resultat.code, attendu, "à t=\(Int(instant))")
        }
    }

    func testLeTempsRestantDecroitDansLaPeriode() throws {
        let config = OtpConfig(secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
        let debut = try XCTUnwrap(Totp.code(for: config, at: Date(timeIntervalSince1970: 60)))
        let fin = try XCTUnwrap(Totp.code(for: config, at: Date(timeIntervalSince1970: 89)))
        XCTAssertEqual(debut.remaining, 30)
        XCTAssertEqual(fin.remaining, 1)
        XCTAssertEqual(debut.code, fin.code, "le code ne change qu'au changement de période")
    }

    func testUneUriOtpauthEstComprise() throws {
        let config = try XCTUnwrap(
            Totp.parse(
                "otpauth://totp/GhostPass:clara?secret=GEZDGNBVGY3TQOJQ&period=60&digits=8&algorithm=SHA256"
            ))
        XCTAssertEqual(config.secret, "GEZDGNBVGY3TQOJQ")
        XCTAssertEqual(config.period, 60)
        XCTAssertEqual(config.digits, 8)
        XCTAssertEqual(config.algorithm, .sha256)
    }

    /// Un secret recopié à la main arrive avec des espaces et en minuscules.
    func testUnSecretBrutEstNormalise() throws {
        let config = try XCTUnwrap(Totp.parse("  gezd gnbv gy3t qojq  "))
        XCTAssertEqual(config.secret, "GEZDGNBVGY3TQOJQ")
        XCTAssertEqual(config.period, 30)
        XCTAssertEqual(config.digits, 6)
    }

    func testUnChampVideNEstPasUneErreur() {
        XCTAssertNil(Totp.parse(""))
        XCTAssertNil(Totp.parse("   "))
    }

    /// Des paramètres absurdes sont ramenés à des valeurs utilisables plutôt que
    /// propagés jusqu'au calcul.
    func testDesParametresAbsurdesSontCorriges() throws {
        let config = try XCTUnwrap(
            Totp.parse("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ&period=0&digits=42"))
        XCTAssertEqual(config.period, 30)
        XCTAssertEqual(config.digits, 6)
        XCTAssertNotNil(Totp.code(for: config))
    }
}

/// Rapprochement entre le site où l'on se trouve et les adresses d'un item. C'est cette
/// règle qui décide de ce que le remplissage propose : trop stricte, elle ne propose
/// rien ; trop lâche, elle offre les identifiants d'un site à un autre.
final class SiteMatchingTests: XCTestCase {

    func testUneUrlEstRamenéeASonHote() {
        XCTAssertEqual(SiteMatching.host(of: "https://github.com/login?next=/x"), "github.com")
        XCTAssertEqual(SiteMatching.host(of: "HTTPS://WWW.GitHub.COM/"), "github.com")
        XCTAssertEqual(SiteMatching.host(of: "git.stackops.ch"), "git.stackops.ch")
        XCTAssertEqual(SiteMatching.host(of: "http://127.0.0.1:3111/api"), "127.0.0.1")
        XCTAssertEqual(SiteMatching.host(of: "  https://Example.com  "), "example.com")
        XCTAssertEqual(SiteMatching.host(of: ""), "")
    }

    /// Les sites déplacent leur formulaire d'authentification sur un sous-domaine sans
    /// prévenir : un identifiant enregistré pour `example.com` doit valoir sur
    /// `login.example.com`.
    func testUnSousDomaineCorrespondAuDomaine() {
        XCTAssertTrue(SiteMatching.sameSite("login.example.com", "example.com"))
        XCTAssertTrue(SiteMatching.sameSite("example.com", "login.example.com"))
        XCTAssertTrue(SiteMatching.sameSite("example.com", "example.com"))
    }

    /// Le point de séparation compte : sans lui, `notexample.com` passerait pour un
    /// sous-domaine d'`example.com` et le coffre livrerait ses identifiants à un voisin.
    func testUnDomaineVoisinNeCorrespondPas() {
        XCTAssertFalse(SiteMatching.sameSite("notexample.com", "example.com"))
        XCTAssertFalse(SiteMatching.sameSite("example.com.attaquant.net", "example.com"))
        XCTAssertFalse(SiteMatching.sameSite("example.org", "example.com"))
        XCTAssertFalse(SiteMatching.sameSite("", "example.com"))
    }

    private func identifiant(_ adresses: [String]) -> VaultItem {
        VaultItem(
            name: "x", notes: nil, folder: nil,
            data: .login(Login(username: "clara", password: "s", uris: adresses)))
    }

    func testUnItemEstProposeSurSonSite() {
        let item = identifiant(["https://github.com/login"])
        XCTAssertTrue(SiteMatching.matches(item, domains: ["github.com"]))
        XCTAssertTrue(SiteMatching.matches(item, domains: ["https://gist.github.com"]))
        XCTAssertFalse(SiteMatching.matches(item, domains: ["gitlab.com"]))
        XCTAssertFalse(SiteMatching.matches(item, domains: []))
    }

    /// Une note ou une carte n'a rien à remplir dans un champ d'identifiant.
    func testSeulsLesIdentifiantsSontProposes() {
        let note = VaultItem(
            name: "n", notes: nil, folder: nil, data: .secureNote(SecureNote(content: "x")))
        XCTAssertFalse(SiteMatching.matches(note, domains: ["github.com"]))
    }

    /// Un identifiant sans adresse ne peut être rattaché à aucun site — il reste
    /// accessible dans la liste complète, mais n'est pas suggéré.
    func testUnItemSansAdresseNEstPasSuggere() {
        XCTAssertFalse(SiteMatching.matches(identifiant([]), domains: ["github.com"]))
    }
}

/// Ce que fait l'extension de remplissage quand un site réclame un identifiant : relire
/// la copie locale, la déchiffrer avec le mot de passe maître, et ne proposer que ce qui
/// vaut pour ce site. L'extension vit dans un autre processus ; ce test exerce ici le
/// chemin qu'elle emprunte, avec le même code.
final class AutoFillLogicTests: XCTestCase {
    override func setUp() { VaultCache.clear() }
    override func tearDown() { VaultCache.clear() }

    private func identifiant(_ nom: String, _ adresse: String) -> VaultItem {
        VaultItem(
            name: nom, notes: nil, folder: nil,
            data: .login(Login(username: "clara", password: "s3cret-\(nom)", uris: [adresse])))
    }

    func testLeRemplissageNeProposeQueLesIdentifiantsDuSite() throws {
        let account = try register(
            password: "correct horse battery staple", email: "clara@ghostpass.test"
        ).account()

        // Un coffre comme l'application en dépose un : deux sites et le registre interne.
        let coffre = [
            identifiant("GitHub", "https://github.com/login"),
            identifiant("Forgejo", "https://git.stackops.ch"),
            VaultItem(
                name: VaultConstants.foldersItemName, notes: nil, folder: nil,
                data: .secureNote(SecureNote(content: "[]"))),
        ]
        let dtos = try coffre.enumerated().map { index, item -> EncryptedItemDTO in
            let (key, data) = try VaultStore.encrypt(item, with: account)
            return EncryptedItemDTO(
                id: "item-\(index)", encryptedKey: key, encryptedData: data,
                updatedAt: nil, deletedAt: nil)
        }
        VaultCache.save(dtos)

        // Le chemin de l'extension : cache → déchiffrement → filtrage.
        let items = try XCTUnwrap(VaultCache.load()).compactMap {
            try? VaultStore.decrypt($0, with: account)
        }
        let visibles = items.filter { !VaultStore.isRegistry($0) }
        XCTAssertEqual(visibles.count, 2, "le registre interne n'a rien à faire ici non plus")

        let surGitHub = visibles.filter {
            SiteMatching.matches($0, domains: ["https://gist.github.com/clara"])
        }
        XCTAssertEqual(surGitHub.map(\.name), ["GitHub"], "un sous-domaine doit correspondre")

        let surLaForge = visibles.filter { SiteMatching.matches($0, domains: ["git.stackops.ch"]) }
        XCTAssertEqual(surLaForge.map(\.name), ["Forgejo"])

        // Le mot de passe fourni est bien celui de l'item retenu.
        guard case .login(let login) = try XCTUnwrap(surGitHub.first).data else {
            return XCTFail("un identifiant était attendu")
        }
        XCTAssertEqual(login.password, "s3cret-GitHub")

        // Sur un site inconnu, rien n'est suggéré — la liste complète reste accessible.
        XCTAssertTrue(
            visibles.filter { SiteMatching.matches($0, domains: ["exemple.test"]) }.isEmpty)
    }
}

/// Le registre des dossiers, partagé avec la web app.
///
/// Seuls les dossiers **vides** y figurent : les autres se déduisent des éléments qui les
/// habitent. Le format est celui qu'écrit `encryptFolders` côté web — un `SecureNote` dont
/// le contenu est la liste des chemins en JSON, sous un nom que les deux clients masquent.
/// Un écart ici et chaque client verrait des dossiers que l'autre ignore.
final class FolderRegistryTests: XCTestCase {

    private func compte() throws -> Account {
        try register(password: "correct horse battery staple", email: "clara@ghostpass.test")
            .account()
    }

    /// Le registre tel que l'écrirait l'application doit se relire à l'identique, et
    /// rester invisible dans la liste.
    func testLeRegistreSeRelitEtResteMasque() throws {
        let account = try compte()
        let chemins = ["Perso", "Travail", "Travail/Serveurs"]
        let contenu = String(decoding: try JSONEncoder().encode(chemins), as: UTF8.self)
        let registre = VaultItem(
            name: VaultConstants.foldersItemName, notes: nil, folder: nil,
            data: .secureNote(SecureNote(content: contenu)))

        let (key, data) = try VaultStore.encrypt(registre, with: account)
        let dto = EncryptedItemDTO(
            id: "r", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)
        let relu = try VaultStore.decrypt(dto, with: account)

        XCTAssertTrue(VaultStore.isRegistry(relu), "le registre doit rester masqué")
        guard case .secureNote(let note) = relu.data else {
            return XCTFail("un SecureNote était attendu")
        }
        XCTAssertEqual(
            try JSONDecoder().decode([String].self, from: Data(note.content.utf8)), chemins)
    }

    /// « Travail/ », « /Travail » et « Travail » désignent le même endroit : sans
    /// normalisation, ils coexisteraient dans le registre comme trois dossiers distincts.
    func testLesCheminsSontNormalises() {
        XCTAssertEqual(VaultStore.normaliser("  Travail  "), "Travail")
        XCTAssertEqual(VaultStore.normaliser("/Travail/"), "Travail")
        XCTAssertEqual(VaultStore.normaliser("Travail/Serveurs/"), "Travail/Serveurs")
        XCTAssertEqual(VaultStore.normaliser("   "), "")
        XCTAssertEqual(VaultStore.normaliser("//"), "")
    }
}

// ─── Traduction ───────────────────────────────────────────────────────────────

/// L'application se veut disponible en français et en anglais. Ce qui peut casser sans
/// bruit, ce n'est pas le sélecteur de langue — c'est le catalogue : une chaîne oubliée,
/// une région non déclarée, et l'écran reste en français en jurant que la langue a changé.
/// Ces tests interrogent le paquet réellement construit, pas le fichier source.
final class TraductionTests: XCTestCase {
    /// Le paquet anglais existe : sans lui, choisir « English » ne changerait rien.
    func testLePaquetAnglaisEstEmbarque() throws {
        let chemin = try XCTUnwrap(
            Bundle.main.path(forResource: "en", ofType: "lproj"),
            "aucun en.lproj dans l'application : le catalogue n'a pas été compilé")
        let paquet = try XCTUnwrap(Bundle(path: chemin))
        XCTAssertEqual(paquet.localizedString(forKey: "Coffre", value: nil, table: nil), "Vault")
        XCTAssertEqual(
            paquet.localizedString(forKey: "Réglages", value: nil, table: nil), "Settings")
    }

    /// Le français est la langue de développement : ses clefs sont ses propres textes,
    /// et une clef absente du catalogue s'affiche telle quelle plutôt que de disparaître.
    func testLeFrancaisResteLaLangueDeDeveloppement() {
        XCTAssertEqual(Bundle.main.developmentLocalization, "fr")
        XCTAssertTrue(
            Bundle.main.localizations.contains("en"),
            "l'anglais n'est pas déclaré parmi les localisations de l'application")
    }

    /// Les écrans les plus exposés — déverrouillage, coffre, réglages — sont traduits.
    /// Une chaîne oubliée laisse ici sa clef française en évidence.
    func testLesEcransPrincipauxSontTraduits() throws {
        let chemin = try XCTUnwrap(Bundle.main.path(forResource: "en", ofType: "lproj"))
        let paquet = try XCTUnwrap(Bundle(path: chemin))
        let attendus = [
            "Mot de passe maître": "Master password",
            "Se connecter": "Sign in",
            "Verrouiller": "Lock",
            "Nouvel élément": "New item",
            "Corbeille": "Trash",
            "Apparence": "Appearance",
            "Langue": "Language",
            "Sombre": "Dark",
            "Mot de passe maître incorrect.": "Incorrect master password.",
        ]
        for (clef, traduction) in attendus {
            XCTAssertEqual(
                paquet.localizedString(forKey: clef, value: nil, table: nil), traduction,
                "« \(clef) » n'est pas traduit")
        }
    }

    /// Les deux réglages ne sont que des choix : ce qu'ils désignent doit rester juste.
    func testLesChoixDeThemeEtDeLangueDesignentBienCeQuIlFaut() {
        XCTAssertNil(Apparence.systeme.colorScheme, "« Système » ne doit rien imposer")
        XCTAssertEqual(Apparence.clair.colorScheme, .light)
        XCTAssertEqual(Apparence.sombre.colorScheme, .dark)

        XCTAssertNil(Langue.systeme.code, "« Système » ne doit forcer aucune langue")
        XCTAssertEqual(Langue.francais.code, "fr")
        XCTAssertEqual(Langue.anglais.code, "en")
        XCTAssertEqual(Langue.anglais.locale?.identifier, "en")
    }
}

// ─── Santé du coffre ──────────────────────────────────────────────────────────

/// Le barème est celui de la web app. Ce qui casserait sans bruit, c'est une divergence :
/// un mot de passe jugé faible dans le navigateur et bon sur le téléphone ferait douter
/// des deux. Ces vecteurs sont donc ceux du barème web, recopiés.
final class PasswordHealthTests: XCTestCase {
    private func niveau(_ mot: String) -> Int { PasswordHealth.force(mot).niveau }

    func testLeBaremeSuitCeluiDeLaWebApp() {
        // Rien : niveau plancher.
        XCTAssertEqual(niveau(""), 0)
        // 7 caractères, deux classes : score 1 → niveau 1.
        XCTAssertEqual(niveau("abc123"), 1)
        // 8 caractères, deux classes : score 2 → niveau 2.
        XCTAssertEqual(niveau("abcd1234"), 2)
        // 14 caractères, trois classes : score 4 → niveau 3. C'est la longueur de 20
        // qui manque pour atteindre le dernier cran, et non la variété.
        XCTAssertEqual(niveau("Abcdefgh123456"), 3)
        // 20 caractères, quatre classes : score 5 → niveau 4.
        XCTAssertEqual(niveau("Abcdefgh1234567890!!"), 4)
    }

    /// Un mot de passe long mais d'une seule sorte de caractères reste faible : c'est
    /// exactement le cas que la longueur seule laisserait passer.
    func testUneSeuleSorteDeCaracteresNeSuffitPas() {
        XCTAssertLessThanOrEqual(niveau("aaaaaaaa"), 1)
        XCTAssertLessThanOrEqual(niveau("motdepasse"), 1)
    }

    func testLesMotsDePasseReutilisesSontReperes() {
        let entries = [
            entree("A", motDePasse: "correct horse battery staple"),
            entree("B", motDePasse: "correct horse battery staple"),
            entree("C", motDePasse: "Zx9!kQ2m#Lp4vT7w"),
        ]
        let bilan = PasswordHealth.bilan(entries)
        XCTAssertEqual(Set(bilan.reutilises.map(\.item.name)), ["A", "B"])
        XCTAssertTrue(bilan.faibles.isEmpty, "aucun de ces mots de passe n'est faible")
    }

    /// Une note et une carte n'ont pas de mot de passe : les compter comme faibles
    /// remplirait l'écran de santé d'alertes sans objet.
    func testSeulsLesIdentifiantsSontJuges() {
        let note = VaultEntry(
            id: "n",
            item: VaultItem(
                name: "Note", notes: nil, folder: nil,
                data: .secureNote(SecureNote(content: "x"))),
            updatedAt: nil)
        let bilan = PasswordHealth.bilan([note, entree("Faible", motDePasse: "abc")])
        XCTAssertEqual(bilan.faibles.map(\.item.name), ["Faible"])
        XCTAssertEqual(bilan.sansCode.map(\.item.name), ["Faible"])
    }

    private func entree(_ nom: String, motDePasse: String) -> VaultEntry {
        VaultEntry(
            id: nom,
            item: VaultItem(
                name: nom, notes: nil, folder: nil,
                data: .login(Login(username: "clara", password: motDePasse))),
            updatedAt: nil)
    }
}

// ─── Registres ────────────────────────────────────────────────────────────────

/// Le coffre range ses métadonnées dans des items comme les autres, sous un nom masqué.
/// Le jour où un autre client de la suite en ajoute un, il ne doit pas apparaître dans la
/// liste : c'est le préfixe, et non le nom exact, qui décide.
final class RegistryTests: XCTestCase {
    private func item(_ nom: String) -> VaultItem {
        VaultItem(name: nom, notes: nil, folder: nil, data: .secureNote(SecureNote(content: "[]")))
    }

    func testTousLesRegistresSontMasques() {
        XCTAssertTrue(VaultStore.isRegistry(item(VaultConstants.foldersItemName)))
        XCTAssertTrue(VaultStore.isRegistry(item(VaultConstants.favoritesItemName)))
        // Un registre qu'aucune version actuelle ne connaît.
        XCTAssertTrue(VaultStore.isRegistry(item(VaultConstants.registryPrefix + "avenir")))
    }

    /// Un nom choisi par l'utilisateur ne peut pas passer pour un registre : le préfixe
    /// commence par un octet NUL, qu'aucun clavier ne produit.
    func testUnNomOrdinaireNEstPasUnRegistre() {
        XCTAssertFalse(VaultStore.isRegistry(item("gp:folders")))
        XCTAssertFalse(VaultStore.isRegistry(item("Favoris")))
        XCTAssertFalse(VaultStore.isRegistry(item("")))
    }
}

// ─── Historique des mots de passe ─────────────────────────────────────────────

/// Un mot de passe remplacé rejoint l'historique. C'est ce qui sauve un compte dont le
/// changement a échoué à mi-chemin — le service a gardé l'ancien, l'application le
/// nouveau. Encore faut-il que l'historique traverse le chiffrement intact, et qu'il
/// cesse de grossir : un item qui enfle à chaque modification finit par coûter cher.
final class PasswordHistoryTests: XCTestCase {
    private func compte() throws -> Account {
        try register(password: "correct horse battery staple", email: "clara@ghostpass.test")
            .account()
    }

    func testLHistoriqueSurvitAuChiffrement() throws {
        let account = try compte()
        let anciens = ["premier", "deuxième", "troisième"]
        let item = VaultItem(
            name: "Forgejo", notes: nil, folder: nil,
            data: .login(
                Login(
                    username: "clara", password: "actuel", uris: [], totp: nil,
                    passwordHistory: anciens)))

        let (key, data) = try VaultStore.encrypt(item, with: account)
        let dto = EncryptedItemDTO(
            id: "x", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)
        let relu = try VaultStore.decrypt(dto, with: account)

        guard case .login(let login) = relu.data else { return XCTFail("un Login était attendu") }
        XCTAssertEqual(
            login.passwordHistory, anciens,
            "l'historique ne traverse pas le chiffrement — le champ `password_history` a changé de nom"
        )
    }

    /// Le plafond est celui de la web app. S'il divergeait, un même coffre montrerait
    /// plus d'anciens mots de passe d'un côté que de l'autre, et on croirait à une perte.
    func testLePlafondEstCeluiDeLaWebApp() {
        XCTAssertEqual(VaultConstants.passwordHistoryLimit, 20)
    }
}

// ─── Récupération de compte ───────────────────────────────────────────────────

/// La clé de récupération est la seule issue d'un mot de passe maître oublié : sans elle,
/// un coffre chiffré de bout en bout est perdu pour de bon. Ce qui casserait sans bruit,
/// ce sont les noms de champs — le cœur Rust les écrit en `snake_case`, l'API les attend
/// en camelCase — et le fait que la clé du coffre survive à la réinitialisation. Un coffre
/// qu'on rouvre mais dont les items ne se déchiffrent plus n'est pas un coffre récupéré.
final class RecoveryTests: XCTestCase {
    private let motDePasse = "correct horse battery staple"
    private let mail = "clara@ghostpass.test"

    /// Le blob d'inscription porte les paramètres KDF comme **objet** JSON, alors que le
    /// serveur les stocke — et les rend — comme une chaîne contenant du JSON. C'est la
    /// même couture qu'au prélogin, et c'est là qu'une régression s'était déjà logée : le
    /// cœur Rust veut la chaîne, pas l'objet.
    private func parametresKdf(_ blobs: [String: Any]) throws -> String {
        let objet = try XCTUnwrap(blobs["kdf_params"])
        return String(
            decoding: try JSONSerialization.data(withJSONObject: objet), as: UTF8.self)
    }

    /// Les clefs du JSON de `create_recovery()` sont celles que l'application décode.
    func testLeKitPorteLesTroisChampsAttendus() throws {
        let account = try register(password: motDePasse, email: mail).account()
        let json = try account.createRecovery()
        let kit = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])

        for clef in ["recovery_key", "recovery_auth_hash", "encrypted_user_key_recovery"] {
            XCTAssertNotNil(kit[clef], "le kit de récupération n'a pas de champ « \(clef) »")
            XCTAssertFalse(
                (kit[clef] as? String ?? "").isEmpty, "le champ « \(clef) » est vide")
        }
    }

    /// Le parcours entier, contre le vrai binding : un coffre, une clé de récupération,
    /// un nouveau mot de passe — et l'item d'origine qui se relit.
    func testUnCoffreSeRouvreApresReinitialisation() throws {
        let inscription = try register(password: motDePasse, email: mail)
        let account = try inscription.account()
        let blobs = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(inscription.blob().utf8)) as? [String: Any])
        let kdf = try parametresKdf(blobs)
        let clePrivee = try XCTUnwrap(blobs["encrypted_private_key"] as? String)

        // Un item déposé avant l'oubli : c'est lui qui dira si la clé du coffre a survécu.
        let item = VaultItem(
            name: "Forgejo", notes: nil, folder: nil,
            data: .login(Login(username: "clara", password: "s3cret-initial")))
        let (key, data) = try VaultStore.encrypt(item, with: account)

        let kit = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try account.createRecovery().utf8))
                as? [String: Any])
        let cleDeRecuperation = try XCTUnwrap(kit["recovery_key"] as? String)
        let uskRecuperation = try XCTUnwrap(kit["encrypted_user_key_recovery"] as? String)

        // Le mot de passe maître est oublié : on repart de la clé de récupération seule.
        let resultat = try recover(
            recoveryKey: cleDeRecuperation, email: mail, newPassword: "nouveau mot de passe maître",
            kdfParamsJson: kdf, encryptedUserKeyRecovery: uskRecuperation,
            encryptedPrivateKey: clePrivee)

        let reset = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(resultat.reset().utf8)) as? [String: Any])
        for clef in ["master_password_hash", "recovery_auth_hash", "encrypted_user_key"] {
            XCTAssertNotNil(reset[clef], "le blob de réinitialisation n'a pas de champ « \(clef) »")
        }

        let dto = EncryptedItemDTO(
            id: "x", encryptedKey: key, encryptedData: data, updatedAt: nil, deletedAt: nil)
        let relu = try VaultStore.decrypt(dto, with: resultat.account())
        XCTAssertEqual(
            relu.name, "Forgejo",
            "le coffre ne se relit plus après récupération : la clé du coffre n'a pas survécu")
    }

    /// Une clé fausse ne doit pas ouvrir le coffre — et doit échouer ici, dans le cœur,
    /// pas seulement au refus du serveur.
    func testUneCleFausseEstRefusee() throws {
        let inscription = try register(password: motDePasse, email: mail)
        let blobs = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(inscription.blob().utf8)) as? [String: Any])
        let kdf = try parametresKdf(blobs)
        let clePrivee = try XCTUnwrap(blobs["encrypted_private_key"] as? String)
        let kit = try XCTUnwrap(
            try JSONSerialization.jsonObject(
                with: Data(try inscription.account().createRecovery().utf8)) as? [String: Any])
        let uskRecuperation = try XCTUnwrap(kit["encrypted_user_key_recovery"] as? String)

        XCTAssertThrowsError(
            try recover(
                recoveryKey: "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", email: mail,
                newPassword: "nouveau mot de passe maître", kdfParamsJson: kdf,
                encryptedUserKeyRecovery: uskRecuperation, encryptedPrivateKey: clePrivee),
            "une clé de récupération fausse a été acceptée")
    }
}

// ─── Import CSV ───────────────────────────────────────────────────────────────

/// Un import est irréversible à l'échelle d'un coffre : deux cents entrées mal lues se
/// reprennent une par une. Ce qui casse silencieusement, ce sont les cas de bord du format
/// — un mot de passe qui contient une virgule, un guillemet, un saut de ligne — et les
/// noms de colonnes, qui diffèrent d'un gestionnaire à l'autre. Les vecteurs ci-dessous
/// sont ceux du parseur de la web app, pour que le même fichier donne le même coffre.
///
/// Les littéraux emploient les délimiteurs étendus de Swift : un CSV contient des
/// guillemets, et `"""` au fil d'une ligne refermerait le littéral au mauvais endroit.
final class CsvImportTests: XCTestCase {
    private func login(_ item: VaultItem) throws -> Login {
        guard case .login(let login) = item.data else {
            throw XCTSkip("un Login était attendu")
        }
        return login
    }

    func testUnFichierSimpleSeLit() throws {
        let csv = #"""
            name,username,password,url
            GitHub,clara,s3cret,https://github.com
            """#
        let items = CsvImport.items(csv)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].name, "GitHub")
        let compte = try login(items[0])
        XCTAssertEqual(compte.username, "clara")
        XCTAssertEqual(compte.password, "s3cret")
        XCTAssertEqual(compte.uris, ["https://github.com"])
    }

    /// Une virgule dans un mot de passe est le cas qui casse un découpage naïf — et il
    /// donnerait un mot de passe tronqué, sans que rien ne le signale.
    func testUnChampEntreGuillemetsGardeSesVirgules() throws {
        let csv = #"""
            name,password
            Forgejo,"a,b,c"
            """#
        XCTAssertEqual(try login(CsvImport.items(csv)[0]).password, "a,b,c")
    }

    /// Deux guillemets consécutifs valent un guillemet littéral.
    func testUnGuillemetDoubleSeReduit() throws {
        let csv = #"""
            name,password
            Forgejo,"il a dit ""bonjour"""
            """#
        XCTAssertEqual(try login(CsvImport.items(csv)[0]).password, #"il a dit "bonjour""#)
    }

    func testUnSautDeLigneEchappeNeCoupePasLEnregistrement() {
        let csv = "name,password\n\"Deux\nlignes\",s3cret\n"
        let items = CsvImport.items(csv)
        XCTAssertEqual(items.count, 1, "le saut de ligne échappé a coupé l'enregistrement")
        XCTAssertEqual(items[0].name, "Deux\nlignes")
    }

    /// Chaque gestionnaire nomme ses colonnes à sa façon. La table d'équivalences est ce
    /// qui rend l'import utilisable sans retoucher le fichier à la main.
    func testLesColonnesDesConcurrentsSontReconnues() throws {
        let bitwarden = #"""
            folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp
            Travail,,login,Forgejo,,,https://git.stackops.ch,clara,s3cret,GEZDGNBVGY3TQOJQ
            """#
        let items = CsvImport.items(bitwarden)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].name, "Forgejo")
        XCTAssertEqual(items[0].folder, "Travail")
        let compte = try login(items[0])
        XCTAssertEqual(compte.username, "clara")
        XCTAssertEqual(compte.password, "s3cret")
        XCTAssertEqual(compte.uris, ["https://git.stackops.ch"])
        XCTAssertEqual(compte.totp, "GEZDGNBVGY3TQOJQ")

        let chrome = #"""
            name,url,username,password
            GitHub,https://github.com,clara,s3cret
            """#
        XCTAssertEqual(CsvImport.items(chrome).first?.name, "GitHub")

        let onepassword = #"""
            title,website,login,password
            Amazon,https://amazon.fr,clara,s3cret
            """#
        let un = CsvImport.items(onepassword)
        XCTAssertEqual(un.first?.name, "Amazon")
        XCTAssertEqual(try login(un[0]).username, "clara")
    }

    /// Les exports sèment des lignes vides ; les avaler produirait des entrées fantômes.
    func testLesLignesVidesSontIgnorees() {
        XCTAssertEqual(CsvImport.items("name,password\n\nGitHub,s3cret\n\n\n").count, 1)
    }

    func testUnFichierSansEnregistrementNeDonneRien() {
        XCTAssertTrue(CsvImport.items("").isEmpty)
        XCTAssertTrue(
            CsvImport.items("name,password").isEmpty, "l'en-tête seul n'est pas une entrée")
    }

    /// Une colonne absente ne doit pas décaler les suivantes ni faire échouer la lecture.
    func testUneLigneTropCourteSeCompleteEnVide() throws {
        let csv = #"""
            name,username,password,url
            GitHub,clara
            """#
        let items = CsvImport.items(csv)
        XCTAssertEqual(items.count, 1)
        let compte = try login(items[0])
        XCTAssertEqual(compte.password, "")
        XCTAssertTrue(compte.uris.isEmpty, "une adresse vide ne doit pas produire d'URI vide")
    }

    /// Sans nom, l'entrée reste identifiable dans la liste plutôt que d'y figurer en blanc.
    func testUneEntreeSansNomEnRecoitUn() {
        let csv = #"""
            name,username,password
            ,clara,s3cret
            """#
        XCTAssertFalse(CsvImport.items(csv).first?.name.isEmpty ?? true)
    }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

/// Un coffre doit pouvoir sortir aussi librement qu'il est entré. Le test qui compte est
/// l'aller-retour : ce que l'export écrit, l'import doit le relire à l'identique. Sans
/// cela, on découvrirait le problème le jour où l'on quitte l'application — c'est-à-dire
/// trop tard pour s'en plaindre.
final class CsvExportTests: XCTestCase {
    private func entree(
        _ nom: String, _ utilisateur: String, _ motDePasse: String,
        adresse: String = "", dossier: String? = nil, totp: String? = nil
    ) -> VaultEntry {
        VaultEntry(
            id: nom,
            item: VaultItem(
                name: nom, notes: nil, folder: dossier,
                data: .login(
                    Login(
                        username: utilisateur, password: motDePasse,
                        uris: adresse.isEmpty ? [] : [adresse], totp: totp))),
            updatedAt: nil)
    }

    func testLEnteteEstCelleDeLaWebApp() {
        XCTAssertEqual(CsvExport.entete, "name,folder,url,username,password,totp")
    }

    /// L'aller-retour complet, avec les caractères qui cassent un format mal échappé.
    func testCeQuiSortSeRelitALIdentique() throws {
        let coffre = [
            entree("GitHub", "clara", "s3cret", adresse: "https://github.com", dossier: "Travail"),
            entree("Virgule", "clara", "a,b,c"),
            entree("Guillemet", "clara", #"il a dit "bonjour""#),
            entree("Décathlon", "clara@exemple.ch", "p@ss", adresse: "https://decathlon.fr"),
            entree("AvecCode", "clara", "s3cret", totp: "GEZDGNBVGY3TQOJQ"),
        ]

        let relus = CsvImport.items(CsvExport.texte(coffre))
        XCTAssertEqual(relus.count, coffre.count, "l'aller-retour a perdu ou inventé des entrées")

        for (origine, relu) in zip(coffre, relus) {
            XCTAssertEqual(relu.name, origine.item.name)
            XCTAssertEqual(relu.folder, origine.item.folder)
            guard case .login(let apres) = relu.data, let avant = origine.login else {
                return XCTFail("un Login était attendu")
            }
            XCTAssertEqual(apres.username, avant.username)
            XCTAssertEqual(
                apres.password, avant.password,
                "« \(origine.item.name) » : le mot de passe n'a pas survécu à l'aller-retour")
            XCTAssertEqual(apres.uris, avant.uris)
            XCTAssertEqual(apres.totp, avant.totp)
        }
    }

    /// Un saut de ligne dans un champ ne doit pas couper l'enregistrement à la relecture.
    func testUnSautDeLigneSurvitALAllerRetour() throws {
        let coffre = [entree("Deux\nlignes", "clara", "s3cret")]
        let relus = CsvImport.items(CsvExport.texte(coffre))
        XCTAssertEqual(relus.count, 1)
        XCTAssertEqual(relus[0].name, "Deux\nlignes")
    }

    /// Une note et une carte n'ont pas d'identifiants : leurs colonnes restent vides plutôt
    /// que de décaler la ligne.
    func testUnElementSansIdentifiantsNeCassePasLaLigne() {
        let note = VaultEntry(
            id: "n",
            item: VaultItem(
                name: "Note", notes: nil, folder: nil,
                data: .secureNote(SecureNote(content: "x"))),
            updatedAt: nil)
        let lignes = CsvExport.texte([note]).components(separatedBy: "\n")
        XCTAssertEqual(lignes.count, 2)
        XCTAssertEqual(lignes[1], #""Note","","","","","""#)
    }

    func testLeNomDeFichierPorteLaDate() {
        let date = Date(timeIntervalSince1970: 1_787_000_000)
        XCTAssertTrue(
            CsvExport.nomDeFichier(date).hasSuffix(".csv"),
            "le nom de fichier doit garder son extension")
        XCTAssertTrue(CsvExport.nomDeFichier(date).contains("2026-"))
    }
}

// ─── Icônes des sites ─────────────────────────────────────────────────────────

/// Les icônes viennent du proxy du serveur de l'utilisateur, jamais d'un tiers : c'est ce
/// qui empêche Google — ou n'importe qui d'autre — d'apprendre quels sites contient le
/// coffre. Ces tests vérifient que l'adresse construite reste bien celle de ce serveur.
final class FaviconTests: XCTestCase {
    private let serveur = "https://ghostpass.stackops.ch"

    func testLAdresseViseLeProxyDuServeur() throws {
        let url = try XCTUnwrap(
            Favicon.url(pour: "https://www.decathlon.fr/rayon", serveur: serveur))
        XCTAssertEqual(
            url.host, "ghostpass.stackops.ch", "l'icône ne doit venir que de notre serveur")
        XCTAssertEqual(url.path, "/api/icons")
        let composants = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(
            composants.queryItems?.first(where: { $0.name == "domain" })?.value, "decathlon.fr",
            "le sous-domaine « www. » et le chemin doivent être écartés")
    }

    /// Sans domaine exploitable, pas de requête du tout : une pastille d'initiale suffit.
    func testUneAdresseInexploitableNeDonneAucuneUrl() {
        XCTAssertNil(Favicon.url(pour: "", serveur: serveur))
        XCTAssertNil(Favicon.url(pour: "localhost", serveur: serveur))
        XCTAssertNil(
            Favicon.url(pour: "http://192.168.1.10:8080", serveur: serveur),
            "une IP n'est pas un domaine")
        XCTAssertNil(Favicon.url(pour: "https://decathlon.fr", serveur: ""))
    }

    /// La couleur de repli est déterministe et partagée avec la web app : le même élément
    /// doit garder la même pastille d'un écran à l'autre, et d'un lancement au suivant.
    func testLaCouleurDeReplyEstStable() {
        XCTAssertEqual(Favicon.couleur(pour: "GitHub"), Favicon.couleur(pour: "GitHub"))
        XCTAssertEqual(Favicon.initiale("décathlon"), "D")
        XCTAssertEqual(Favicon.initiale("  forgejo"), "F")
        XCTAssertEqual(Favicon.initiale(""), "?")
    }
}

// ─── Verrouillage différé ─────────────────────────────────────────────────────

/// La décision de refermer le coffre au retour dans l'application. Elle se prend sur des
/// dates, et une erreur de sens laisserait un coffre ouvert qu'on croit fermé — c'est
/// exactement le genre de défaut qu'aucun essai à la main ne révèle, puisqu'il faudrait
/// attendre un quart d'heure pour le voir.
final class VerrouillageTests: XCTestCase {
    private let sortie = Date(timeIntervalSince1970: 1_787_000_000)

    /// Sans délai, on referme quoi qu'il arrive : c'est le réglage par défaut.
    func testSansDelaiOnRefermeToujours() {
        XCTAssertTrue(
            VaultStore.doitVerrouiller(sortie: sortie, delai: nil, maintenant: sortie))
        XCTAssertTrue(
            VaultStore.doitVerrouiller(
                sortie: sortie, delai: nil, maintenant: sortie.addingTimeInterval(0.1)))
    }

    func testAvantLeDelaiLeCoffreResteOuvert() {
        XCTAssertFalse(
            VaultStore.doitVerrouiller(
                sortie: sortie, delai: 300, maintenant: sortie.addingTimeInterval(299)))
    }

    /// Au délai pile, on referme. Un « strictement supérieur » laisserait passer le cas
    /// limite, et le cas limite est celui qu'on teste.
    func testAuDelaiPileOnReferme() {
        XCTAssertTrue(
            VaultStore.doitVerrouiller(
                sortie: sortie, delai: 300, maintenant: sortie.addingTimeInterval(300)))
        XCTAssertTrue(
            VaultStore.doitVerrouiller(
                sortie: sortie, delai: 300, maintenant: sortie.addingTimeInterval(301)))
    }

    /// Une horloge qui recule — fuseau, correction NTP — donnerait un écart négatif. Sans
    /// ce garde-fou, le coffre resterait ouvert indéfiniment.
    func testUneHorlogeQuiReculeRefermeLeCoffre() {
        XCTAssertTrue(
            VaultStore.doitVerrouiller(
                sortie: sortie, delai: 900, maintenant: sortie.addingTimeInterval(-3600)))
    }

    /// Les délais proposés sont ceux qu'annoncent les libellés.
    func testLesDelaisCorrespondentAuxLibelles() {
        XCTAssertNil(Verrouillage.immediat.delai)
        XCTAssertEqual(Verrouillage.uneMinute.delai, 60)
        XCTAssertEqual(Verrouillage.cinqMinutes.delai, 300)
        XCTAssertEqual(Verrouillage.quinzeMinutes.delai, 900)
    }
}

// ─── Accès d'urgence ──────────────────────────────────────────────────────────

final class AccesDUrgenceTests: XCTestCase {
    private func dto(
        role: String = "view", status: String = "invited", waitDays: Int = 7,
        requestedAt: Int? = nil, available: Bool? = nil
    ) -> EmergencyContactDTO {
        EmergencyContactDTO(
            id: "lien-1", contactEmail: "kevin@stackops.ch", role: role, waitDays: waitDays,
            status: status, requestedAt: requestedAt, available: available)
    }

    func testUnLienValideSeTraduitFidelement() throws {
        let lien = try XCTUnwrap(LienDUrgence(dto(role: "takeover", status: "requested")))
        XCTAssertEqual(lien.contactEmail, "kevin@stackops.ch")
        XCTAssertEqual(lien.role, .takeover)
        XCTAssertEqual(lien.etat, .requested)
        XCTAssertEqual(lien.waitDays, 7)
    }

    /// Un rôle ou un état que l'application ne connaît pas ne doit pas produire une ligne
    /// muette dans l'écran : mieux vaut ne rien afficher que d'afficher n'importe quoi.
    func testUnRoleInconnuEstEcarte() {
        XCTAssertNil(LienDUrgence(dto(role: "administrateur")))
    }

    func testUnEtatInconnuEstEcarte() {
        XCTAssertNil(LienDUrgence(dto(status: "en_cours_de_reflexion")))
    }

    /// Le serveur renvoie des millisecondes ; les confondre avec des secondes placerait la
    /// demande en 1970 et l'ouverture prévue juste après.
    func testLHorodatageEstLuEnMillisecondes() throws {
        let quandEnMs = 1_800_000_000_000
        let lien = try XCTUnwrap(
            LienDUrgence(dto(status: "requested", requestedAt: quandEnMs)))
        XCTAssertEqual(
            try XCTUnwrap(lien.requestedAt).timeIntervalSince1970, 1_800_000_000, accuracy: 1)
    }

    func testLOuverturePrevueTombeApresLeDelai() throws {
        let depart = 1_800_000_000_000
        let lien = try XCTUnwrap(
            LienDUrgence(dto(status: "requested", waitDays: 3, requestedAt: depart)))
        let attendue = Date(timeIntervalSince1970: 1_800_000_000 + 3 * 86_400)
        XCTAssertEqual(
            try XCTUnwrap(lien.ouverturePrevue()).timeIntervalSince1970,
            attendue.timeIntervalSince1970, accuracy: 1)
    }

    /// Sans demande en cours, il n'y a pas de date à annoncer — et en inventer une ferait
    /// croire à un compte à rebours qui n'a pas commencé.
    func testAucuneOuverturePrevueSansDemande() throws {
        let accepte = try XCTUnwrap(LienDUrgence(dto(status: "accepted", requestedAt: nil)))
        XCTAssertNil(accepte.ouverturePrevue())
        let invite = try XCTUnwrap(
            LienDUrgence(dto(status: "invited", requestedAt: 1_800_000_000_000)))
        XCTAssertNil(invite.ouverturePrevue())
    }

    /// `available` n'existe que dans le sens « je suis le contact ». Absent, il vaut faux :
    /// on n'ouvre pas un coffre parce qu'un champ manquait.
    func testLaDisponibiliteAbsenteVautFaux() throws {
        XCTAssertFalse(try XCTUnwrap(LienDUrgence(dto(available: nil))).disponible)
        XCTAssertTrue(
            try XCTUnwrap(LienDUrgence(dto(status: "granted", available: true))).disponible)
    }

    @MainActor
    func testLesLibellesDesRolesSontTraduits() {
        for role in RoleDUrgence.allCases {
            XCTAssertFalse(role.intitule.isEmpty, "intitulé vide pour \(role.rawValue)")
            XCTAssertFalse(role.explication.isEmpty, "explication vide pour \(role.rawValue)")
        }
    }
}

// ─── Organisations ────────────────────────────────────────────────────────────

final class OrganisationsTests: XCTestCase {
    private func dto(role: String = "member", status: String = "active") -> OrgSummaryDTO {
        OrgSummaryDTO(orgId: "org-1", name: "Équipe Sécurité", role: role, status: status)
    }

    func testUneOrganisationValideSeTraduitFidelement() throws {
        let org = try XCTUnwrap(Organisation(dto(role: "admin", status: "invited")))
        XCTAssertEqual(org.id, "org-1")
        XCTAssertEqual(org.nom, "Équipe Sécurité")
        XCTAssertEqual(org.role, .admin)
        XCTAssertEqual(org.etat, .invited)
    }

    /// Un rôle que cette version ne connaît pas ne doit pas produire une ligne muette : on
    /// préfère ne rien afficher qu'afficher une équipe dont on ignore ce qu'on y peut.
    func testUnRoleInconnuEstEcarte() {
        XCTAssertNil(Organisation(dto(role: "owner")))
    }

    func testUnEtatInconnuEstEcarte() {
        XCTAssertNil(Organisation(dto(status: "pending")))
    }

    /// La lecture seule est le seul rôle qui n'écrit pas. Se tromper ici proposerait un
    /// bouton « ajouter » que le serveur refuserait ensuite — une promesse non tenue.
    func testSeuleLaLectureSeuleNEcritPas() {
        XCTAssertFalse(RoleDOrganisation.readonly.peutEcrire)
        XCTAssertTrue(RoleDOrganisation.member.peutEcrire)
        XCTAssertTrue(RoleDOrganisation.admin.peutEcrire)
    }

    @MainActor
    func testLesLibellesDesRolesEtEtatsSontTraduits() {
        for role in [RoleDOrganisation.admin, .member, .readonly] {
            XCTAssertFalse(role.intitule.isEmpty, "intitulé vide pour \(role.rawValue)")
        }
        for etat in [EtatDAppartenance.invited, .active, .revoked] {
            XCTAssertFalse(etat.intitule.isEmpty, "intitulé vide pour \(etat.rawValue)")
        }
    }

    /// Le coffre partagé et le coffre personnel ouvrent la même enveloppe : c'est ce que le
    /// protocole garantit, et c'est ce qui permet de n'écrire ce code qu'une fois.
    func testLeCoffreDEquipeOuvreLaMemeEnveloppeQueLeCompte() throws {
        let inscription = try register(
            password: "correct horse battery staple", email: "clara@test.ch")
        let compte = inscription.account()
        let creation = try compte.createOrg()
        let org = creation.org()

        let item = VaultItem(
            name: "Serveur de production", notes: nil, folder: nil,
            data: .login(Login(username: "root", password: "s3cr3t")))
        let json = String(data: try JSONEncoder().encode(item), encoding: .utf8) ?? "{}"
        let chiffre = try org.encryptItem(itemJson: json)

        // Le DTO tel que le serveur le rendrait.
        struct Enveloppe: Decodable {
            let encryptedKey: String
            let encryptedData: String
            enum CodingKeys: String, CodingKey {
                case encryptedKey = "encrypted_key"
                case encryptedData = "encrypted_data"
            }
        }
        let e = try JSONDecoder().decode(Enveloppe.self, from: Data(chiffre.utf8))
        let dto = EncryptedItemDTO(
            id: "item-1", encryptedKey: e.encryptedKey, encryptedData: e.encryptedData)

        let relu = try org.ouvrir(dto)
        XCTAssertEqual(relu.name, "Serveur de production")

        // Et le compte, lui, ne peut pas l'ouvrir : ce n'est pas sa clé.
        XCTAssertThrowsError(try compte.ouvrir(dto))
    }
}

// ─── Administration d'équipe ──────────────────────────────────────────────────

final class AdministrationDEquipeTests: XCTestCase {
    private func membre(id: String, email: String?, role: String = "member") -> MembreDEquipe? {
        MembreDEquipe(
            OrgMemberDTO(userId: id, email: email, role: role, status: "active"))
    }

    func testUnMembreValideSeTraduitFidelement() throws {
        let m = try XCTUnwrap(membre(id: "u1", email: "kevin@stackops.ch", role: "readonly"))
        XCTAssertEqual(m.id, "u1")
        XCTAssertEqual(m.email, "kevin@stackops.ch")
        XCTAssertEqual(m.role, .readonly)
        XCTAssertEqual(m.etat, .active)
    }

    func testUnMembreSansAdresseResteUtilisable() throws {
        // Le serveur peut rendre `email: null` ; la ligne doit tout de même s'afficher,
        // sous l'identifiant, plutôt que de disparaître de la liste des membres.
        let m = try XCTUnwrap(membre(id: "u2", email: nil))
        XCTAssertNil(m.email)
        XCTAssertEqual(m.id, "u2")
    }

    @MainActor
    func testLesDroitsSurCollectionSontTousTraduits() {
        for droit in DroitSurCollection.allCases {
            XCTAssertFalse(droit.intitule.isEmpty, "intitulé vide pour \(droit.rawValue)")
        }
        XCTAssertEqual(DroitSurCollection.allCases.map(\.rawValue), ["read", "write", "manage"])
    }

    /// Le refus de rotation doit nommer la personne concernée : « rotation annulée » sans
    /// dire de qui il s'agit laisserait l'administrateur sans rien à faire.
    @MainActor
    func testLeRefusDeRotationNommeLaPersonne() {
        let message = RotationImpossible.cleIntrouvable(membre: "kevin@stackops.ch").message
        XCTAssertTrue(
            message.contains("kevin@stackops.ch"),
            "le refus ne nomme pas la personne : « \(message) »")
    }

    /// Une rotation ré-enveloppe les items **sans** toucher au contenu chiffré. Si le
    /// contenu changeait, ce ne serait plus une rotation de clé mais un re-chiffrement
    /// complet — beaucoup plus coûteux, et inutile.
    func testLaRotationNeReChiffrePasLeContenu() throws {
        let compte = try register(password: "correct horse battery staple", email: "clara@test.ch")
            .account()
        let ancienne = try compte.createOrg().org()
        let nouvelle = try compte.createOrg().org()

        let item = VaultItem(
            name: "Base de production", notes: nil, folder: nil,
            data: .login(Login(username: "admin", password: "tr3s-secret")))
        let json = String(data: try JSONEncoder().encode(item), encoding: .utf8) ?? "{}"
        let chiffre = try ancienne.encryptItem(itemJson: json)
        let refait = try nouvelle.rewrapItem(oldOrg: ancienne, encryptedItemJson: chiffre)

        struct Enveloppe: Decodable {
            let encryptedKey: String
            let encryptedData: String
            enum CodingKeys: String, CodingKey {
                case encryptedKey = "encrypted_key"
                case encryptedData = "encrypted_data"
            }
        }
        let avant = try JSONDecoder().decode(Enveloppe.self, from: Data(chiffre.utf8))
        let apres = try JSONDecoder().decode(Enveloppe.self, from: Data(refait.utf8))
        XCTAssertEqual(avant.encryptedData, apres.encryptedData, "le contenu a été re-chiffré")
        XCTAssertNotEqual(avant.encryptedKey, apres.encryptedKey, "l'enveloppe n'a pas changé")

        // Et la conséquence qui compte : l'ancienne clé ne lit plus l'item ré-enveloppé.
        let dto = EncryptedItemDTO(
            id: "i1", encryptedKey: apres.encryptedKey, encryptedData: apres.encryptedData)
        XCTAssertNoThrow(try nouvelle.ouvrir(dto))
        XCTAssertThrowsError(try ancienne.ouvrir(dto))
    }
}

// ─── Import depuis les gestionnaires concurrents ──────────────────────────────

/// Un export par gestionnaire, avec ses en-têtes réels. Migrer est le premier geste d'un
/// nouvel utilisateur : ce qui se perd ici se perd pour de bon, et en silence.
final class ImportDepuisConcurrentsTests: XCTestCase {
    private func seul(_ csv: String) throws -> VaultItem {
        let items = CsvImport.items(csv)
        XCTAssertEqual(items.count, 1, "une seule ligne attendue")
        return try XCTUnwrap(items.first)
    }

    /// L'identifiant que porte un item. `login` est une commodité de `VaultEntry`, pas de
    /// `VaultItem` — ici on n'a que ce dernier, avant tout dépôt.
    private func identifiant(_ item: VaultItem) throws -> Login {
        guard case .login(let l) = item.data else {
            throw XCTSkip("l'item importé n'est pas un identifiant")
        }
        return l
    }

    func testBitwarden() throws {
        let item = try seul(
            """
            folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
            Travail,0,login,Forgejo,Compte de service — ne pas partager,,0,https://git.example.ch,clara,s3cr3t,JBSWY3DPEHPK3PXP
            """)
        XCTAssertEqual(item.name, "Forgejo")
        XCTAssertEqual(item.folder, "Travail")
        XCTAssertEqual(item.notes, "Compte de service — ne pas partager")
        XCTAssertEqual(try identifiant(item).username, "clara")
        XCTAssertEqual(try identifiant(item).password, "s3cr3t")
        XCTAssertEqual(try identifiant(item).uris, ["https://git.example.ch"])
        XCTAssertEqual(try identifiant(item).totp, "JBSWY3DPEHPK3PXP")
    }

    func test1Password() throws {
        let item = try seul(
            """
            Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes
            Forgejo,https://git.example.ch,clara,s3cr3t,otpauth://totp/x,false,false,Travail,Note de migration
            """)
        XCTAssertEqual(item.name, "Forgejo")
        XCTAssertEqual(item.folder, "Travail", "Tags sert de dossier")
        XCTAssertEqual(item.notes, "Note de migration")
        XCTAssertEqual(try identifiant(item).totp, "otpauth://totp/x")
    }

    /// LastPass nomme la note `extra` et le dossier `grouping` : deux colonnes qu'aucune
    /// autre n'emploie, et que l'ancienne table ignorait toutes les deux.
    func testLastPass() throws {
        let item = try seul(
            """
            url,username,password,totp,extra,name,grouping,fav
            https://git.example.ch,clara,s3cr3t,JBSWY3DPEHPK3PXP,Ma note LastPass,Forgejo,Travail,0
            """)
        XCTAssertEqual(item.name, "Forgejo")
        XCTAssertEqual(item.folder, "Travail")
        XCTAssertEqual(item.notes, "Ma note LastPass")
    }

    func testDashlane() throws {
        let item = try seul(
            """
            username,username2,username3,title,password,note,url,category,otpSecret
            clara,,,Forgejo,s3cr3t,Note Dashlane,https://git.example.ch,Travail,JBSWY3DPEHPK3PXP
            """)
        XCTAssertEqual(item.name, "Forgejo")
        XCTAssertEqual(item.folder, "Travail")
        XCTAssertEqual(item.notes, "Note Dashlane")
        XCTAssertEqual(try identifiant(item).totp, "JBSWY3DPEHPK3PXP")
    }

    func testChrome() throws {
        let item = try seul(
            """
            name,url,username,password,note
            git.example.ch,https://git.example.ch,clara,s3cr3t,Note Chrome
            """)
        XCTAssertEqual(item.name, "git.example.ch")
        XCTAssertEqual(item.notes, "Note Chrome")
    }

    func testKeePass() throws {
        let item = try seul(
            """
            "Group","Title","Username","Password","URL","Notes"
            "Travail","Forgejo","clara","s3cr3t","https://git.example.ch","Note KeePass"
            """)
        XCTAssertEqual(item.name, "Forgejo")
        XCTAssertEqual(item.folder, "Travail")
        XCTAssertEqual(item.notes, "Note KeePass")
    }

    /// Une note contenant une virgule, un saut de ligne et des guillemets doit survivre :
    /// c'est le cas courant d'une note de plusieurs lignes, et celui qui casse les analyses
    /// naïves.
    func testUneNoteMultilignePasseEntiere() throws {
        let csv = #"""
            name,username,password,notes
            Forgejo,clara,s3cr3t,"Première ligne, avec virgule
            Deuxième ligne avec ""guillemets"""
            """#
        let item = try seul(csv)
        XCTAssertEqual(
            item.notes, "Première ligne, avec virgule\nDeuxième ligne avec \"guillemets\"")
    }
}

// ─── Partage ponctuel ─────────────────────────────────────────────────────────

/// Le partage est la seule fonctionnalité où un secret quitte le coffre. Ce qui compte
/// n'est donc pas qu'il marche, mais qu'il ne livre rien de plus qu'on ne l'a voulu.
final class PartagePonctuelTests: XCTestCase {
    func testUnSecretSeRouvreAvecSaCle() throws {
        let scelle = try sealSend(plaintext: "le code du coffre : 4821")
        XCTAssertEqual(
            try openSend(key: scelle.key, nonce: scelle.nonce, ciphertext: scelle.ciphertext),
            "le code du coffre : 4821")
    }

    /// Sans la clé, le serveur ne détient qu'un chiffre — c'est tout l'objet du fragment
    /// d'URL, que les navigateurs n'envoient jamais.
    func testUneAutreCleNOuvreRien() throws {
        let scelle = try sealSend(plaintext: "secret")
        let autre = try sealSend(plaintext: "autre")
        XCTAssertThrowsError(
            try openSend(key: autre.key, nonce: scelle.nonce, ciphertext: scelle.ciphertext))
    }

    /// Deux partages du même texte ne doivent pas se ressembler : sinon un serveur curieux
    /// saurait que deux personnes se sont transmis la même chose.
    func testDeuxPartagesDuMemeTexteDifferent() throws {
        let a = try sealSend(plaintext: "identique")
        let b = try sealSend(plaintext: "identique")
        XCTAssertNotEqual(a.ciphertext, b.ciphertext)
        XCTAssertNotEqual(a.key, b.key)
    }

    /// Le lien que produit l'application place la clé **après le `#`**. C'est ce qui la
    /// garde hors du serveur : le chemin et la requête lui sont transmis, pas le fragment.
    /// S'en remettre à l'habitude serait risqué — d'où ce test.
    func testLaCleVitDansLeFragmentEtNullePartAilleurs() throws {
        let scelle = try sealSend(plaintext: "secret")
        let fragment =
            scelle.key
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        var composants = try XCTUnwrap(URLComponents(string: "https://ghostpass.example.ch"))
        composants.path = "/s/abc123"
        composants.fragment = fragment

        let url = try XCTUnwrap(composants.url)
        XCTAssertEqual(url.fragment, fragment)
        XCTAssertFalse(url.path.contains(fragment), "la clé ne doit pas être dans le chemin")
        XCTAssertNil(url.query, "la clé ne doit pas être dans la requête")
    }

    /// Le fragment doit survivre à l'aller-retour vers l'encodage d'URL : un `+` ou un `/`
    /// mal traduit donnerait une clé fausse, et un partage illisible sans qu'on sache
    /// pourquoi.
    func testLaConversionDuFragmentEstReversible() throws {
        for _ in 0..<50 {
            let scelle = try sealSend(plaintext: "secret")
            let fragment =
                scelle.key
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            var rendu =
                fragment
                .replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/")
            rendu += String(repeating: "=", count: (4 - rendu.count % 4) % 4)
            XCTAssertEqual(rendu, scelle.key)
        }
    }
}

// ─── Journal du compte ────────────────────────────────────────────────────────

/// Le journal est le seul endroit où l'on peut s'apercevoir qu'un accès n'était pas le
/// sien. Une ligne illisible ou un signalement manquant lui font perdre son objet.
final class JournalDuCompteTests: XCTestCase {
    private func action(_ nom: String) -> ActionDuJournal {
        ActionDuJournal(
            AuditEventDTO(action: nom, target: nil, ip: nil, createdAt: 1_800_000_000_000), rang: 0)
    }

    @MainActor
    func testChaqueActionDuServeurEstTraduite() {
        // La liste vient de `recordAudit` côté serveur. Une action non traduite s'afficherait
        // sous son identifiant technique, que personne ne sait lire.
        let connues = [
            "login.password", "login.passkey", "login.sso", "logout",
            "mfa.enable", "mfa.disable", "recovery.reset",
            "passkey.add", "passkey.remove", "webauthn.add", "webauthn.remove",
            "emergency.grant", "emergency.request", "emergency.approve",
            "org.member.add", "org.member.role", "org.key.rotate",
            "org.group.create", "org.group.delete",
            "org.group.member.add", "org.group.member.remove",
            "org.group.access.grant", "org.group.access.revoke",
        ]
        for nom in connues {
            XCTAssertNotEqual(
                action(nom).intitule, nom,
                "« \(nom) » s'afficherait sous son identifiant technique")
        }
    }

    /// Une action inconnue doit s'afficher telle quelle, pas disparaître : un serveur plus
    /// récent peut en journaliser de nouvelles, et un journal dont l'objet est de révéler
    /// l'inattendu ne peut pas se permettre de masquer ce qu'il ne connaît pas.
    @MainActor
    func testUneActionInconnueResteVisible() {
        XCTAssertEqual(action("quelque.chose.de.neuf").intitule, "quelque.chose.de.neuf")
    }

    /// Ce qui retire une protection doit être signalé. Se tromper ici noierait la ligne
    /// qu'il fallait voir au milieu de connexions ordinaires.
    func testLesActionsQuiRetirentUneProtectionSontSignalees() {
        for nom in ["mfa.disable", "recovery.reset", "passkey.remove", "emergency.approve"] {
            XCTAssertTrue(action(nom).estSensible, "« \(nom) » devrait être signalée")
        }
        for nom in ["login.password", "logout", "org.group.create"] {
            XCTAssertFalse(action(nom).estSensible, "« \(nom) » ne devrait pas l'être")
        }
    }

    /// Le serveur horodate en millisecondes. Les lire en secondes placerait toutes les
    /// connexions en 1970 — et un journal aux dates fausses ne sert à rien.
    func testLesHorodatagesSontLusEnMillisecondes() {
        let connexion = Connexion(
            LoginEventDTO(
                ip: "10.0.0.1", userAgent: "GhostPass/iOS", newDevice: true,
                createdAt: 1_800_000_000_000),
            rang: 0)
        XCTAssertEqual(connexion.quand.timeIntervalSince1970, 1_800_000_000, accuracy: 1)
        XCTAssertTrue(connexion.nouvelAppareil)
    }
}

// ─── Adresse du serveur ───────────────────────────────────────────────────────

/// Taper le nom de son serveur est le geste naturel. Le refuser au motif qu'il manque
/// « https:// » fait échouer la toute première tentative de quelqu'un qui a pourtant donné
/// la bonne adresse — et le message d'erreur accuse alors l'adresse plutôt que le manque.
final class AdresseDuServeurTests: XCTestCase {
    private func url(_ saisie: String) -> String? {
        ServerAddress.normaliser(saisie)?.absoluteString
    }

    func testUnNomDeServeurSeulSuffit() {
        XCTAssertEqual(url("ghostpass.stackops.ch"), "https://ghostpass.stackops.ch")
    }

    func testLesEspacesAutourNeGenentPas() {
        XCTAssertEqual(url("  ghostpass.stackops.ch \n"), "https://ghostpass.stackops.ch")
    }

    /// Une barre finale doublerait les séparateurs des chemins construits ensuite.
    func testLaBarreFinaleEstRetiree() {
        XCTAssertEqual(url("https://ghostpass.stackops.ch/"), "https://ghostpass.stackops.ch")
    }

    func testUnSchemaExplicteEstRespecte() {
        XCTAssertEqual(url("https://ghostpass.stackops.ch"), "https://ghostpass.stackops.ch")
    }

    /// On ne force pas `http` en `https` : un serveur de développement sur une machine
    /// locale est un usage légitime, et le refuser n'apporterait aucune sécurité — la
    /// personne a écrit `http` exprès.
    func testHttpEstConserveTelQuel() {
        XCTAssertEqual(url("http://127.0.0.1:3111"), "http://127.0.0.1:3111")
    }

    /// Un serveur local parle en clair. Lui imposer `https` produisait « une erreur TLS a
    /// provoqué l'échec de la connexion sécurisée » — un message qui décrit la conséquence
    /// et cache la cause. Trouvé en essayant le banc de remplissage automatique.
    func testLaBoucleLocaleResteEnClair() {
        XCTAssertEqual(url("127.0.0.1:3111"), "http://127.0.0.1:3111")
        XCTAssertEqual(url("localhost:3111"), "http://localhost:3111")
        XCTAssertEqual(url("LOCALHOST"), "http://LOCALHOST")
    }

    /// L'exception s'arrête à la boucle locale : un serveur sur un réseau privé peut
    /// légitimement porter un certificat, et rétrograder son adresse ne rendrait service
    /// à personne.
    func testUnReseauPriveResteEnHttps() {
        XCTAssertEqual(url("192.168.1.20:3111"), "https://192.168.1.20:3111")
        XCTAssertEqual(url("coffre.interne"), "https://coffre.interne")
    }

    func testUnPortEtUnCheminSontConserves() {
        XCTAssertEqual(url("ghostpass.stackops.ch:8443"), "https://ghostpass.stackops.ch:8443")
        XCTAssertEqual(url("exemple.ch/ghostpass"), "https://exemple.ch/ghostpass")
    }

    /// Ce qui doit rester refusé. Sans ces cas, la normalisation accepterait n'importe quoi
    /// et l'erreur reviendrait plus tard, plus loin, sous une forme moins compréhensible.
    func testCeQuiNeMeneNullePartEstRefuse() {
        XCTAssertNil(url(""))
        XCTAssertNil(url("   "))
        XCTAssertNil(url("ftp://exemple.ch"), "seuls http et https ont un sens ici")
        XCTAssertNil(url("https://"), "un schéma sans hôte ne mène nulle part")
    }
}
