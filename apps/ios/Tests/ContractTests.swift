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
        var options = GeneratorOptions(length: 40, lowercase: false, uppercase: false, digits: true, symbols: false)
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
            let resultat = try XCTUnwrap(Totp.code(for: config, at: Date(timeIntervalSince1970: instant)))
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
            Totp.parse("otpauth://totp/GhostPass:clara?secret=GEZDGNBVGY3TQOJQ&period=60&digits=8&algorithm=SHA256"))
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
        XCTAssertTrue(visibles.filter { SiteMatching.matches($0, domains: ["exemple.test"]) }.isEmpty)
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
        guard case .secureNote(let note) = relu.data else { return XCTFail("un SecureNote était attendu") }
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
            id: "n", item: VaultItem(name: "Note", notes: nil, folder: nil,
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
            "l'historique ne traverse pas le chiffrement — le champ `password_history` a changé de nom")
    }

    /// Le plafond est celui de la web app. S'il divergeait, un même coffre montrerait
    /// plus d'anciens mots de passe d'un côté que de l'autre, et on croirait à une perte.
    func testLePlafondEstCeluiDeLaWebApp() {
        XCTAssertEqual(VaultConstants.passwordHistoryLimit, 20)
    }
}
