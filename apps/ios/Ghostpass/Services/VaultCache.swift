import Foundation

/// Copie locale du coffre, telle qu'elle vient du serveur : **déjà chiffrée**.
///
/// Ce sont exactement les blobs que le serveur stocke sans pouvoir les lire ; les poser
/// sur le disque n'élargit donc pas la surface d'exposition. Ce qui les ouvre — l'USK —
/// dérive du mot de passe maître et n'est jamais écrit nulle part.
///
/// `.completeFileProtection` par-dessus : tant que l'appareil est verrouillé, le fichier
/// n'est même pas lisible. C'est une ceinture, pas la bretelle.
enum VaultCache {
    private static let fileName = "vault-cache.json"

    /// Dans le conteneur partagé : l'extension de remplissage lit le même coffre, sans
    /// avoir à le retélécharger ni à ouvrir de session à elle.
    private static var url: URL? {
        guard let directory = SharedStore.container else { return nil }
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(fileName)
    }

    static func save(_ items: [EncryptedItemDTO]) {
        guard let url, let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        exclureDesSauvegardes(url)
    }

    /// Renvoie `nil` s'il n'y a rien, ou si le fichier n'est plus lisible — un cache
    /// illisible n'est pas une erreur à remonter, seulement un coffre à recharger.
    static func load() -> [EncryptedItemDTO]? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([EncryptedItemDTO].self, from: data)
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
