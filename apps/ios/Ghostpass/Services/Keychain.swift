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
        guard
            let access = SecAccessControlCreateWithFlags(
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
    /// Ce qu'une lecture biométrique peut donner.
    ///
    /// Distinguer ces cas n'est pas du zèle. En ne rendant qu'un optionnel, on confondait
    /// « l'utilisateur a échoué » avec « le système a repris la main » — et l'application
    /// affichait « Face ID n'a pas permis d'ouvrir le coffre » au retour d'arrière-plan,
    /// alors que Face ID ne s'était pas même présenté. Accuser une protection qui n'a rien
    /// fait est le plus sûr moyen qu'on la désactive.
    enum LectureBiometrique {
        case succes(String)
        /// Refus explicite, ou reprise en main par le système : rien à signaler.
        case interrompue
        /// L'entrée n'est pas lisible maintenant — application pas au premier plan,
        /// enrôlement modifié. Silencieux aussi : le mot de passe maître reste offert.
        case indisponible
        /// Il n'y a **rien à lire** : aucun secret n'est enregistré sous cette clef.
        ///
        /// Distinct d'`indisponible`, et c'est tout le point. Les deux étaient confondus,
        /// et la confusion rendait le défaut invisible : l'appelant croyait « je n'ai pas
        /// pu demander, je réessaierai » là où la vérité était « ce que tu cherches
        /// n'existe pas ». Il réessayait donc indéfiniment.
        case absent
        case echec(OSStatus)
    }

    static func getBiometric(_ key: String, prompt: String) -> LectureBiometrique {
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
        let statut = SecItemCopyMatching(query as CFDictionary, &result)
        switch statut {
        case errSecSuccess:
            guard let data = result as? Data, let valeur = String(data: data, encoding: .utf8)
            else { return .echec(errSecDecode) }
            return .succes(valeur)
        case errSecUserCanceled:
            return .interrompue
        // `interactionNotAllowed` est ce que rend le trousseau quand l'application n'est
        // pas au premier plan : c'est le cas exact du retour d'arrière-plan, et le seul
        // qu'il vaille la peine de réessayer.
        case errSecInteractionNotAllowed:
            return .indisponible
        // ─── `itemNotFound` n'est pas « pas maintenant » ───
        //
        // Ces trois statuts étaient rendus sous le même mot, `indisponible`, et le plus
        // rassurant des trois l'emportait. Constaté sur l'iPhone de Kevin le 2026-09-25 :
        // après un changement de serveur, le mot de passe maître avait disparu du
        // trousseau alors que le drapeau « biométrie activée » était resté à `1`. Le
        // bouton s'affichait donc, chaque tentative rendait `indisponible`, et
        // l'application concluait « je réessaierai » — pour l'éternité.
        //
        // Sept tentatives consécutives dans les journaux, toutes identiques, sans qu'une
        // seule demande biométrique n'apparaisse à l'écran.
        case errSecItemNotFound:
            return .absent
        // Une authentification qui échoue est un échec, pas une question non posée.
        case errSecAuthFailed:
            return .echec(errSecAuthFailed)
        default:
            return .echec(statut)
        }
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
        /// Le jeton ouvre le compte côté serveur : c'est le seul élément de session qui
        /// mérite le trousseau. Les blobs chiffrés, eux, vivent dans `SharedStore` — le
        /// serveur les détient déjà, et l'extension de remplissage doit pouvoir les lire.
        static let token = "sessionToken"
        /// Mot de passe maître, protégé par la biométrie. Présent seulement si
        /// l'utilisateur a explicitement activé le déverrouillage biométrique.
        static let masterPassword = "masterPassword"
        /// Drapeau lisible sans biométrie, pour savoir s'il faut proposer le bouton
        /// sans déclencher une demande de Face ID à chaque affichage de l'écran.
        static let biometricsEnabled = "biometricsEnabled"
    }
}
