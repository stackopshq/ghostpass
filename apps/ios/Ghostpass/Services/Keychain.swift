import Foundation
import LocalAuthentication
import Security

/// Stockage des éléments de session dans le trousseau iOS.
///
/// Ce qui y est déposé — jeton de session et blobs chiffrés — ne suffit pas à ouvrir
/// le coffre : il faut le mot de passe maître, qui n'est jamais écrit nulle part.
/// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` interdit la sortie par sauvegarde
/// iCloud et la restauration sur un autre appareil.
enum Keychain {
    private static let service = "ch.stackops.ghostpass"

    static func set(_ value: String, for key: String) {
        let data = Data(value.utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Dépose une valeur que seule la biométrie pourra relire.
    ///
    /// `.biometryCurrentSet` : enrôler un nouveau visage ou une nouvelle empreinte
    /// **invalide** l'entrée. Sans cela, quiconque peut ajouter son visage aux réglages
    /// — donc quiconque connaît le code de l'appareil — ouvrirait le coffre.
    /// `WhenPasscodeSetThisDeviceOnly` : rien ne sort par sauvegarde ni restauration.
    /// Renvoie l'`OSStatus` brut : `errSecSuccess`, ou de quoi diagnostiquer un refus
    /// (typiquement `errSecAuthFailed` / `-34018` quand l'appareil n'a pas de code).
    @discardableResult
    static func setBiometric(_ value: String, for key: String) -> OSStatus {
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil)
        else { return errSecParam }
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessControl as String] = access
        return SecItemAdd(query as CFDictionary, nil)
    }

    /// Relit une valeur biométrique. L'appel **déclenche** l'authentification : il bloque
    /// le temps que l'utilisateur se présente, d'où l'exécution hors du fil principal.
    static func getBiometric(_ key: String, prompt: String) -> String? {
        let context = LAContext()
        context.localizedReason = prompt
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    enum Key {
        static let serverURL = "serverURL"
        static let email = "email"
        static let token = "sessionToken"
        static let kdfParams = "kdfParams"
        static let encryptedUserKey = "encryptedUserKey"
        static let encryptedPrivateKey = "encryptedPrivateKey"
        /// Mot de passe maître, protégé par la biométrie. Présent seulement si
        /// l'utilisateur a explicitement activé le déverrouillage biométrique.
        static let masterPassword = "masterPassword"
        /// Drapeau lisible sans biométrie, pour savoir s'il faut proposer le bouton
        /// sans déclencher une demande de Face ID à chaque affichage de l'écran.
        static let biometricsEnabled = "biometricsEnabled"
    }
}
