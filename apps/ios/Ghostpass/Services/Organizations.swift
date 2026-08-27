import Foundation

/// Le coffre d'organisation ouvre les items comme le compte ouvre les siens : même
/// enveloppe, autre clé d'enveloppe. Voir `DechiffreurDItems`.
extension Org: DechiffreurDItems {}

/// Ce qu'un membre peut faire dans une organisation. Les valeurs viennent du serveur, qui
/// reste seul juge : ces rôles ne servent ici qu'à ne pas proposer un geste qui sera refusé.
enum RoleDOrganisation: String {
    case admin
    case member
    case readonly

    @MainActor
    var intitule: String {
        switch self {
        case .admin: return tr("Administrateur")
        case .member: return tr("Membre")
        case .readonly: return tr("Lecture seule")
        }
    }

    /// Peut-on écrire dans le coffre partagé ?
    var peutEcrire: Bool { self != .readonly }
}

enum EtatDAppartenance: String {
    case invited
    case active
    case revoked

    @MainActor
    var intitule: String {
        switch self {
        case .invited: return tr("Invitation reçue")
        case .active: return tr("Membre actif")
        case .revoked: return tr("Accès révoqué")
        }
    }
}

/// Une organisation telle qu'elle se présente dans la liste.
struct Organisation: Identifiable {
    let id: String
    let nom: String
    let role: RoleDOrganisation
    let etat: EtatDAppartenance

    init?(_ dto: OrgSummaryDTO) {
        guard let role = RoleDOrganisation(rawValue: dto.role),
            let etat = EtatDAppartenance(rawValue: dto.status)
        else { return nil }
        self.id = dto.orgId
        self.nom = dto.name
        self.role = role
        self.etat = etat
    }
}

/// Un coffre partagé ouvert : ses collections, et l'`Org` du cœur Rust qui détient l'Org Key.
///
/// Rien n'est mis en cache hors ligne, contrairement au coffre personnel. Un coffre partagé
/// se révoque — garder une copie locale déchiffrable après un départ irait contre la
/// rotation d'Org Key, qui est justement la façon de reprendre ses clés à quelqu'un.
struct CoffrePartageOuvert {
    let organisation: Organisation
    let collections: [OrgCollectionDTO]
    let org: Org
}
