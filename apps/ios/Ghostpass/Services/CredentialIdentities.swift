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
        // Les codes à usage unique voyagent dans le même dépôt, sous un autre type.
        // Sous iOS 17 l'API n'existe pas : on publie alors les seuls mots de passe plutôt
        // que de relever la cible de déploiement et d'abandonner ces appareils.
        if #available(iOS 18.0, *) {
            let codes = oneTimeCodeIdentities(entries)
            try? await store.replaceCredentialIdentities(identities + codes)
        } else {
            try? await store.replaceCredentialIdentities(identities)
        }
    }

    /// Une identité par domaine pour chaque entrée qui porte un secret TOTP *exploitable*.
    ///
    /// Le secret est analysé ici, et non simplement testé non vide : promettre un code
    /// qu'on ne saura pas calculer ferait échouer le remplissage au pire moment, une fois
    /// l'utilisateur engagé dans le geste. Mieux vaut ne rien proposer.
    @available(iOS 18.0, *)
    private static func oneTimeCodeIdentities(_ entries: [VaultEntry])
        -> [ASOneTimeCodeCredentialIdentity]
    {
        entries.flatMap { entry -> [ASOneTimeCodeCredentialIdentity] in
            guard let login = entry.login, let secret = login.totp,
                Totp.parse(secret) != nil
            else { return [] }
            return login.uris.compactMap { uri in
                let hote = SiteMatching.host(of: uri)
                guard !hote.isEmpty else { return nil }
                return ASOneTimeCodeCredentialIdentity(
                    serviceIdentifier: ASCredentialServiceIdentifier(
                        identifier: hote, type: .domain),
                    // Ce libellé est ce qu'iOS affiche au-dessus du clavier. Le nom de
                    // l'entrée seul serait ambigu quand deux comptes servent le même site.
                    label: login.username.isEmpty
                        ? entry.item.name : "\(entry.item.name) — \(login.username)",
                    recordIdentifier: entry.id)
            }
        }
    }

    /// À la déconnexion : plus rien à proposer, et laisser des noms d'utilisateur inscrits
    /// après le départ d'un compte serait une fuite.
    static func clear() async {
        guard await ASCredentialIdentityStore.shared.state().isEnabled else { return }
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
    }
}
