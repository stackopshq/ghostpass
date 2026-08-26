import Foundation

/// Ce que l'application dépose à l'intention de l'extension de remplissage.
///
/// L'extension est un autre processus, avec son propre conteneur : elle ne voit que ce
/// qui a été posé dans le groupe d'applications. On y met ce qu'il faut pour **ouvrir**
/// le coffre — jamais de quoi le déverrouiller sans le mot de passe maître.
///
/// Les blobs ci-dessous ne sont pas des secrets au sens strict : le serveur les détient
/// déjà, et sans la dérivation Argon2id du mot de passe maître ils n'ouvrent rien. Le
/// jeton de session, lui, reste dans le trousseau : celui-là ouvre le compte côté serveur.
enum SharedStore {
    /// Doit correspondre au groupe déclaré dans les deux fichiers `.entitlements`.
    static let appGroup = "group.ch.stackops.ghostpass"

    /// Racine partagée, ou le conteneur privé de l'application si le groupe n'est pas
    /// disponible — sans entitlement, l'application continue de fonctionner seule, et
    /// c'est l'extension qui ne verra rien.
    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    }

    /// Vrai quand le groupe est réellement accessible : l'extension ne peut travailler
    /// que dans ce cas, et le dire vaut mieux que de la laisser afficher un coffre vide.
    static var isShared: Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil
    }

    /// De quoi rouvrir le coffre : l'adresse du serveur, le compte, et les blobs chiffrés.
    struct Session: Codable, Equatable {
        var serverURL: String
        var email: String
        var kdfParams: String
        var encryptedUserKey: String
        var encryptedPrivateKey: String
    }

    private static var sessionURL: URL? {
        guard let container else { return nil }
        try? FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        return container.appendingPathComponent("session.json")
    }

    static func save(_ session: Session) {
        guard let sessionURL, let data = try? JSONEncoder().encode(session) else { return }
        try? data.write(to: sessionURL, options: [.atomic, .completeFileProtection])
    }

    static func load() -> Session? {
        guard let sessionURL, let data = try? Data(contentsOf: sessionURL) else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    static func clear() {
        guard let sessionURL else { return }
        try? FileManager.default.removeItem(at: sessionURL)
    }
}
