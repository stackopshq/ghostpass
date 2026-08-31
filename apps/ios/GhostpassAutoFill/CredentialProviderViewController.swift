import AuthenticationServices
import SwiftUI

/// Point d'entrée du remplissage automatique.
///
/// L'extension est un processus séparé, à durée de vie courte, lancé par iOS au moment où
/// un champ de saisie réclame un identifiant. Elle ne partage rien avec l'application
/// sinon ce qui a été déposé : le coffre chiffré dans le conteneur du groupe, la session
/// et les clés d'ouverture dans le trousseau.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let store = AutoFillStore()

    /// Appelé quand l'utilisateur choisit GhostPass dans le menu de remplissage.
    /// `serviceIdentifiers` porte le ou les domaines du champ visé.
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        store.domains = serviceIdentifiers.map(\.identifier)
        present()
    }

    /// Appelé quand iOS espère un identifiant sans rien afficher. Le coffre étant
    /// verrouillé, il faut du monde à l'écran : on le dit plutôt que d'échouer sans motif.
    override func provideCredentialWithoutUserInteraction(
        for credentialRequest: any ASCredentialRequest
    ) {
        extensionContext.cancelRequest(
            withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userInteractionRequired.rawValue))
    }

    /// Appelé quand l'utilisateur ouvre GhostPass depuis le champ d'un code à usage
    /// unique. Le pendant de `prepareCredentialList`, pour l'autre nature de secret.
    @available(iOS 18.0, *)
    override func prepareOneTimeCodeCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier]
    ) {
        store.demande = .codeAUsageUnique
        store.domains = serviceIdentifiers.map(\.identifier)
        present()
    }

    /// Appelé après le refus précédent : cette fois l'interface a le droit de s'afficher.
    ///
    /// Le type de l'identité désigne la nature de la demande — c'est la seule indication
    /// qu'iOS donne ici, et s'y tromper ferait répondre un mot de passe à un champ de code.
    override func prepareInterfaceToProvideCredential(
        for credentialRequest: any ASCredentialRequest
    ) {
        if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            store.demande = .motDePasse
            store.requested = identity.recordIdentifier
            store.domains = [identity.serviceIdentifier.identifier]
        } else if #available(iOS 18.0, *),
            let identity = credentialRequest.credentialIdentity
                as? ASOneTimeCodeCredentialIdentity
        {
            store.demande = .codeAUsageUnique
            store.requested = identity.recordIdentifier
            store.domains = [identity.serviceIdentifier.identifier]
        }
        present()
    }

    private func present() {
        store.onCancel = { [weak self] in
            self?.extensionContext.cancelRequest(
                withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue))
        }
        store.onPick = { [weak self] identifiant, motDePasse in
            self?.extensionContext.completeRequest(
                withSelectedCredential: ASPasswordCredential(
                    user: identifiant, password: motDePasse))
        }
        store.onPickCode = { [weak self] code in
            // Une autre méthode de complétion, pas la même que pour un mot de passe :
            // `completeRequest(withSelectedCredential:)` laisserait la requête sans réponse.
            if #available(iOS 18.0, *) {
                self?.extensionContext.completeOneTimeCodeRequest(
                    using: ASOneTimeCodeCredential(code: code))
            }
        }

        // L'extension est un autre processus : elle relit les mêmes préférences pour ne
        // pas surgir en plein Safari dans un thème ou une langue que l'utilisateur a
        // justement écartés.
        let prefs = Preferences.shared
        let root = UIHostingController(
            rootView: AutoFillView()
                .environmentObject(store)
                .environmentObject(prefs)
                .preferredColorScheme(prefs.colorScheme)
                .environment(\.locale, prefs.locale ?? Locale.autoupdatingCurrent))
        addChild(root)
        root.view.frame = view.bounds
        root.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(root.view)
        root.didMove(toParent: self)
    }
}
