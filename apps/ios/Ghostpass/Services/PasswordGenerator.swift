import Foundation
import Security

/// Générateur de mots de passe, transposition fidèle de `apps/web/src/lib/generator.ts` :
/// mêmes jeux de caractères, mêmes valeurs par défaut, mêmes garanties. Deux appareils du
/// même compte doivent produire des mots de passe de même nature.
///
/// L'aléa vient de `SecRandomCopyBytes`, le générateur du système — l'équivalent du
/// `crypto.getRandomValues` qu'utilise la web app. Rien n'est réimplémenté ici : tirer un
/// entier au hasard n'est pas du chiffrement, et le cœur Rust n'expose pas de générateur.
struct GeneratorOptions: Equatable {
    var length: Int = 20
    var lowercase = true
    var uppercase = true
    var digits = true
    var symbols = true
}

enum PasswordGenerator {
    private static let lowercase = "abcdefghijklmnopqrstuvwxyz"
    private static let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private static let digits = "0123456789"
    private static let symbols = "!@#$%^&*()-_=+[]{};:,.?/"

    /// Entier uniforme dans `[0, max)`. Le rejet des valeurs hautes évite le biais que
    /// produirait un simple modulo : sans lui, les premiers caractères du jeu sortiraient
    /// un peu plus souvent que les derniers.
    private static func randomIndex(_ max: Int) -> Int {
        precondition(max > 0)
        let limit = UInt32.max - (UInt32.max % UInt32(max))
        var value: UInt32 = 0
        repeat {
            var bytes = [UInt8](repeating: 0, count: 4)
            guard SecRandomCopyBytes(kSecRandomDefault, 4, &bytes) == errSecSuccess else {
                // Le générateur du système ne peut pas échouer en pratique ; s'il le
                // faisait, produire un mot de passe prévisible serait la pire réponse.
                fatalError("le générateur aléatoire du système est indisponible")
            }
            value = bytes.withUnsafeBytes { $0.load(as: UInt32.self) }
        } while value >= limit
        return Int(value % UInt32(max))
    }

    static func generate(_ options: GeneratorOptions) -> String {
        var sets: [String] = []
        if options.lowercase { sets.append(lowercase) }
        if options.uppercase { sets.append(uppercase) }
        if options.digits { sets.append(digits) }
        if options.symbols { sets.append(symbols) }
        // Tout décocher ne doit pas rendre un mot de passe vide.
        if sets.isEmpty { sets.append(lowercase) }

        let length = max(sets.count, min(128, options.length > 0 ? options.length : 20))
        let pool = Array(sets.joined())

        // Un caractère au moins de chaque jeu demandé : cocher « chiffres » et n'en
        // obtenir aucun serait un mot de passe qui ne respecte pas la consigne reçue.
        var chars: [Character] = sets.map { set in
            let characters = Array(set)
            return characters[randomIndex(characters.count)]
        }
        while chars.count < length {
            chars.append(pool[randomIndex(pool.count)])
        }

        // Mélange de Fisher-Yates : sans lui, les caractères garantis resteraient en tête,
        // et la position d'un chiffre trahirait la façon dont le mot de passe a été fait.
        for i in stride(from: chars.count - 1, to: 0, by: -1) {
            chars.swapAt(i, randomIndex(i + 1))
        }
        return String(chars)
    }
}
