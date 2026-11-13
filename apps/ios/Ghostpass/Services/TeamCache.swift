import Foundation

/// La copie locale des **coffres d'équipe**, pour le remplissage automatique.
///
/// ─── Pourquoi ce fichier existe ───
///
/// `VaultCache` ne dépose que ce que rend `listItems` : le coffre **personnel**. Les
/// coffres d'équipe sont chargés juste après et fusionnés à l'affichage, mais n'ont jamais
/// été déposés. Pour qui range ses mots de passe en organisation — c'est le cas de la
/// première utilisatrice — la copie que lit l'extension est donc légitimement vide, et le
/// remplissage annonce « Aucun identifiant » sur tous les sites du monde.
///
/// Le message décrivait son écran sans rien dire de la cause, et ressemblait à s'y
/// méprendre à un défaut d'appariement de domaine. Il a fallu rendre l'état visible dans
/// les réglages pour que « 0 élément » désigne enfin le bon endroit.
///
/// ─── Ce que ce dépôt contient, et ce qu'il n'ajoute pas ───
///
/// Pour chaque organisation : ses éléments **tels que le serveur les détient**, c'est-à-dire
/// scellés sous l'Org Key, plus les deux blobs qui permettent de déballer cette Org Key —
/// la clé scellée pour ce compte et la clé publique de qui l'a scellée.
///
/// Cela **n'élargit pas** ce que l'extension peut ouvrir. Elle possède déjà, par la session
/// partagée, de quoi reconstituer la clé privée du compte une fois le mot de passe maître
/// donné ; avec elle et ces deux blobs, elle refait exactement ce que fait l'application.
/// Ce qui change est qu'elle n'a plus besoin du réseau pour le faire — et c'est la règle de
/// l'extension : un remplissage doit aboutir dans un ascenseur.
///
/// Rien ici n'est en clair. Un coffre d'équipe sans clé remise n'est pas déposé du tout,
/// plutôt que déposé illisible.
struct CoffreDEquipeEnCache: Codable {
    let organisation: String
    let nom: String
    /// La clé publique de l'administrateur qui a scellé l'Org Key pour ce compte.
    let adminPublicKey: String
    /// L'Org Key, scellée pour ce compte.
    let encryptedOrgKey: String
    /// Les collections, **avec leur nom**.
    ///
    /// Le dépôt ne gardait qu'une liste d'éléments à plat : assez pour l'extension, qui ne
    /// cherche qu'un identifiant à remplir, et pas assez pour l'application, dont chaque
    /// ligne annonce « équipe · collection ». Hors ligne, les mêmes éléments s'affichaient
    /// donc sans dire d'où ils venaient — ou, avant le 2026-11-13, ne s'affichaient pas.
    let collections: [CollectionEnCache]

    /// Tous les éléments de l'équipe, à plat — ce que lit l'extension, qui n'a que faire
    /// des collections. Calculé, donc jamais écrit deux fois dans le fichier.
    var items: [EncryptedItemDTO] { collections.flatMap(\.items) }

    init(
        organisation: String, nom: String, adminPublicKey: String, encryptedOrgKey: String,
        collections: [CollectionEnCache],
    ) {
        self.organisation = organisation
        self.nom = nom
        self.adminPublicKey = adminPublicKey
        self.encryptedOrgKey = encryptedOrgKey
        self.collections = collections
    }

    /// Relit aussi un dépôt écrit **avant** les collections : ses éléments à plat
    /// deviennent une collection sans nom. Sans ce repli, le fichier d'hier ne se décoderait
    /// pas du tout, et le remplissage annoncerait « Aucun identifiant » jusqu'au prochain
    /// passage en ligne — une panne que personne ne relierait à une mise à jour.
    init(from decodeur: Decoder) throws {
        let conteneur = try decodeur.container(keyedBy: CodingKeys.self)
        organisation = try conteneur.decode(String.self, forKey: .organisation)
        nom = try conteneur.decode(String.self, forKey: .nom)
        adminPublicKey = try conteneur.decode(String.self, forKey: .adminPublicKey)
        encryptedOrgKey = try conteneur.decode(String.self, forKey: .encryptedOrgKey)
        if let collections = try conteneur.decodeIfPresent(
            [CollectionEnCache].self, forKey: .collections)
        {
            self.collections = collections
        } else {
            let plats = try conteneur.decodeIfPresent(
                [EncryptedItemDTO].self, forKey: .items) ?? []
            collections = [CollectionEnCache(id: "", nom: "", items: plats)]
        }
    }

    /// Écrit sans `items` : le champ n'existe plus que pour relire un dépôt d'hier.
    func encode(to encodeur: Encoder) throws {
        var conteneur = encodeur.container(keyedBy: CodingKeys.self)
        try conteneur.encode(organisation, forKey: .organisation)
        try conteneur.encode(nom, forKey: .nom)
        try conteneur.encode(adminPublicKey, forKey: .adminPublicKey)
        try conteneur.encode(encryptedOrgKey, forKey: .encryptedOrgKey)
        try conteneur.encode(collections, forKey: .collections)
    }

    private enum CodingKeys: String, CodingKey {
        case organisation, nom, adminPublicKey, encryptedOrgKey, collections
        /// L'ancien champ, lu et jamais réécrit.
        case items
    }
}

/// Une collection d'équipe telle que la copie locale la garde.
struct CollectionEnCache: Codable {
    let id: String
    let nom: String
    let items: [EncryptedItemDTO]
}

enum TeamCache {
    private static let fileName = "team-cache.json"

    private static var url: URL? {
        guard let directory = SharedStore.container else { return nil }
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(fileName)
    }

    static func save(_ coffres: [CoffreDEquipeEnCache]) {
        guard let url, let data = try? JSONEncoder().encode(coffres) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        var ressource = URLResourceValues()
        ressource.isExcludedFromBackup = true
        var copie = url
        try? copie.setResourceValues(ressource)
    }

    /// `nil` s'il n'y a rien, ou si le fichier n'est plus lisible — comme pour le coffre
    /// personnel, un cache illisible est un coffre à recharger, pas une erreur à remonter.
    static func load() -> [CoffreDEquipeEnCache]? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([CoffreDEquipeEnCache].self, from: data)
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
