import SwiftUI

/// L'état de santé du coffre, calculé entièrement sur l'appareil.
///
/// Le barème est celui de la web app, au point près : longueur et variété de caractères.
/// Ce n'est pas une science — aucune formule ne dit si un mot de passe a fuité — mais
/// c'est une mesure reproductible, et surtout la même des deux côtés. Un mot de passe
/// jugé faible dans le navigateur doit l'être aussi sur le téléphone, sans quoi les deux
/// écrans se contrediraient sur le même coffre.
enum PasswordHealth {
    struct Force {
        /// De 0 (très faible) à 4 (très bon).
        let niveau: Int

        var libelle: LocalizedStringKey {
            switch niveau {
            case 0: return "Très faible"
            case 1: return "Faible"
            case 2: return "Moyen"
            case 3: return "Bon"
            default: return "Très bon"
            }
        }

        var couleur: Color {
            switch niveau {
            case 0, 1: return .gpDanger
            case 2: return .gpAccentText
            default: return .gpSuccess
            }
        }
    }

    static func force(_ motDePasse: String) -> Force {
        guard !motDePasse.isEmpty else { return Force(niveau: 0) }
        var score = 0
        if motDePasse.count >= 8 { score += 1 }
        if motDePasse.count >= 14 { score += 1 }
        if motDePasse.count >= 20 { score += 1 }
        let classes = [
            CharacterSet.lowercaseLetters, .uppercaseLetters, .decimalDigits,
        ].filter { jeu in motDePasse.unicodeScalars.contains { jeu.contains($0) } }.count
        let autres = motDePasse.unicodeScalars.contains { scalaire in
            !CharacterSet.alphanumerics.contains(scalaire)
        }
        let varietes = classes + (autres ? 1 : 0)
        if varietes >= 2 { score += 1 }
        if varietes >= 3 { score += 1 }
        return Force(niveau: min(4, Int((Double(score) / 5 * 4).rounded())))
    }

    /// Ce qu'un coffre a de fragile. Trois listes plutôt qu'une note globale : une note
    /// ne dit pas quoi corriger, et c'est la seule chose qui compte ici.
    struct Bilan {
        var faibles: [VaultEntry] = []
        var reutilises: [VaultEntry] = []
        var sansCode: [VaultEntry] = []

        var estSain: Bool { faibles.isEmpty && reutilises.isEmpty }
    }

    static func bilan(_ entries: [VaultEntry]) -> Bilan {
        var occurrences: [String: Int] = [:]
        for entry in entries {
            guard let mot = entry.login?.password, !mot.isEmpty else { continue }
            occurrences[mot, default: 0] += 1
        }

        var bilan = Bilan()
        for entry in entries {
            guard let login = entry.login else { continue }
            if !login.password.isEmpty {
                if force(login.password).niveau <= 1 { bilan.faibles.append(entry) }
                if occurrences[login.password, default: 0] > 1 { bilan.reutilises.append(entry) }
            }
            if login.totp?.isEmpty ?? true { bilan.sansCode.append(entry) }
        }
        return bilan
    }
}
