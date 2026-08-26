import XCTest

/// Remplissage automatique réel : une page de connexion ouverte dans Safari, et GhostPass
/// appelé depuis le clavier pour remplir le formulaire.
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
        try XCTSkipUnless(barre.waitForExistence(timeout: 20), "barre d'adresse de Safari introuvable")
        barre.tap()
        sleep(1)
        safari.typeText(page + "\n")
        sleep(5)

        // Un tap par coordonnée : dans une vue web, le champ existe dans l'arbre
        // d'accessibilité sans toujours être atteignable par un tap ordinaire.
        safari.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.23)).tap()
        sleep(4)
        try XCTSkipUnless(safari.keyboards.count > 0, "le clavier ne s'est pas ouvert sur la page")

        let motsDePasse = safari.buttons["Mots de passe"].firstMatch
        try XCTSkipUnless(
            motsDePasse.waitForExistence(timeout: 20),
            "le clavier ne propose pas « Mots de passe » sur cette version d'iOS")
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
            "l'extension ne demande pas le mot de passe maître — session absente du conteneur partagé ?")
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
