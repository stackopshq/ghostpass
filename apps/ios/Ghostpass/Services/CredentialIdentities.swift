import AuthenticationServices

/// Inscription des identifiants auprès d'iOS.
///
/// Sans elle, GhostPass n'apparaît qu'au fond du menu de remplissage. Avec elle, iOS
/// propose le bon identifiant directement au-dessus du clavier — ce qui fait toute la
/// différence entre un gestionnaire qu'on utilise et un qu'on contourne.
///
/// Ce qui est déposé ici — nom d'utilisateur et domaine — est visible du système. Le mot
/// de passe, lui, n'est jamais transmis : iOS rappelle l'extension pour l'obtenir.
enum CredentialIdentities {
    static func sync(_ entries: [VaultEntry]) async {
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }

        let identities: [ASPasswordCredentialIdentity] = entries.flatMap { entry in
            guard let login = entry.login, !login.username.isEmpty else {
                return [ASPasswordCredentialIdentity]()
            }
            return login.uris.compactMap { uri in
                let hote = SiteMatching.host(of: uri)
                guard !hote.isEmpty else { return nil }
                return ASPasswordCredentialIdentity(
                    serviceIdentifier: ASCredentialServiceIdentifier(
                        identifier: hote, type: .domain),
                    user: login.username,
                    // L'identifiant de l'item : c'est ce qu'iOS rendra à l'extension
                    // quand il faudra fournir le mot de passe.
                    recordIdentifier: entry.id)
            }
        }
        try? await store.replaceCredentialIdentities(identities)
    }

    /// À la déconnexion : plus rien à proposer, et laisser des noms d'utilisateur inscrits
    /// après le départ d'un compte serait une fuite.
    static func clear() async {
        guard await ASCredentialIdentityStore.shared.state().isEnabled else { return }
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
    }
}
