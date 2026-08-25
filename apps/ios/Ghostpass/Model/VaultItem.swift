import Foundation

/// Miroir Swift du `VaultItem` du cœur Rust. Les noms de champs et le balisage de
/// l'énumération sont ceux de serde : toute divergence ici se traduirait par un item
/// que le cœur refuse de déchiffrer, ou pire, par un champ perdu en silence.
struct VaultItem: Codable, Hashable {
    var name: String
    var notes: String?
    var folder: String?
    var data: ItemData
}

/// `#[serde(tag = "kind", content = "data")]` côté Rust : `{"kind":"Login","data":{…}}`.
enum ItemData: Hashable {
    case login(Login)
    case secureNote(SecureNote)
    case card(Card)
}

struct Login: Codable, Hashable {
    var username: String = ""
    var password: String = ""
    var uris: [String] = []
    var totp: String?
    /// Anciens mots de passe, plus récent en tête.
    var passwordHistory: [String] = []

    enum CodingKeys: String, CodingKey {
        case username, password, uris, totp
        case passwordHistory = "password_history"
    }
}

struct SecureNote: Codable, Hashable {
    var content: String = ""
}

struct Card: Codable, Hashable {
    var cardholder: String = ""
    var number: String = ""
    var expMonth: String = ""
    var expYear: String = ""
    var code: String = ""

    enum CodingKeys: String, CodingKey {
        case cardholder, number, code
        case expMonth = "exp_month"
        case expYear = "exp_year"
    }
}

extension ItemData: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, data
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "Login": self = .login(try container.decode(Login.self, forKey: .data))
        case "SecureNote": self = .secureNote(try container.decode(SecureNote.self, forKey: .data))
        case "Card": self = .card(try container.decode(Card.self, forKey: .data))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container,
                debugDescription: "type d'item inconnu : \(kind)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .login(let value):
            try container.encode("Login", forKey: .kind)
            try container.encode(value, forKey: .data)
        case .secureNote(let value):
            try container.encode("SecureNote", forKey: .kind)
            try container.encode(value, forKey: .data)
        case .card(let value):
            try container.encode("Card", forKey: .kind)
            try container.encode(value, forKey: .data)
        }
    }
}

/// Un item tel qu'il vit dans l'app : le contenu déchiffré, plus l'identité serveur.
struct VaultEntry: Identifiable, Hashable {
    let id: String
    var item: VaultItem
    /// Millisecondes depuis l'epoch, telles que renvoyées par le serveur.
    var updatedAt: Int?

    var login: Login? {
        if case .login(let l) = item.data { return l }
        return nil
    }
}

enum VaultConstants {
    /// L'item qui stocke l'arborescence des dossiers porte un nom commençant par un
    /// octet NUL : il est invisible dans l'UI web, il doit l'être ici aussi. Un nom
    /// choisi par l'utilisateur ne peut pas entrer en collision avec celui-là.
    static let foldersItemName = "\u{0}gp:folders"
}
