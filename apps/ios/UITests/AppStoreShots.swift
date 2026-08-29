import XCTest

/// Les captures d'écran de la fiche App Store.
///
/// Apple en exige aux dimensions exactes de l'appareil : un fichier redimensionné après
/// coup est refusé. `XCUIScreen.main.screenshot()` rend la résolution native du simulateur
/// — 1320 × 2868 sur un 6,9 pouces — ce qu'aucun recadrage ultérieur ne saurait produire
/// fidèlement.
///
/// Ce n'est pas un test : rien n'est vérifié qui ne le soit ailleurs. C'est un scénario de
/// prise de vue, rangé ici parce que seule la cible de test sait piloter l'application.
/// `run-ios-tests.sh` ne le lance pas — il nomme ses tests un par un — et `captures-appstore.sh`
/// ne lance que lui.
///
/// Les écrans retenus montrent ce qui distingue le produit, dans l'ordre où on le
/// découvre : le coffre, une fiche, le contrôle de santé, le partage, l'équipe. Le
/// déverrouillage n'y est pas — un formulaire vide ne dit rien de ce que fait l'app.
final class AppStoreShots: XCTestCase {
    private lazy var env = ProcessInfo.processInfo.environment
    private var server: String { env["GHOSTPASS_SERVER"] ?? "http://127.0.0.1:3111" }
    private var email: String { env["GHOSTPASS_EMAIL"] ?? "clara@ghostpass.test" }
    private var master: String { env["GHOSTPASS_PASSWORD"] ?? "correct horse battery staple" }
    private var demoItem: String { env["GHOSTPASS_DEMO_ITEM"] ?? "GitHub" }

    override func setUp() {
        continueAfterFailure = false
        // Sans cette trace, un échec de connexion ne dit pas *quelle* adresse a été
        // essayée — or c'est toute la question quand le port est passé par
        // l'environnement du lanceur de tests.
        NSLog("GP-SHOTS serveur=%@ email=%@", server, email)
    }

    /// Prend la vue et la range sous un nom ordonné : App Store Connect présente les
    /// captures dans l'ordre où on les dépose, et un tri alphabétique évite de s'en remettre
    /// à l'ordre de lecture d'un répertoire.
    private func prendre(_ rang: Int, _ nom: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = String(format: "%02d-%@", rang, nom)
        a.lifetime = .keepAlways
        add(a)
    }

