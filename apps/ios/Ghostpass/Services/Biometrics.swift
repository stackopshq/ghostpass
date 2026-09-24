import LocalAuthentication

/// Disponibilité de la biométrie sur l'appareil.
///
/// Face ID ne remplace pas le mot de passe maître : il en autorise la relecture depuis le
/// trousseau. Le déverrouillage lui-même reste une dérivation Argon2id faite par le cœur
/// Rust — la biométrie ne fait qu'ouvrir la porte du coffre-fort où dort le mot de passe.
enum Biometrics {
    /// L'appareil dispose-t-il d'une biométrie *utilisable* (matériel présent, enrôlée,
    /// non verrouillée par trop d'échecs) ?
    static var isAvailable: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    /// Nom à afficher : « Face ID », « Touch ID », ou un libellé neutre si l'appareil
    /// annonce une biométrie que cette version de l'app ne connaît pas.
    // `@MainActor` parce que le repli passe par le catalogue, et que `tr` lit les
    // préférences de l'application. Tous les appelants — `VaultStore`, `AutoFillStore`
    // et les vues — y sont déjà isolés ; l'annotation ne restreint donc personne, elle
    // rend explicite ce qui l'était de fait.
    @MainActor
    static var label: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        // Traduit : ce repli s'interpole dans des phrases du catalogue, et un littéral
        // aurait donné « Unlock with la biométrie » sur une interface anglaise.
        default: return tr("la biométrie")
        }
    }

    /// Le symbole qui va avec ce nom : un visage ou une empreinte, jamais un cadenas
    /// générique — c'est le geste attendu qu'il faut annoncer.
    static var icon: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.shield"
        }
    }
}
