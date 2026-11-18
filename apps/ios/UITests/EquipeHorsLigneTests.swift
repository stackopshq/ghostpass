import XCTest

/// Les coffres d'équipe quand le serveur ne répond plus, et ce que fait l'application
/// lorsqu'il revient.
///
/// Trois moments qu'aucun test ne couvrait, et que la relecture seule ne tranche pas :
/// l'application lisait-elle vraiment la copie locale des coffres d'équipe, et le bandeau
/// « Hors ligne » savait-il repartir sans qu'on verrouille ?
///
/// Le serveur est coupé puis rallumé **entre** les exécutions, par
/// `tools/ios/essai-equipe-hors-ligne.sh` : un test ne peut pas le faire lui-même, et
/// simuler l'absence de réseau autrement éprouverait le simulacre. L'ordre des tests est
/// donc celui de leurs numéros, chacun héritant de l'état que le précédent a laissé sur
/// l'appareil.
///
/// Les valeurs par défaut doivent rester alignées sur celles du script : `xcodebuild` ne
/// transmet aucun environnement au processus de test.
final class EquipeHorsLigneTests: XCTestCase {
    private lazy var env = ProcessInfo.processInfo.environment
    private var server: String { env["GHOSTPASS_SERVER"] ?? "http://127.0.0.1:3111" }
    private var email: String { env["GHOSTPASS_EMAIL"] ?? "clara@ghostpass.test" }
    private var master: String { env["GHOSTPASS_PASSWORD"] ?? "correct horse battery staple" }
    /// Le portier qu'ouvre le script : un `GET /allumer` rallume le serveur GhostPass.
    /// C'est le test qui choisit l'instant, parce qu'il est le seul à savoir quand le
    /// bandeau est vraiment là — une minuterie côté script rallumerait parfois avant.
    private var portier: String { env["GHOSTPASS_PORTIER"] ?? "http://127.0.0.1:3199" }

    private let equipe = "Nuit du 13"
    private let collection = "Serveurs"
    private let itemDEquipe = "Routeur du bureau"
    private let motDePasseDEquipe = "s3cret-equipe"

    override func setUp() {
        continueAfterFailure = false
    }

    // ─── Outils ───────────────────────────────────────────────────────────────

    private func shot(_ app: XCUIApplication, _ nom: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = nom
        a.lifetime = .keepAlways
        add(a)
    }

