import LocalAuthentication
import UIKit
import XCTest

/// Parcours de bout en bout contre un serveur GhostPass local, amorcé par
/// `tools/ios/run-ios-tests.sh` avec un compte de test et un item de registre.
///
/// Les champs sont adressés par `accessibilityIdentifier` — jamais par position ni par
/// libellé, qui dépendent tous deux de la mise en page et de la langue. La frappe passe
/// par `app.typeText` plutôt que par l'élément : re-résoudre une requête pendant que le
/// curseur clignote fait expirer la recherche d'instantané.
///
/// L'adresse du serveur et le compte sont ceux qu'amorce le script ; les variables
/// d'environnement ne servent qu'à lancer ces tests à la main depuis Xcode. `xcodebuild`
/// ne transmet pas d'environnement au processus de test, d'où ces valeurs par défaut —
/// elles doivent rester alignées sur celles de `tools/ios/run-ios-tests.sh`.
final class VaultFlowTests: XCTestCase {
    private lazy var env = ProcessInfo.processInfo.environment
    private var server: String { env["GHOSTPASS_SERVER"] ?? "http://127.0.0.1:3111" }
    private var email: String { env["GHOSTPASS_EMAIL"] ?? "clara@ghostpass.test" }
    private var master: String { env["GHOSTPASS_PASSWORD"] ?? "correct horse battery staple" }
    private var demoItem: String { env["GHOSTPASS_DEMO_ITEM"] ?? "GitHub" }

    override func setUp() {
        continueAfterFailure = false
        NSLog("GP-CONF serveur=%@ email=%@", server, email)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Un tap sur un champ SwiftUI en sélectionne tout le contenu : la frappe le remplace.
    private func remplir(_ app: XCUIApplication, _ id: String, _ text: String) {
        let field = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "champ « \(id) » absent")
        field.tap()
        app.typeText(text)
    }

    private func seConnecter(_ app: XCUIApplication) {
        let champServeur = app.descendants(matching: .any)
            .matching(identifier: "field.server").firstMatch
        if !champServeur.waitForExistence(timeout: 8) {
            // Une session est déjà enregistrée : l'écran ne demande que le mot de passe.
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
            app.navigationBars["Coffre"].waitForExistence(timeout: 180),
            "le coffre ne s'est pas ouvert — serveur injoignable ou identifiants refusés")
        // La liste apparaît avant que le coffre ne soit déchiffré : tant que `refresh()`
        // occupe le fil principal, aucune alerte ne peut se poser. On attend donc que
        // l'écran soit vraiment en place avant de chercher la proposition biométrique.
        _ = app.buttons["button.add"].waitForExistence(timeout: 60)
        ecarterLaPropositionBiometrique(app)
    }

    /// Frappe un élément même si l'interface vient de changer.
    ///
    /// Un `tap()` ordinaire commence par calculer un point de frappe ; sur une vue encore
    /// en cours d'animation, ce calcul rend {-1, -1} et le geste se perd en silence. Le
    /// tap en coordonnées, lui, vise le centre du cadre sans rien demander à personne.
    private func taper(_ element: XCUIElement) {
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    private func aDisparu(_ element: XCUIElement, delai: TimeInterval) -> Bool {
        let attente = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [attente], timeout: delai) == .completed
    }

    /// Écarte la proposition d'activer la biométrie, si elle se présente.
    ///
    /// Cette alerte ne surgit qu'après le premier déverrouillage d'un appareil où une
    /// biométrie est inscrite — et elle surgit à son rythme, une fois le déchiffrement du
    /// coffre terminé. Tant qu'elle est là, elle intercepte toutes les frappes, et les
    /// échecs qui suivent ne ressemblent en rien à leur cause. On l'attend donc pour de
    /// bon, et on vérifie qu'elle est bien partie : le premier tap sur une alerte qui
    /// s'anime encore ne porte pas.
    private func ecarterLaPropositionBiometrique(
        _ app: XCUIApplication, delai: TimeInterval = 20
    ) {
        let plusTard = app.buttons["button.laterBiometric"].firstMatch
        guard plusTard.waitForExistence(timeout: delai) else { return }
        for _ in 0..<5 {
            taper(plusTard)
            if aDisparu(plusTard, delai: 3) { return }
        }
        XCTFail("la proposition d'activer la biométrie ne se referme pas")
    }

