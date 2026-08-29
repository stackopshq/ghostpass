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
/// D'où vient un élément : du coffre personnel, ou d'une collection d'équipe.
///
/// Ce n'est pas une décoration. Les deux coffres ne se chiffrent pas avec la même clé et
/// ne s'écrivent pas par les mêmes routes : enregistrer un élément d'équipe par l'API
/// personnelle en créerait une copie privée au lieu de mettre à jour l'original, et
/// l'équipe ne verrait jamais la modification. L'origine voyage donc avec l'élément,
/// depuis son déchiffrement jusqu'au bouton qui l'enregistre.
/// Où vit un élément partagé, et ce qu'on a le droit d'y faire.
struct Appartenance: Hashable {
    let organisation: String
    let collection: String
    let nomEquipe: String
    let nomCollection: String
    /// Peut-on écrire dans cette collection ?
    ///
    /// Renseigné depuis la permission *effective* que le serveur calcule et renvoie avec
    /// chaque collection. Ce fut d'abord une approximation par le rôle d'organisation,
    /// faute que la route expose autre chose : un membre ordinaire se voyait alors
    /// proposer « Modifier » sur une collection où il n'a que la lecture. Le champ existe
    /// depuis le 2026-08-29 ; le rôle ne sert plus que de repli pour un serveur plus
    /// ancien.
    let peutEcrire: Bool
}

enum OrigineDuCoffre: Hashable {
    case personnel
    case equipe(Appartenance)

    var estPartage: Bool {
        if case .equipe = self { return true }
        return false
    }

    /// Ce que la pastille affiche : « équipe · collection ». Les deux, parce que savoir
    /// *laquelle* compte dès qu'on appartient à plusieurs équipes, et qu'une collection
    /// n'a de sens qu'associée à la sienne.
    var etiquette: String? {
        guard case .equipe(let ou) = self else { return nil }
        return "\(ou.nomEquipe) · \(ou.nomCollection)"
    }

    /// L'appartenance, quand il y en a une.
    var appartenance: Appartenance? {
        if case .equipe(let ou) = self { return ou }
        return nil
    }

    /// Le nom de l'équipe seul, pour la recherche.
    var nomDeLEquipe: String? { appartenance?.nomEquipe }
}

/// Ce que la liste affiche : tout, un dossier personnel, ou une collection d'équipe.
///
/// Les dossiers et les collections se ressemblent à l'écran mais ne sont pas de même
/// nature : un dossier est un rangement privé, une collection est une frontière de
/// partage. Les distinguer dans le type évite de traiter l'un comme l'autre.
enum FiltreDuCoffre: Hashable {
    case tout
    case dossier(String)
    case collection(organisation: String, collection: String, nom: String)

    var estTout: Bool {
        if case .tout = self { return true }
        return false
    }

    /// Cette entrée entre-t-elle dans le filtre ?
    func retient(_ entry: VaultEntry) -> Bool {
        switch self {
        case .tout:
            return true
        case .dossier(let chemin):
            // Un dossier contient aussi ce que rangent ses sous-dossiers.
            let range = entry.item.folder ?? ""
            return range == chemin || range.hasPrefix(chemin + "/")
        case .collection(_, let collection, _):
            return entry.origine.appartenance?.collection == collection
        }
    }
}

struct VaultEntry: Identifiable, Hashable {
    let id: String
    var item: VaultItem
    /// Millisecondes depuis l'epoch, telles que renvoyées par le serveur.
    var updatedAt: Int?
    var origine: OrigineDuCoffre = .personnel

    var login: Login? {
        if case .login(let l) = item.data { return l }
        return nil
    }
}

enum VaultConstants {
    /// Le coffre ne connaît que des éléments chiffrés : tout ce que l'application doit
    /// retenir en plus — la liste des dossiers vides, celle des favoris — vit donc dans
    /// des éléments comme les autres, sous un nom commençant par un octet NUL. Aucun nom
    /// choisi par l'utilisateur ne peut entrer en collision avec celui-là, et l'interface
    /// masque tout ce qui commence ainsi plutôt que d'énumérer les registres un par un :
    /// c'est ce qui permet d'en ajouter un sans faire apparaître de ligne fantôme dans
    /// les autres applications de la suite.
    static let registryPrefix = "\u{0}gp:"

    /// Les dossiers vides — ceux qu'aucun élément n'habite.
    static let foldersItemName = registryPrefix + "folders"

    /// Les identifiants des éléments mis en favori.
    static let favoritesItemName = registryPrefix + "favorites"

    /// Combien d'anciens mots de passe un élément conserve. Le même nombre que la web
    /// app : un historique plus long d'un côté que de l'autre ferait croire à une perte.
    static let passwordHistoryLimit = 20
}
