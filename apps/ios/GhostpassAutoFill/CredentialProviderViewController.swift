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

    /// Appelé après le refus précédent : cette fois l'interface a le droit de s'afficher.
    override func prepareInterfaceToProvideCredential(
        for credentialRequest: any ASCredentialRequest
    ) {
        if let identity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
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

        let root = UIHostingController(rootView: AutoFillView().environmentObject(store))
        addChild(root)
        root.view.frame = view.bounds
        root.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(root.view)
        root.didMove(toParent: self)
    }
}
