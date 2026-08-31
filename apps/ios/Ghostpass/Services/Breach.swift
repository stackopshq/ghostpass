import CryptoKit
import Foundation

/// Vérification de fuite auprès de Have I Been Pwned, en k-anonymat.
///
/// Transposition de `apps/web/src/lib/breach.ts`. Seuls les cinq premiers caractères du
/// SHA-1 du mot de passe partent sur le réseau ; le mot de passe — et même son empreinte
/// complète — ne quitte jamais l'appareil. Le service renvoie tous les suffixes connus
/// pour ce préfixe, et la correspondance se fait ici.
///
/// C'est le seul endroit de l'application qui parle à un tiers. L'appel n'a donc jamais
/// lieu tout seul : il faut que quelqu'un demande explicitement la vérification.
enum Breach {
    /// SHA-1 est cassé pour signer, mais l'API de HIBP est indexée ainsi et une empreinte
    /// n'est ici qu'une clef de recherche. Rien de tout cela ne touche au coffre : le
    /// chiffrement reste l'affaire du cœur Rust.
    private static func sha1Hex(_ texte: String) -> String {
        Insecure.SHA1.hash(data: Data(texte.utf8))
            .map { String(format: "%02X", $0) }
            .joined()
    }

    /// Le nombre d'apparitions du mot de passe dans des fuites connues — 0 s'il n'y figure
    /// pas.
    static func pwnedCount(_ motDePasse: String) async throws -> Int {
        guard !motDePasse.isEmpty else { return 0 }
        let empreinte = sha1Hex(motDePasse)
        let prefixe = String(empreinte.prefix(5))
        let suffixe = String(empreinte.dropFirst(5))

        guard let url = URL(string: "https://api.pwnedpasswords.com/range/\(prefixe)") else {
            return 0
        }
        var requete = URLRequest(url: url)
        // Le service ajoute alors des entrées factices : la taille de la réponse cesse de
        // renseigner sur le nombre de correspondances réelles.
        requete.setValue("true", forHTTPHeaderField: "Add-Padding")
        requete.timeoutInterval = 15

        let (data, reponse) = try await URLSession.shared.data(for: requete)
        guard let http = reponse as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BreachError.indisponible
        }

        for ligne in String(decoding: data, as: UTF8.self).split(separator: "\n") {
            let morceaux = ligne.trimmingCharacters(in: .whitespaces).split(separator: ":")
            guard morceaux.count == 2, morceaux[0] == suffixe else { continue }
            return Int(morceaux[1]) ?? 0
        }
        return 0
    }
}

enum BreachError: Error {
    case indisponible
}
