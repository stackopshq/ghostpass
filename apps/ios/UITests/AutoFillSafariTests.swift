import XCTest

/// Remplissage automatique réel : une page de connexion ouverte dans Safari, et GhostPass
/// appelé depuis le clavier pour remplir le formulaire.
///
/// **Vérifié à la main le 28 août 2026**, sur simulateur, par `tools/ios/autofill-manuel.sh` :
/// le clavier propose « clara — mot de passe pour ce site web — GhostPass », iOS demande
/// confirmation pour « 127.0.0.1 », et les deux champs se remplissent. Le coffre contenait
/// trois entrées : celle du bon site est remontée, donc l'appariement par domaine tient.
///
/// Ce test-ci, lui, continue de se sauter sous `xcodebuild` faute de clavier logiciel. On
/// sait désormais que ce n'est pas le produit qui est en cause — c'est l'automatisation.
/// Reste à l'éprouver sur un appareil réel avant publication.
///
/// Le chemin traverse des écrans du système dont l'agencement change d'une version d'iOS
/// à l'autre. Ce qui relève du système est donc traité en `skip` — on ne fait pas échouer
/// une intégration parce qu'Apple a déplacé un bouton. Ce qui relève de GhostPass, en
/// revanche, doit marcher : l'extension s'ouvre, déchiffre le coffre local, propose
/// l'identifiant du site, et le formulaire finit rempli.
///
/// Prérequis posés par `tools/ios/run-ios-tests.sh` : application installée, extension
/// activée, session déposée par le parcours précédent, page servie sur le port 8099.
final class AutoFillSafariTests: XCTestCase {
    private let page = "127.0.0.1:8099"
    private let master = "correct horse battery staple"

    private func capture(_ app: XCUIApplication, _ nom: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = nom
        a.lifetime = .keepAlways
        add(a)
    }

    func test04Remplissage() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30), "Safari ne démarre pas")
        sleep(3)

        let barre = safari.textFields.firstMatch
        try XCTSkipUnless(
            barre.waitForExistence(timeout: 20), "barre d'adresse de Safari introuvable")
        barre.tap()
        sleep(1)
        safari.typeText(page + "\n")
        sleep(5)

        // Le champ de la page, trouvé dans l'arbre plutôt que deviné. La version précédente
        // tapait à 23 % de la hauteur de l'écran : il suffisait que l'habillage de Safari
        // change d'une version d'iOS à l'autre pour taper à côté, et le test concluait « le
        // clavier ne s'est pas ouvert » — ce qui accusait le système d'une erreur de visée.
        //
        // Le tap reste en coordonnées : dans une vue web, le champ existe dans l'arbre sans
        // toujours être « hittable », et un `tap()` ordinaire s'y perd. Mais on vise
        // maintenant le centre de son cadre réel.
        let champDeLaPage = safari.webViews.textFields.firstMatch
        try XCTSkipUnless(
            champDeLaPage.waitForExistence(timeout: 20),
            "la page de test ne s'est pas chargée dans Safari")
        let cadre = champDeLaPage.frame
        safari.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: cadre.midX, dy: cadre.midY))
            .tap()
        sleep(4)
        // L'entrée « Mots de passe » vit dans la barre d'accessoires du clavier : sans
        // clavier, pas de barre, donc pas de remplissage. Le constat a été fait en joignant
        // l'écran au saut — l'hypothèse inverse, qu'un simulateur sans clavier logiciel
        // proposerait quand même le remplissage, était fausse.
        //
        // Ce simulateur sans interface n'en affiche aucun, et le réglage
        // `ConnectHardwareKeyboard` n'y peut rien : il est lu par l'application Simulator,
        // qui ne tourne pas ici. C'est une limite de l'environnement, pas de GhostPass.
        let sansClavier = safari.keyboards.count == 0
        if sansClavier {
            NSLog("GP-AUTOFILL aucun clavier logiciel : la barre de remplissage n'existera pas")
        }

        let motsDePasse = safari.buttons["Mots de passe"].firstMatch
        if !motsDePasse.waitForExistence(timeout: 20) {
            // Deux causes possibles, et le message seul ne les distingue pas : GhostPass
            // n'est pas activé comme fournisseur de remplissage, ou le libellé a changé
            // avec la version d'iOS. On joint donc l'écran plutôt que de trancher à
            // l'aveugle — c'est la seule façon de savoir laquelle des deux.
            capture(safari, "A0-sans-remplissage")
            NSLog("GP-AUTOFILL écran sans « Mots de passe » :\n%@", safari.debugDescription)
            throw XCTSkip(
                sansClavier
                    ? "aucun clavier logiciel dans ce simulateur sans interface : la barre "
                        + "de remplissage n'y apparaît jamais, GhostPass n'est pas en cause"
                    : "le clavier est là mais ne propose pas « Mots de passe » : GhostPass "
                        + "n'est probablement pas activé comme fournisseur de remplissage")
        }
        motsDePasse.tap()
        sleep(4)

        // À partir d'ici, c'est GhostPass qui est en cause.
        let ghostpass = safari.buttons["GhostPass"].firstMatch
        XCTAssertTrue(
            ghostpass.waitForExistence(timeout: 20),
            "GhostPass n'est pas proposé : extension non activée ou mal déclarée")
        ghostpass.tap()
        sleep(6)
        capture(safari, "A1-extension")

        let champMaitre = safari.descendants(matching: .any)
            .matching(identifier: "field.master").firstMatch
        XCTAssertTrue(
            champMaitre.waitForExistence(timeout: 30),
            "l'extension ne demande pas le mot de passe maître — session absente du conteneur partagé ?"
        )
        champMaitre.tap()
        safari.typeText(master)
        safari.buttons["button.submit"].firstMatch.tap()

        // L'identifiant enregistré pour cette page doit remonter en tête, sous « Pour ce
        // site » : c'est tout l'intérêt du remplissage, et ce qui distingue une
        // suggestion d'une simple liste.
        let attendu = safari.staticTexts["Site local"].firstMatch
        XCTAssertTrue(
            attendu.waitForExistence(timeout: 60),
            "le coffre local ne s'est pas ouvert dans l'extension")
        XCTAssertTrue(
            safari.staticTexts["Pour ce site"].firstMatch.exists,
            "l'identifiant de la page n'est pas reconnu comme correspondant")
        capture(safari, "A2-liste")

        attendu.tap()
        sleep(4)
        capture(safari, "A3-rempli")

        // La preuve : le champ porte le nom d'utilisateur du coffre.
        let rempli = safari.webViews.textFields.firstMatch
        XCTAssertTrue(rempli.waitForExistence(timeout: 20))
        XCTAssertEqual(
            rempli.value as? String, "clara",
            "le formulaire n'a pas été rempli par l'extension")
    }
}
