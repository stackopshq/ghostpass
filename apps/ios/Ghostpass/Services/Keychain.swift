import Foundation
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
    }
}
