import UIKit
import UniformTypeIdentifiers

/// Copie de secrets dans le presse-papiers.
///
/// Toujours avec une date d'expiration : le presse-papiers d'iOS est lisible par
/// n'importe quelle application au premier plan, et il se synchronise avec les autres
/// appareils du même compte iCloud. Un mot de passe qui y reste jusqu'à la prochaine
/// copie est un mot de passe posé sur la table.
enum Clipboard {
    /// Trente secondes : le temps de coller, pas celui d'oublier.
    static let lifetime: TimeInterval = 30

    static func copy(_ value: String) {
        UIPasteboard.general.setItems(
            [[UTType.utf8PlainText.identifier: value]],
            options: [.expirationDate: Date().addingTimeInterval(lifetime)])
    }
}
