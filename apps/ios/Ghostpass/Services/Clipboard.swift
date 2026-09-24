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
            options: [
                .expirationDate: Date().addingTimeInterval(lifetime),
                // `localOnly` ferme le Presse-papiers universel. Sans elle, un mot de passe
                // copié ici arrivait dans le presse-papiers de tous les Mac et iPad du même
                // compte iCloud — et sur un Mac, n'importe quelle application le lit sans
                // rien demander. L'expiration bornait la durée, pas la portée : ce sont deux
                // options distinctes, et le commentaire ci-dessus nommait le risque que le
                // code ne fermait pas.
                .localOnly: true,
            ])
    }
}