    /// Frappe un élément même si l'interface vient de changer : sur une vue encore en
    /// cours d'animation, `tap()` calcule {-1, -1} et le geste se perd en silence.
    private func taper(_ element: XCUIElement) {
        guard element.exists else { return }
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func remplir(_ app: XCUIApplication, _ id: String, _ texte: String) {
        let champ = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(champ.waitForExistence(timeout: 30), "champ « \(id) » absent")
        let frappable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"), object: champ)
        XCTAssertEqual(
            XCTWaiter().wait(for: [frappable], timeout: 15), .completed,
            "champ « \(id) » hors d'atteinte — voici l'écran :\n\(app.debugDescription)")
        champ.tap()
        app.typeText(texte)
    }

    /// Saisit un nom dans l'alerte qui vient de s'ouvrir, puis confirme.
    private func nommerDansLAlerte(_ app: XCUIApplication, _ nom: String) {
        let champ = app.alerts.textFields.firstMatch
        XCTAssertTrue(champ.waitForExistence(timeout: 15), "l'alerte de nommage ne s'ouvre pas")
        champ.tap()
        app.typeText(nom)
        app.alerts.buttons["Créer"].tap()
    }

    private func ecarterLaPropositionBiometrique(_ app: XCUIApplication) {
        let plusTard = app.buttons["button.laterBiometric"].firstMatch
        guard plusTard.waitForExistence(timeout: 15) else { return }
        for _ in 0..<5 {
            guard plusTard.exists else { return }
            taper(plusTard)
            let parti = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"), object: plusTard)
            if XCTWaiter().wait(for: [parti], timeout: 3) == .completed { return }
        }
    }

    /// Première connexion : serveur, compte, mot de passe maître.
    private func seConnecter(_ app: XCUIApplication) {
        let champServeur = app.descendants(matching: .any)
            .matching(identifier: "field.server").firstMatch
        if !champServeur.waitForExistence(timeout: 8) {
            let autre = app.buttons["button.switchAccount"]
            XCTAssertTrue(
                autre.waitForExistence(timeout: 20),
                "ni formulaire de connexion, ni bascule vers un autre compte")
            autre.tap()
        }
        remplir(app, "field.server", server)
        remplir(app, "field.email", email)
        remplir(app, "field.master", master)
        app.buttons["button.submit"].tap()
        XCTAssertTrue(
            coffreNavBar(app).waitForExistence(timeout: 180),
            "le coffre ne s'est pas ouvert — serveur injoignable ou identifiants refusés")
        _ = app.buttons["button.add"].waitForExistence(timeout: 60)
        ecarterLaPropositionBiometrique(app)
    }

    /// Réouverture d'une session déjà enregistrée : l'écran ne demande que le mot de passe.
    /// C'est l'état d'un téléphone qu'on rallume — avec ou sans réseau.
    private func deverrouiller(_ app: XCUIApplication) {
        let champ = app.descendants(matching: .any)
            .matching(identifier: "field.master").firstMatch
        XCTAssertTrue(
            champ.waitForExistence(timeout: 60),
            "aucune session enregistrée : lancez ce test après « test01EnLigne »")
        champ.tap()
        app.typeText(master)
        app.buttons["button.submit"].tap()
        XCTAssertTrue(
            coffreNavBar(app).waitForExistence(timeout: 180), "le coffre ne s'ouvre pas")
        ecarterLaPropositionBiometrique(app)
    }

    private func deplierLeMenu(_ app: XCUIApplication, jusqua identifiant: String) -> Bool {
        let menu = app.buttons["button.settings"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30), "le menu du coffre est absent")
        let entree = app.buttons[identifiant]
        for _ in 0..<4 {
            taper(menu)
            if entree.waitForExistence(timeout: 5) { return true }
        }
        return false
    }

