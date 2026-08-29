import CryptoKit
import Foundation

/// Codes TOTP (RFC 6238), transposition de `apps/web/src/lib/totp.ts`.
///
/// Le secret vit dans l'item chiffré et ne quitte jamais l'appareil. Le HMAC vient de
/// CryptoKit, la bibliothèque du système — exactement ce que fait la web app avec
/// WebCrypto. Rien n'est réimplémenté : seule la mécanique de la RFC est ici.
struct OtpConfig: Equatable {
    var secret: String
    var period: Int = 30
    var digits: Int = 6
    var algorithm: Algorithm = .sha1

    enum Algorithm: String, Equatable {
        case sha1, sha256, sha512
    }
}

enum Totp {
    /// Accepte un secret base32 brut ou une URI `otpauth://`. Renvoie `nil` si le champ
    /// est vide ou inexploitable — un item sans TOTP est le cas courant, pas une erreur.
    static func parse(_ input: String) -> OtpConfig? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        var secret = trimmed
        var config = OtpConfig(secret: "")

        if trimmed.lowercased().hasPrefix("otpauth://") {
            guard let components = URLComponents(string: trimmed) else { return nil }
            let items = components.queryItems ?? []
            func value(_ name: String) -> String? {
                items.first { $0.name == name }?.value
            }
            secret = value("secret") ?? ""
            config.period = value("period").flatMap(Int.init) ?? 30
            config.digits = value("digits").flatMap(Int.init) ?? 6
            switch value("algorithm")?.uppercased() {
            case "SHA256": config.algorithm = .sha256
            case "SHA512": config.algorithm = .sha512
            default: config.algorithm = .sha1
            }
        }

        config.secret = secret.replacingOccurrences(
            of: "\\s", with: "", options: .regularExpression
        ).uppercased()
        guard !config.secret.isEmpty else { return nil }
        // Des paramètres absurdes valent mieux corrigés que propagés jusqu'au calcul.
        if config.period <= 0 { config.period = 30 }
        if !(1...9).contains(config.digits) { config.digits = 6 }
        return config
    }

    /// Le code courant et le nombre de secondes qu'il lui reste à vivre.
    static func code(for config: OtpConfig, at date: Date = Date()) -> (
        code: String, remaining: Int
    )? {
        let key = base32Decode(config.secret)
        guard !key.isEmpty else { return nil }

        let seconds = Int(date.timeIntervalSince1970)
        let counter = UInt64(seconds / config.period)
        var message = Data(count: 8)
        for index in 0..<8 {
            message[index] = tronquerEnOctet(counter >> (8 * UInt64(7 - index)))
        }

        let secret = SymmetricKey(data: key)
        let digest: Data
        switch config.algorithm {
        case .sha1:
            digest = Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: secret))
        case .sha256: digest = Data(HMAC<SHA256>.authenticationCode(for: message, using: secret))
        case .sha512: digest = Data(HMAC<SHA512>.authenticationCode(for: message, using: secret))
        }

        // Troncature dynamique de la RFC : les quatre derniers bits désignent l'offset.
        let offset = Int(digest[digest.count - 1] & 0x0f)
        let binary =
            (UInt32(digest[offset] & 0x7f) << 24)
            | (UInt32(digest[offset + 1]) << 16)
            | (UInt32(digest[offset + 2]) << 8)
            | UInt32(digest[offset + 3])
        // En 64 bits : 10^10 déborde d'un UInt32, et un `digits` fantaisiste ne doit pas
        // faire tomber l'application.
        let modulo = UInt64(pow(10, Double(config.digits)))
        let code = String(format: "%0\(config.digits)llu", UInt64(binary) % modulo)
        let remaining = config.period - (seconds % config.period)
        return (code, remaining)
    }

    private static func tronquerEnOctet(_ value: UInt64) -> UInt8 { UInt8(value & 0xff) }

    /// Base32 (RFC 4648) sans padding, caractères inconnus ignorés — les secrets
    /// recopiés à la main arrivent souvent avec des espaces ou des tirets.
    private static func base32Decode(_ input: String) -> Data {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var out = Data()
        var bits = 0
        var value = 0
        for character in input.uppercased() where character != "=" {
            guard let index = alphabet.firstIndex(of: character) else { continue }
            value = (value << 5) | index
            bits += 5
            if bits >= 8 {
                out.append(UInt8((value >> (bits - 8)) & 0xff))
                bits -= 8
            }
        }
        return out
    }
}
