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

    /// Qui délivre le code, et pour quel compte.
    ///
    /// Une URI `otpauth` porte cela dans son chemin — `otpauth://totp/GitHub:clara` — et
    /// parfois en double dans le paramètre `issuer`. Les deux sources se contredisent
    /// dans la nature ; le paramètre fait foi, parce qu'il n'a pas à être échappé.
    ///
    /// Sert à pré-remplir un élément créé depuis un lien. Rien de tout cela n'entre dans
    /// le calcul du code : c'est de l'affichage, et une étiquette absente ne doit donc
    /// jamais empêcher d'enregistrer un secret parfaitement valide.
    static func etiquette(_ uri: String) -> (service: String?, compte: String?) {
        guard uri.lowercased().hasPrefix("otpauth://"),
            let composants = URLComponents(string: uri)
        else { return (nil, nil) }

        let parametre = composants.queryItems?.first { $0.name == "issuer" }?.value
        // `URLComponents` rend le chemin déjà déséchappé : « /GitHub:clara ».
        let chemin =
            composants.path.hasPrefix("/")
            ? String(composants.path.dropFirst()) : composants.path

        var service = parametre
        var compte: String?
        if let separateur = chemin.firstIndex(of: ":") {
            service = service ?? String(chemin[chemin.startIndex..<separateur])
            compte = String(chemin[chemin.index(after: separateur)...])
        } else if !chemin.isEmpty {
            // Sans deux-points, le chemin est le compte — sauf s'il est le seul indice
            // qu'on ait du service, auquel cas il vaut mieux le montrer que rien.
            compte = chemin
        }

        func nettoyer(_ v: String?) -> String? {
            let t = v?.trimmingCharacters(in: .whitespaces)
            return (t?.isEmpty ?? true) ? nil : t
        }
        return (nettoyer(service), nettoyer(compte))
    }

    /// Ce qu'un QR code s'est révélé contenir.
    enum LectureDeQrCode: Equatable {
        case totp(String)
        /// `otpauth-migration://` — l'export d'une application d'authentification, qui
        /// emporte plusieurs comptes dans un format protobuf compressé. Ce n'est pas un
        /// second facteur, et le confondre avec l'un d'eux donnerait des codes faux.
        case exportDApplication
        case autreChose
    }

    /// Ce qu'on retient d'un QR code, et ce qu'on refuse.
    ///
    /// Plus strict que `parse`, délibérément : celui-ci accepte un secret base32 nu, parce
    /// qu'un utilisateur qui tape dans le champ sait ce qu'il y met. Un QR code, lui, peut
    /// contenir n'importe quoi — une adresse web, un réseau Wi-Fi, un billet de train — et
    /// `parse` retiendrait ces chaînes comme un secret, faute de pouvoir distinguer un
    /// secret d'un mot quelconque. On exige donc l'URI `otpauth://`, qui est ce que les
    /// sites affichent réellement.
    static func depuisUnQrCode(_ charge: String) -> LectureDeQrCode {
        let propre = charge.trimmingCharacters(in: .whitespacesAndNewlines)
        if propre.lowercased().hasPrefix("otpauth-migration://") {
            return .exportDApplication
        }
        // Le **type** compte, et pas seulement le schéma. `otpauth://hotp/…` est une URI
        // parfaitement valide dont le secret compte des événements et non le temps :
        // acceptée, elle produirait des codes calculés sur l'horloge, donc faux, **sans
        // aucune erreur**. Le site afficherait « code incorrect » et personne ne saurait
        // que le tort vient d'ici.
        //
        // Trouvé le 2026-08-31 par l'agent qui portait le client Android : le test
        // annonçait « seul un lien de TOTP est retenu », et rien ne le vérifiait.
        guard propre.lowercased().hasPrefix("otpauth://"),
            URLComponents(string: propre)?.host?.lowercased() == "totp",
            parse(propre) != nil
        else {
            return .autreChose
        }
        return .totp(propre)
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