    /// Frappe un élément, par coordonnées s'il n'est pas « atteignable ». Une cellule
    /// existe dans la hiérarchie avant d'être frappable, et `tap()` échoue alors sur un
    /// « not hittable » qui ne dit rien de la cause.
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
        XCTAssertEqual(XCTWaiter().wait(for: [frappable], timeout: 15), .completed)
        champ.tap()
        app.typeText(texte)
    }

    /// Attend qu'un élément soit là *et* posé. Une capture prise pendant une transition
    /// montre un écran à moitié dessiné — le genre de défaut qu'Apple renvoie.
    @discardableResult
    private func attendre(_ element: XCUIElement, _ delai: TimeInterval = 30) -> Bool {
        guard element.waitForExistence(timeout: delai) else { return false }
        Thread.sleep(forTimeInterval: 0.8)
        return true
    }

    /// Arme l'interception de la proposition d'iOS d'enregistrer le mot de passe saisi.
    ///
    /// Elle se pose par-dessus le coffre et rendrait la capture inutilisable — ironie d'un
    /// gestionnaire de mots de passe à qui le système propose de retenir le sien.
    ///
    /// Interrogée directement, elle reste introuvable : elle n'appartient ni à
    /// l'application ni à SpringBoard, mais à un service de vue distant. Le moniteur
    /// d'interruption est fait pour ce cas précis — il n'exige pas de savoir *qui*
    /// présente la boîte. Il ne se déclenche toutefois qu'à la prochaine interaction avec
    /// l'application : d'où le geste anodin qui suit.
    private func armerContreLaBoiteSysteme() {
        addUIInterruptionMonitor(withDescription: "Enregistrer le mot de passe") { boite in
            for libelle in ["Plus tard", "Not Now", "Pas maintenant"] {
                let bouton = boite.buttons[libelle]
                if bouton.exists {
                    bouton.tap()
                    return true
                }
            }
            return false
        }
    }

    /// Un geste sans effet, seule façon de faire jouer le moniteur d'interruption.
    private func reveiller(_ app: XCUIApplication) {
        app.navigationBars.firstMatch.tap()
        Thread.sleep(forTimeInterval: 1.5)
    }

    func testCaptures() {
        let app = XCUIApplication()
        armerContreLaBoiteSysteme()
        app.launch()

        remplir(app, "field.server", server)
        remplir(app, "field.email", email)
        remplir(app, "field.master", master)
        app.buttons["button.submit"].tap()

        XCTAssertTrue(
            coffreNavBar(app).waitForExistence(timeout: 180),
            "le coffre ne s'est pas ouvert — serveur injoignable ou identifiants refusés")
        _ = app.buttons["button.add"].waitForExistence(timeout: 60)

        // La proposition biométrique se pose par-dessus la liste : elle n'a rien à faire
        // sur une capture de vitrine.
        let plusTard = app.buttons["button.laterBiometric"].firstMatch
        if plusTard.waitForExistence(timeout: 20) {
            for _ in 0..<5 where plusTard.exists {
                plusTard.tap()
                if !plusTard.exists { break }
            }
        }
        reveiller(app)
        Thread.sleep(forTimeInterval: 1.5)
        prendre(1, "coffre")

        // Une fiche : c'est là qu'on voit le contenu réel d'un identifiant. On vise l'item
        // de démonstration par son nom — la première cellule peut être un en-tête.
        let item = app.staticTexts[demoItem].firstMatch
        if attendre(item, 30) {
            taper(item)
            Thread.sleep(forTimeInterval: 2.0)
            prendre(2, "fiche")
            let retour = app.navigationBars.buttons.firstMatch
            if retour.exists { taper(retour) }
            Thread.sleep(forTimeInterval: 1.5)
        } else {
            XCTFail("l'item « \(demoItem) » est absent — la liste ne s'est pas chargée")
        }

        // Le menu, puis les écrans qu'il ouvre. Chaque bascule repasse par lui : une
        // navigation à partir d'un état connu échoue moins qu'un enchaînement d'allers.
        ouvrirDepuisLeMenu(app, "button.health", titre: "Santé du coffre", rang: 3, nom: "sante")
        ouvrirDepuisLeMenu(app, "button.send", titre: "Partager un secret", rang: 4, nom: "partage")
        prendreLeGenerateur(app)
    }

    /// Le générateur de mots de passe, atteint par la création d'un item.
    ///
    /// Il remplace l'écran des coffres partagés, qui n'avait rien à montrer : le compte de
    /// démonstration n'appartient à aucune équipe, et une capture disant « vous
    /// n'appartenez à aucune équipe » vend mal la fonctionnalité qu'elle est censée
    /// illustrer. Mieux vaut un écran plein qu'un écran juste.
    private func prendreLeGenerateur(_ app: XCUIApplication) {
        let ajouter = app.buttons["button.add"]
        guard attendre(ajouter, 20) else {
            XCTFail("le bouton d'ajout est absent — capture « generateur » manquée")
            return
        }
        taper(ajouter)
        let de = app.buttons["button.generate"]
        guard attendre(de, 20) else {
            XCTFail("l'écran de création ne s'ouvre pas — capture « generateur » manquée")
            return
        }
        taper(de)
        guard app.navigationBars["Générer"].waitForExistence(timeout: 20) else {
            XCTFail("le générateur ne s'ouvre pas — capture « generateur » manquée")
            return
        }
        Thread.sleep(forTimeInterval: 2.0)
        prendre(5, "generateur")
    }

    /// Ouvre un écran depuis le menu et le prend en photo.
    ///
    /// La méthode vise un *état* — la feuille ouverte — et non un nombre de frappes. Une
    /// boucle qui frappait le menu quatre fois de suite avait un défaut sournois : la
    /// première frappe déplie le menu, et la deuxième, au même endroit, atterrit sur sa
    /// première entrée. On ouvrait ainsi un écran au hasard tout en concluant que l'entrée
    /// était introuvable. Ici, dès que le titre attendu paraît, on s'arrête.
    private func ouvrirDepuisLeMenu(
        _ app: XCUIApplication, _ identifiant: String, titre: String, rang: Int, nom: String
    ) {
        let menu = app.buttons["button.settings"]
        let entree = app.descendants(matching: .any).matching(identifier: identifiant).firstMatch
        let titreDeLEcran = app.navigationBars[titre]

        var ouvert = titreDeLEcran.exists
        for _ in 0..<6 where !ouvert {
            if entree.exists && entree.isHittable {
                taper(entree)
            } else if menu.exists && menu.isHittable {
                taper(menu)
            }
            ouvert = titreDeLEcran.waitForExistence(timeout: 4)
        }

        guard ouvert else {
            let vue = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            vue.name = "echec-\(nom)"
            vue.lifetime = .keepAlways
            add(vue)
            XCTFail(
                "« \(titre) » ne s'ouvre pas depuis le menu — capture « \(nom) » manquée."
                    + " Écran :\n\(app.debugDescription)")
            return
        }

        // La feuille est là, mais son contenu peut encore se remplir : la santé du coffre
        // examine les items avant d'afficher son verdict.
        Thread.sleep(forTimeInterval: 2.5)
        prendre(rang, nom)

        // Refermer, pour repartir du coffre à la capture suivante.
        let fermer = titreDeLEcran.buttons.firstMatch
        if fermer.exists { taper(fermer) }
        _ = coffreNavBar(app).waitForExistence(timeout: 20)
        Thread.sleep(forTimeInterval: 1.0)
    }
}