    /// Les registres internes — dossiers, favoris — voyagent dans la liste comme les
    /// autres éléments. Aucun ne doit s'y montrer, et pas seulement celui des dossiers :
    /// c'est le préfixe qui les masque, il faut donc l'éprouver sur plusieurs.
    private func aucuneLigneFantome(_ app: XCUIApplication, _ contexte: String) {
        for nom in ["gp:folders", "gp:favorites", "gp:"] {
            let fantome = app.staticTexts.containing(
                NSPredicate(format: "label CONTAINS[c] %@", nom))
            XCTAssertEqual(fantome.count, 0, "ligne fantôme « \(nom) » visible (\(contexte))")
        }
    }

    private func ouvrirReglages(_ app: XCUIApplication) {
        ouvrirLeMenu(app, "button.preferences")
        XCTAssertTrue(
            app.buttons["button.doneSettings"].waitForExistence(timeout: 20),
            "l'écran des réglages ne s'est pas ouvert")
    }

    /// Ouvre le menu du coffre et frappe une de ses entrées.
    private func ouvrirLeMenu(_ app: XCUIApplication, _ identifiant: String) {
        let menu = app.buttons["button.settings"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30), "le menu du coffre est absent")
        let entree = app.buttons[identifiant]
        // Un tap sur une barre de navigation encore en cours de mise en page ne porte
        // pas : XCUITest calcule un point de frappe {-1, -1} et le menu ne s'ouvre
        // jamais. On réessaie plutôt que d'en conclure que l'entrée n'existe pas.
        var ouvert = false
        for _ in 0..<4 {
            taper(menu)
            if entree.waitForExistence(timeout: 5) {
                ouvert = true
                break
            }
        }
        XCTAssertTrue(ouvert, "« \(identifiant) » absent du menu")
        entree.tap()
    }

    /// La luminance moyenne d'une capture, entre 0 et 1.
    ///
    /// C'est la seule façon honnête de vérifier qu'un thème s'applique : les couleurs ne
    /// sont pas des éléments d'accessibilité, et se contenter de constater que la case
    /// « Sombre » est cochée reviendrait à tester la case, pas le thème.
    private func luminance(_ capture: XCUIScreenshot) -> Double {
        guard let cg = capture.image.cgImage else { return -1 }
        let largeur = 32, hauteur = 64
        var pixels = [UInt8](repeating: 0, count: largeur * hauteur * 4)
        guard
            let ctx = CGContext(
                data: &pixels, width: largeur, height: hauteur, bitsPerComponent: 8,
                bytesPerRow: largeur * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return -1 }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: largeur, height: hauteur))
        var total = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            total +=
                0.2126 * Double(pixels[i]) + 0.7152 * Double(pixels[i + 1])
                + 0.0722 * Double(pixels[i + 2])
        }
        return total / Double(largeur * hauteur) / 255
    }

    func test01ParcoursComplet() throws {
        let app = XCUIApplication()
        app.launch()

        // 1. Connexion
        seConnecter(app)
        shot(app, "1-coffre")

        // 2. La liste montre le coffre, et rien de ce qui doit rester caché
        XCTAssertTrue(
            app.staticTexts[demoItem].waitForExistence(timeout: 30),
            "l'item de démonstration « \(demoItem) » est absent : la liste n'a pas pu se charger")
        aucuneLigneFantome(app, "après connexion")

        // 3. Création
        let plus = app.buttons["button.add"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        if !app.buttons["button.cancel"].waitForExistence(timeout: 10) {
            plus.tap()  // la feuille rate parfois le premier tap juste après le chargement
            XCTAssertTrue(
                app.buttons["button.cancel"].waitForExistence(timeout: 30),
                "la feuille de création ne s'ouvre pas")
        }
        remplir(app, "field.name", "Forgejo")
        remplir(app, "field.username", "clara")

        // Le générateur : on vérifie qu'il propose bien quelque chose, puis on renonce —
        // la suite du parcours a besoin d'un mot de passe connu.
        app.buttons["button.generate"].tap()
        let propose = app.staticTexts["text.generated"]
        XCTAssertTrue(propose.waitForExistence(timeout: 20), "le générateur ne s'ouvre pas")
        let premier = propose.label
        XCTAssertGreaterThanOrEqual(premier.count, 8, "mot de passe généré trop court")
        app.buttons["button.regenerate"].tap()
        XCTAssertNotEqual(propose.label, premier, "régénérer redonne le même mot de passe")
        shot(app, "5-generateur")
        app.buttons["Annuler"].firstMatch.tap()

        remplir(app, "field.password", "s3cret-initial")
        remplir(app, "field.uri", "https://git.stackops.ch")
        remplir(app, "field.totp", "GEZDGNBVGY3TQOJQ")
        app.buttons["button.save"].tap()
        XCTAssertTrue(
            app.staticTexts["Forgejo"].waitForExistence(timeout: 60),
            "l'item créé n'apparaît pas dans la liste")

        // 4. Favori : l'étoile du détail, puis la section en tête de liste
        app.buttons["Forgejo, clara"].firstMatch.tap()
        let etoile = app.buttons["button.favorite"]
        XCTAssertTrue(etoile.waitForExistence(timeout: 30), "l'étoile des favoris est absente")
        taper(etoile)
        if app.navigationBars.buttons["Coffre"].exists { app.navigationBars.buttons["Coffre"].tap() }
        let sectionFavoris = app.descendants(matching: .any)
            .matching(identifier: "header.favorites").firstMatch
        XCTAssertTrue(
            sectionFavoris.waitForExistence(timeout: 60),
            "la section des favoris n'apparaît pas après la mise en favori")
        // Le favori vit dans son propre registre chiffré : il ne doit pas non plus se
        // montrer comme un élément.
        aucuneLigneFantome(app, "après mise en favori")
        shot(app, "4-favoris")

        // 5. Santé du coffre
        ouvrirLeMenu(app, "button.health")
        let resume = app.descendants(matching: .any)
            .matching(identifier: "card.healthSummary").firstMatch
        XCTAssertTrue(
            resume.waitForExistence(timeout: 30),
            "l'écran de santé ne montre pas son résumé")
        shot(app, "4-sante")
        app.buttons["button.closeHealth"].tap()

        // 6. Modification
        app.buttons["Forgejo, clara"].firstMatch.tap()
        XCTAssertTrue(app.buttons["button.edit"].waitForExistence(timeout: 30))
        app.buttons["button.edit"].tap()
        XCTAssertTrue(app.buttons["button.cancel"].waitForExistence(timeout: 30))
        remplir(app, "field.name", "Forgejo prod")
        app.buttons["button.save"].tap()
        XCTAssertTrue(
            app.staticTexts["Forgejo prod"].waitForExistence(timeout: 60),
            "l'écran de détail garde l'ancien contenu après modification")

        // 4b. Une modification ne doit emporter ni le mot de passe ni la clé TOTP :
        // ni l'un ni l'autre n'a été touché, et leur disparition serait silencieuse.
        app.buttons["button.reveal"].tap()
        XCTAssertTrue(
            app.staticTexts["s3cret-initial"].waitForExistence(timeout: 30),
            "le mot de passe a été écrasé par l'édition")
        let code = app.staticTexts["text.totp"]
        XCTAssertTrue(
            code.waitForExistence(timeout: 30),
            "la clé TOTP a été effacée par l'édition")
        XCTAssertEqual(
            code.label.count, 6, "un code TOTP à six chiffres était attendu, pas « \(code.label) »")
        XCTAssertTrue(code.label.allSatisfy(\.isNumber), "code TOTP non numérique : « \(code.label) »")
        shot(app, "2-detail")

        // 6b. Changer le mot de passe archive l'ancien. C'est ce qui sauve un compte dont
        // le changement a échoué à mi-chemin ; encore faut-il que l'écran le montre.
        app.buttons["button.edit"].tap()
        XCTAssertTrue(app.buttons["button.cancel"].waitForExistence(timeout: 30))
        remplir(app, "field.password", "s3cret-remplace")
        app.buttons["button.save"].tap()
        let historique = app.buttons["button.history"]
        XCTAssertTrue(
            historique.waitForExistence(timeout: 60),
            "l'ancien mot de passe n'a pas été archivé")
        taper(historique)
        XCTAssertTrue(
            app.staticTexts["Remplacé"].waitForExistence(timeout: 20),
            "l'historique ne montre rien une fois déplié")
        shot(app, "2-historique")

        // 4c. Dossiers : en créer un, y ranger l'élément, filtrer dessus
        if app.navigationBars.buttons["Coffre"].exists { app.navigationBars.buttons["Coffre"].tap() }
        app.buttons["button.folderFilter"].tap()
        XCTAssertTrue(
            app.buttons["button.newFolder"].waitForExistence(timeout: 20), "écran des dossiers absent")
        app.buttons["button.newFolder"].tap()
        remplir(app, "field.folderName", "Travail")
        app.buttons["button.createFolder"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["Travail"].waitForExistence(timeout: 30),
            "le dossier créé n'apparaît pas")
        app.buttons["button.closeFolders"].firstMatch.tap()

        // On y range l'élément, puis on filtre : le dossier doit le contenir.
        app.buttons["Forgejo prod, clara"].firstMatch.tap()
        XCTAssertTrue(app.buttons["button.edit"].waitForExistence(timeout: 20))
        app.buttons["button.edit"].tap()
        XCTAssertTrue(app.buttons["button.cancel"].waitForExistence(timeout: 20))
        remplir(app, "field.folder", "Travail")
        app.buttons["button.save"].tap()
        sleep(2)
        if app.navigationBars.buttons["Coffre"].exists { app.navigationBars.buttons["Coffre"].tap() }

        app.buttons["button.folderFilter"].tap()
        XCTAssertTrue(app.staticTexts["Travail"].waitForExistence(timeout: 20))
        app.staticTexts["Travail"].tap()
        XCTAssertTrue(
            app.staticTexts["Forgejo prod"].waitForExistence(timeout: 30),
            "l'élément rangé n'apparaît pas dans son dossier")
        XCTAssertFalse(
            app.staticTexts[demoItem].exists,
            "le filtre laisse passer un élément d'un autre dossier")
        shot(app, "4c-dossier")

        // Retour à la vue complète, sans quoi la suite filtrerait sans le savoir.
        app.buttons["button.folderFilter"].tap()
        XCTAssertTrue(app.staticTexts["Tous les éléments"].waitForExistence(timeout: 20))
        app.staticTexts["Tous les éléments"].tap()
        XCTAssertTrue(app.staticTexts[demoItem].waitForExistence(timeout: 30))

        // 5. Suppression
        if app.navigationBars.buttons["Coffre"].exists { app.navigationBars.buttons["Coffre"].tap() }
        let ligne = app.buttons["Forgejo prod, clara"].firstMatch
        XCTAssertTrue(ligne.waitForExistence(timeout: 30))
        ligne.swipeLeft()
        XCTAssertTrue(app.buttons["Supprimer"].waitForExistence(timeout: 30))
        app.buttons["Supprimer"].tap()
        expectation(
            for: NSPredicate(format: "exists == false"),
            evaluatedWith: app.staticTexts["Forgejo prod"])
        waitForExpectations(timeout: 60)

        // 5b. L'item supprimé est à la corbeille, d'où il revient
        app.buttons["button.settings"].tap()
        app.buttons["button.trash"].firstMatch.tap()
        let dansLaCorbeille = app.staticTexts["Forgejo prod"]
        XCTAssertTrue(
            dansLaCorbeille.waitForExistence(timeout: 30),
            "l'item supprimé n'est pas dans la corbeille")
        shot(app, "5-corbeille")
        // Balayage vers la droite : restaurer.
        dansLaCorbeille.swipeRight()
        XCTAssertTrue(app.buttons["Restaurer"].waitForExistence(timeout: 20))
        app.buttons["Restaurer"].tap()
        // On vérifie que la corbeille se vide, et non que le nom disparaît : l'item
        // restauré réapparaît dans le coffre, sous la feuille, où il reste visible de
        // l'arbre d'accessibilité.
        XCTAssertTrue(
            app.staticTexts["Corbeille vide"].waitForExistence(timeout: 30),
            "l'item restauré n'a pas quitté la corbeille")
        app.buttons["button.closeTrash"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["Forgejo prod"].waitForExistence(timeout: 30),
            "l'item restauré n'est pas revenu dans le coffre")

        // 5c. Cette fois pour de bon : suppression, puis purge confirmée
        app.buttons["Forgejo prod, clara"].firstMatch.swipeLeft()
        XCTAssertTrue(app.buttons["Supprimer"].waitForExistence(timeout: 20))
        app.buttons["Supprimer"].tap()
        expectation(
            for: NSPredicate(format: "exists == false"),
            evaluatedWith: app.staticTexts["Forgejo prod"])
        waitForExpectations(timeout: 30)

        app.buttons["button.settings"].tap()
        app.buttons["button.trash"].firstMatch.tap()
        let aPurger = app.staticTexts["Forgejo prod"]
        XCTAssertTrue(aPurger.waitForExistence(timeout: 30))
        aPurger.swipeLeft()
        XCTAssertTrue(app.buttons["Supprimer"].waitForExistence(timeout: 20))
        app.buttons["Supprimer"].tap()
        // Une suppression définitive se confirme : sans cette étape, rien ne part.
        XCTAssertTrue(
            app.buttons["button.confirmPurge"].firstMatch.waitForExistence(timeout: 20),
            "la suppression définitive ne demande pas confirmation")
        app.buttons["button.confirmPurge"].firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["Corbeille vide"].waitForExistence(timeout: 30),
            "l'item purgé est encore là")
        app.buttons["button.closeTrash"].firstMatch.tap()

        // 6. Verrouiller relâche vraiment les clés
        app.buttons["button.lock"].tap()
        XCTAssertTrue(app.buttons["button.submit"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts[demoItem].exists, "le coffre reste visible après verrouillage")

        // 7. Réouverture avec le seul mot de passe maître, sans réseau ni ressaisie du compte
        remplir(app, "field.master", master)
        app.buttons["button.submit"].tap()
        XCTAssertTrue(
            app.staticTexts[demoItem].waitForExistence(timeout: 180),
            "la réouverture au mot de passe maître a échoué")
        aucuneLigneFantome(app, "après réouverture")
        XCTAssertFalse(app.staticTexts["Forgejo prod"].exists, "l'item supprimé est revenu")
        shot(app, "3-reouvert")
    }

    /// Enrôlement puis réouverture biométrique. Ne s'exécute que si le script a inscrit
    /// une biométrie dans le simulateur et se charge d'envoyer les correspondances :
    /// sinon le test est ignoré, jamais vert par accident.
    func test02Biometrie() throws {
        // On interroge le simulateur plutôt que de se fier à une variable transmise :
        // `xcodebuild` n'en propage aucune jusqu'ici. Le script inscrit une biométrie et
        // envoie les correspondances ; sans lui, ce test est ignoré, jamais vert par défaut.
        try XCTSkipUnless(
            LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil),
            "aucune biométrie inscrite : lancez tools/ios/run-ios-tests.sh")

        let app = XCUIApplication()
        app.launch()

        // Si la biométrie est déjà active, l'app se déverrouille seule au lancement.
        if !app.navigationBars["Coffre"].waitForExistence(timeout: 45) {
            seConnecter(app)
            let plusTard = app.buttons["button.laterBiometric"].firstMatch
            if plusTard.waitForExistence(timeout: 5) { plusTard.tap() }
        }

        // Activation par les réglages, et non par la proposition qui suit la connexion :
        // celle-ci ne paraît qu'une fois, alors que le réglage est toujours là — c'est
        // d'ailleurs le seul recours après un « Plus tard ».
        let reglages = app.buttons["button.settings"]
        XCTAssertTrue(reglages.waitForExistence(timeout: 30), "menu des réglages absent")
        reglages.tap()

        let activer = app.buttons["button.biometricOn"].firstMatch
        let desactiver = app.buttons["button.biometricOff"].firstMatch
        if activer.waitForExistence(timeout: 10) {
            activer.tap()
            remplir(app, "field.masterConfirm", master)
            app.buttons["button.confirmBiometric"].firstMatch.tap()
            // La feuille ne se referme que si le mot de passe a ouvert le coffre : la
            // voir rester, c'est un refus du trousseau, qu'on remonte plutôt que
            // d'échouer trois écrans plus loin sur un symptôme.
            if app.buttons["button.confirmBiometric"].firstMatch.waitForExistence(timeout: 5),
                app.navigationBars.staticTexts.containing(
                    NSPredicate(format: "label BEGINSWITH %@", "Activer")).element.exists
            {
                shot(app, "4-echec-activation")
                XCTFail("activation biométrique refusée par le trousseau")
            }
        } else if desactiver.exists {
            // Déjà active : refermer le menu sans y toucher.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
        } else {
            // Le menu ne propose rien : l'application ne voit aucune biométrie, alors même
            // que le runner en voyait une. L'inscription simulée du simulateur ne survit
            // pas toujours au recyclage que fait xcodebuild entre deux invocations. On
            // s'arrête là plutôt que de rendre vert un chemin qu'on n'a pas exercé.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
            throw XCTSkip(
                "l'application ne voit pas de biométrie sur ce simulateur — "
                    + "déverrouillage biométrique non vérifié")
        }

        // Le cycle qui compte : verrouiller, puis rouvrir sans aucune saisie.
        app.buttons["button.lock"].tap()
        sleep(5)
        shot(app, "4-apres-verrouillage")
        XCTAssertTrue(
            app.staticTexts[demoItem].waitForExistence(timeout: 120),
            "la biométrie n'a pas rouvert le coffre")
        shot(app, "4-biometrie")
    }

    /// Le coffre doit s'ouvrir **sans serveur**. Lancé par le script après extinction du
    /// backend, ce test suppose qu'un run précédent a laissé une session et une copie
    /// locale — c'est-à-dire l'état d'un téléphone qui perd le réseau.
    func test03HorsLigne() throws {
        let app = XCUIApplication()
        app.launch()

        // Une session est enregistrée : l'écran ne demande que le mot de passe maître.
        let champ = app.descendants(matching: .any)
            .matching(identifier: "field.master").firstMatch
        XCTAssertTrue(
            champ.waitForExistence(timeout: 30),
            "aucune session enregistrée : lancez ce test après le parcours complet")
        champ.tap()
        app.typeText(master)
        app.buttons["button.submit"].tap()

        // Déverrouiller ne demande pas le réseau : les blobs sont sur l'appareil.
        XCTAssertTrue(
            app.staticTexts[demoItem].waitForExistence(timeout: 180),
            "le coffre ne s'ouvre pas hors ligne")
        XCTAssertTrue(
            app.otherElements["banner.offline"].waitForExistence(timeout: 30)
                || app.staticTexts.containing(
                    NSPredicate(format: "label CONTAINS[c] %@", "Hors ligne")).element.exists,
            "rien n'indique que le coffre affiché vient de l'appareil")
        aucuneLigneFantome(app, "hors ligne")
        shot(app, "6-hors-ligne")
    }

    /// Le thème et la langue appartiennent à l'utilisateur, pas au système.
    ///
    /// Ce test ne se contente pas de cliquer : il vérifie que le titre du coffre change
    /// bien de langue, que le choix survit à une relance, et que le fond de l'écran
    /// s'éclaircit vraiment. Il repose ensuite tout comme il l'a trouvé — la suite qui
    /// vient après lui attend une application en français.
    func test05Preferences() throws {
        let app = XCUIApplication()
        app.launch()
        seConnecter(app)

        // 1. Passage à l'anglais
        ouvrirReglages(app)
        app.buttons["row.langue.anglais"].tap()
        app.buttons["button.doneSettings"].tap()
        XCTAssertTrue(
            app.navigationBars["Vault"].waitForExistence(timeout: 30),
            "le coffre est resté en français après le passage à l'anglais")
        shot(app, "7-anglais")

        // 2. Le choix survit à une relance : sinon ce ne serait qu'un état d'écran.
        app.terminate()
        app.launch()
        XCTAssertTrue(
            app.staticTexts["Vault saved on this device"].waitForExistence(timeout: 60),
            "la langue choisie a été oubliée au redémarrage")
        remplir(app, "field.master", master)
        app.buttons["button.submit"].tap()
        XCTAssertTrue(app.navigationBars["Vault"].waitForExistence(timeout: 180))

        // 3. Thème clair, puis sombre, mesurés à l'écran
        ouvrirReglages(app)
        app.buttons["tile.apparence.clair"].tap()
        app.buttons["button.doneSettings"].tap()
        XCTAssertTrue(app.navigationBars["Vault"].waitForExistence(timeout: 20))
        let clair = luminance(app.screenshot())
        shot(app, "8-clair")

        ouvrirReglages(app)
        app.buttons["tile.apparence.sombre"].tap()
        app.buttons["button.doneSettings"].tap()
        XCTAssertTrue(app.navigationBars["Vault"].waitForExistence(timeout: 20))
        let sombre = luminance(app.screenshot())
        shot(app, "9-sombre")

        XCTAssertGreaterThan(
            clair, sombre + 0.25,
            "le thème clair (\(clair)) ne se distingue pas du sombre (\(sombre))")

        // 4. Retour aux réglages du système, pour la suite des tests
        ouvrirReglages(app)
        app.buttons["tile.apparence.systeme"].tap()
        app.buttons["row.langue.systeme"].tap()
        app.buttons["button.doneSettings"].tap()
        XCTAssertTrue(
            app.navigationBars["Coffre"].waitForExistence(timeout: 30),
            "le retour au réglage du système n'a pas ramené le français")
    }
}