    /// Le bandeau « Hors ligne ». Cherché par identifiant sur n'importe quel type
    /// d'élément : selon la version d'iOS, un `Label` se présente tantôt comme un
    /// élément conteneur, tantôt comme un texte.
    private func bandeauHorsLigne(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "banner.offline").firstMatch
    }

    /// Demande au portier de rallumer le serveur, et attend sa réponse.
    @discardableResult
    private func allumerLeServeur() -> Bool {
        guard let url = URL(string: portier + "/allumer") else { return false }
        let attente = DispatchSemaphore(value: 0)
        var ouvert = false
        URLSession.shared.dataTask(with: URLRequest(url: url, timeoutInterval: 60)) {
            _, reponse, _ in
            ouvert = (reponse as? HTTPURLResponse)?.statusCode == 200
            attente.signal()
        }.resume()
        _ = attente.wait(timeout: .now() + 70)
        return ouvert
    }

    /// Le serveur répond-il ? Le test l'interroge lui-même, plutôt que de compter les
    /// secondes depuis son lancement : `xcodebuild` construit, installe et démarre
    /// l'application avant que la première ligne ne s'exécute, et cette durée n'est pas
    /// la même deux fois.
    private func attendreLeServeur(_ delai: TimeInterval) -> Bool {
        let echeance = Date().addingTimeInterval(delai)
        guard let url = URL(string: server + "/api/auth/prelogin") else { return false }
        while Date() < echeance {
            var requete = URLRequest(url: url, timeoutInterval: 2)
            requete.httpMethod = "POST"
            requete.setValue("application/json", forHTTPHeaderField: "Content-Type")
            requete.httpBody = Data(#"{"email":"sonde@example.com"}"#.utf8)
            let attente = DispatchSemaphore(value: 0)
            var debout = false
            URLSession.shared.dataTask(with: requete) { _, reponse, _ in
                debout = reponse != nil
                attente.signal()
            }.resume()
            _ = attente.wait(timeout: .now() + 4)
            if debout { return true }
            Thread.sleep(forTimeInterval: 1)
        }
        return false
    }

    // ─── 1. Serveur debout : on fabrique l'équipe et on la laisse en cache ─────

    func test01EnLigne() throws {
        let app = XCUIApplication()
        app.launch()
        seConnecter(app)

        XCTAssertTrue(
            deplierLeMenu(app, jusqua: "button.organizations"),
            "le menu ne mène pas aux coffres partagés")
        taper(app.buttons["button.organizations"])

        let creer = app.buttons["button.newOrg"]
        XCTAssertTrue(
            creer.waitForExistence(timeout: 30), "l'écran des coffres partagés ne s'ouvre pas")
        taper(creer)
        nommerDansLAlerte(app, equipe)

        // Pas `firstMatch` sur l'identifiant seul : la ligne entière le porte aussi, parce
        // qu'elle regroupe ses enfants pour l'accessibilité — et son premier enfant est le
        // sélecteur de couleur de l'équipe. Taper dessus ouvre la palette, pas le coffre.
        let ouvrir = app.buttons.matching(identifier: "button.openOrg")
            .matching(NSPredicate(format: "label == %@", "Ouvrir le coffre")).firstMatch
        XCTAssertTrue(ouvrir.waitForExistence(timeout: 60), "l'équipe créée n'apparaît pas")
        taper(ouvrir)

        // Une équipe neuve n'a aucune collection : sans elle, rien ne peut être déposé.
        let admin = app.buttons["button.orgAdmin"]
        XCTAssertTrue(
            admin.waitForExistence(timeout: 60),
            "le coffre d'équipe ne s'ouvre pas — voici l'écran :\n\(app.debugDescription)")
        taper(admin)
        let nouvelleCollection = app.buttons["button.newCollection"]
        XCTAssertTrue(
            nouvelleCollection.waitForExistence(timeout: 30), "l'administration ne s'ouvre pas")
        taper(nouvelleCollection)
        nommerDansLAlerte(app, collection)

        // Créer une collection referme l'administration **et** le coffre : une
        // administration peut aussi faire tourner la clé, et l'écran préfère se rouvrir
        // sur des données fraîches plutôt que d'en montrer de périmées. On revient donc
        // à la liste des équipes, et il faut rouvrir le coffre.
        XCTAssertTrue(
            creer.waitForExistence(timeout: 60),
            "l'administration n'a pas rendu la main à la liste des équipes")
        taper(ouvrir)

        let ajouter = app.buttons["button.addOrgItem"]
        XCTAssertTrue(
            ajouter.waitForExistence(timeout: 60),
            "aucun ajout possible : la collection n'a pas été créée")
        taper(ajouter)
        remplir(app, "field.name", itemDEquipe)
        remplir(app, "field.username", "admin")
        remplir(app, "field.password", motDePasseDEquipe)
        app.buttons["button.save"].tap()
        XCTAssertTrue(
            app.staticTexts[itemDEquipe].waitForExistence(timeout: 60),
            "l'identifiant d'équipe n'apparaît pas dans la collection")
        shot(app, "1-collection-d-equipe")

        taper(app.buttons["button.closeOrgVault"])
        let fermerOrgs = app.buttons["button.closeOrgs"]
        if fermerOrgs.waitForExistence(timeout: 15) { taper(fermerOrgs) }

        // Une relance complète, serveur debout : c'est ce passage-là qui dépose la copie
        // locale des coffres d'équipe. Sans lui, le test suivant n'éprouverait rien.
        app.terminate()
        app.launch()
        deverrouiller(app)
        XCTAssertTrue(
            app.staticTexts[itemDEquipe].waitForExistence(timeout: 120),
            "la ligne d'équipe manque dans le coffre alors que le serveur répond")
        XCTAssertFalse(
            bandeauHorsLigne(app).exists,
            "le bandeau « Hors ligne » s'affiche alors que le serveur répond")
        shot(app, "2-coffre-en-ligne")
    }

    // ─── 2. Serveur coupé : la même ligne doit rester, en lecture seule ───────

    func test02HorsLigne() throws {
        let app = XCUIApplication()
        app.launch()
        deverrouiller(app)

        XCTAssertTrue(
            bandeauHorsLigne(app).waitForExistence(timeout: 120),
            "rien n'indique que le coffre affiché vient de l'appareil")
        XCTAssertTrue(
            app.staticTexts[itemDEquipe].waitForExistence(timeout: 60),
            "le coffre d'équipe a disparu hors ligne")
        shot(app, "3-equipe-hors-ligne")

        // Ouvrir la ligne : le mot de passe doit se lire — donc la clé de l'équipe a bien
        // été relue depuis la copie locale — et « Modifier » ne doit pas être proposé.
        let ligne = app.buttons["\(itemDEquipe), admin"].firstMatch
        if ligne.waitForExistence(timeout: 15) {
            taper(ligne)
        } else {
            taper(app.staticTexts[itemDEquipe].firstMatch)
        }
        let reveler = app.buttons["button.reveal"].firstMatch
        XCTAssertTrue(
            reveler.waitForExistence(timeout: 30),
            "l'écran de détail ne s'ouvre pas sur l'élément d'équipe")
        taper(reveler)
        XCTAssertTrue(
            app.staticTexts[motDePasseDEquipe].waitForExistence(timeout: 30),
            "le mot de passe d'équipe ne se déchiffre pas hors ligne")
        XCTAssertFalse(
            app.buttons["button.edit"].exists,
            "« Modifier » est proposé sur un élément d'équipe lu depuis la copie locale")
        shot(app, "4-detail-hors-ligne")
    }

    // ─── 3. Le réseau revient : le bandeau doit repartir tout seul ────────────

    /// Le serveur est rallumé une fois le bandeau à l'écran, et plus rien n'est touché :
    /// c'est le réessai périodique qui doit le faire disparaître, et lui seul.
    func test03LeReseauRevient() throws {
        let app = XCUIApplication()
        app.launch()
        deverrouiller(app)

        let bandeauVisible = bandeauHorsLigne(app)
        XCTAssertTrue(
            bandeauVisible.waitForExistence(timeout: 120),
            "le coffre ne se dit pas hors ligne alors que le serveur est coupé")
        shot(app, "5-avant-le-retour")
        XCTAssertTrue(allumerLeServeur(), "le portier n'a pas rallumé le serveur")
        XCTAssertTrue(attendreLeServeur(60), "le serveur rallumé ne répond pas")

        let parti = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: bandeauVisible)
        XCTAssertEqual(
            XCTWaiter().wait(for: [parti], timeout: 120), .completed,
            "le bandeau est resté alors que le serveur répond de nouveau : rien n'a réessayé")
        shot(app, "6-apres-le-retour")
    }

    // ─── 4. Le toucher : réessai immédiat, sans attendre le tour suivant ──────

    /// Le serveur est rallumé une fois le bandeau à l'écran, puis le bandeau est touché —
    /// en se plaçant loin du prochain réessai périodique, sans quoi la disparition
    /// observée pourrait venir de lui et non du geste.
    func test04ToucherLeBandeau() throws {
        let app = XCUIApplication()
        app.launch()
        deverrouiller(app)

        let bandeauVisible = bandeauHorsLigne(app)
        XCTAssertTrue(
            bandeauVisible.waitForExistence(timeout: 120),
            "le coffre ne se dit pas hors ligne alors que le serveur est coupé")
        // L'instant où le bandeau paraît est aussi celui où son réessai périodique
        // commence à compter : les tours suivants tombent trente secondes plus tard,
        // puis toutes les trente secondes.
        let apparition = Date()

        XCTAssertTrue(allumerLeServeur(), "le portier n'a pas rallumé le serveur")
        XCTAssertTrue(attendreLeServeur(60), "le serveur rallumé ne répond pas")

        // Se placer dans les douze premières secondes d'un tour : le prochain réessai
        // automatique est alors à plus de quinze secondes, et la fenêtre d'observation
        // ne peut pas lui être attribuée.
        while Date().timeIntervalSince(apparition).truncatingRemainder(dividingBy: 30) > 12 {
            Thread.sleep(forTimeInterval: 1)
        }
        taper(bandeauVisible)

        let parti = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: bandeauVisible)
        XCTAssertEqual(
            XCTWaiter().wait(for: [parti], timeout: 15), .completed,
            "toucher le bandeau n'a rien réessayé")
        shot(app, "7-apres-le-toucher")
    }
}
