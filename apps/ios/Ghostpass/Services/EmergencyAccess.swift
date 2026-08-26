import Foundation

/// Ce qui sait ouvrir un item chiffré : le compte pour son propre coffre, le coffre d'urgence
/// pour celui d'un donneur. Les deux viennent du cœur Rust et portent la même méthode ; le
/// protocole évite de réécrire la construction de l'enveloppe une seconde fois.
protocol DechiffreurDItems {
    func decryptItem(encryptedItemJson: String) throws -> String
}

extension Account: DechiffreurDItems {}
extension EmergencyVault: DechiffreurDItems {}

extension DechiffreurDItems {
    /// Reconstruit l'enveloppe attendue par le cœur et rend l'item en clair.
    func ouvrir(_ dto: EncryptedItemDTO) throws -> VaultItem {
        let enveloppe = ["encrypted_key": dto.encryptedKey, "encrypted_data": dto.encryptedData]
        let json = String(data: try JSONEncoder().encode(enveloppe), encoding: .utf8) ?? "{}"
        let clair = try decryptItem(encryptedItemJson: json)
        return try JSONDecoder().decode(VaultItem.self, from: Data(clair.utf8))
    }
}

/// Rôle confié au contact. `view` lit le coffre ; `takeover` permet en plus d'imposer un
/// nouveau mot de passe maître au donneur — ce qui l'en exclut, donc.
enum RoleDUrgence: String, CaseIterable, Identifiable {
    case view
    case takeover

    var id: String { rawValue }

    @MainActor
    var intitule: String {
        switch self {
        case .view: return tr("Lecture seule")
        case .takeover: return tr("Reprise du compte")
        }
    }

    @MainActor
    var explication: String {
        switch self {
        case .view: return tr("Le contact pourra lire vos identifiants, sans rien y changer ni vous en priver.")
        case .takeover: return tr("Le contact pourra en plus choisir un nouveau mot de passe maître — ce qui vous exclura de votre propre coffre.")
        }
    }
}

/// Où en est un lien d'urgence. Les valeurs viennent du serveur ; on ne les invente pas.
enum EtatDUrgence: String {
    case invited
    case accepted
    case requested
    case granted
    case rejected

    @MainActor
    var intitule: String {
        switch self {
        case .invited: return tr("Invitation envoyée")
        case .accepted: return tr("Contact accepté")
        case .requested: return tr("Accès demandé")
        case .granted: return tr("Accès ouvert")
        case .rejected: return tr("Demande refusée")
        }
    }
}

/// Un lien d'urgence prêt à afficher : le DTO du serveur, débarrassé de ses chaînes libres.
struct LienDUrgence: Identifiable {
    let id: String
    let contactEmail: String
    let role: RoleDUrgence
    let waitDays: Int
    let etat: EtatDUrgence
    let requestedAt: Date?
    /// Seulement dans le sens « je suis le contact » : le délai est-il écoulé.
    let disponible: Bool

    init?(_ dto: EmergencyContactDTO) {
        guard let role = RoleDUrgence(rawValue: dto.role),
            let etat = EtatDUrgence(rawValue: dto.status)
        else { return nil }
        self.id = dto.id
        self.contactEmail = dto.contactEmail
        self.role = role
        self.waitDays = dto.waitDays
        self.etat = etat
        self.requestedAt = dto.requestedAt.map {
            Date(timeIntervalSince1970: TimeInterval($0) / 1000)
        }
        self.disponible = dto.available ?? false
    }

    /// Moment où l'accès s'ouvrira, si une demande court. Le serveur tranche pour de bon —
    /// ceci ne sert qu'à l'afficher, jamais à décider.
    func ouverturePrevue() -> Date? {
        guard etat == .requested, let requestedAt else { return nil }
        return requestedAt.addingTimeInterval(TimeInterval(waitDays) * 86_400)
    }
}
