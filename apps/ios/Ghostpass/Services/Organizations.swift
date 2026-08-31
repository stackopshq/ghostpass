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

/// Un membre d'équipe, vu par un administrateur.
struct MembreDEquipe: Identifiable {
    let id: String
    let email: String?
    let role: RoleDOrganisation
    let etat: EtatDAppartenance

    init?(_ dto: OrgMemberDTO) {
        guard let role = RoleDOrganisation(rawValue: dto.role),
            let etat = EtatDAppartenance(rawValue: dto.status)
        else { return nil }
        self.id = dto.userId
        self.email = dto.email
        self.role = role
        self.etat = etat
    }
}

/// Ce qu'un groupe peut faire d'une collection.
enum DroitSurCollection: String, CaseIterable, Identifiable {
    case read
    case write
    case manage

    var id: String { rawValue }

    @MainActor
    var intitule: String {
        switch self {
        case .read: return tr("Lecture")
        case .write: return tr("Écriture")
        case .manage: return tr("Gestion")
        }
    }
}

/// Ce qui empêche une rotation d'aboutir, quand la faute n'est pas technique.
///
/// Pas de `LocalizedError` ici : `errorDescription` est appelé hors du fil principal, alors
/// que la traduction dépend de la langue choisie et vit sur le `MainActor`. L'erreur porte
/// donc de quoi composer son message, et c'est l'affichage qui le compose.
enum RotationImpossible: Error {
    /// Un membre restant dont on n'a pas pu obtenir la clé publique. Le sauter reviendrait à
    /// l'exclure sans le dire : il ne recevrait pas la nouvelle Org Key et perdrait l'accès
    /// au prochain déverrouillage, sans que personne ne l'ait décidé.
    case cleIntrouvable(membre: String)

    @MainActor
    var message: String {
        switch self {
        case .cleIntrouvable(let membre):
            return String(
                format: tr("Impossible d'obtenir la clé publique de %@ : rotation annulée."),
                membre)
        }
    }
}

/// L'accès effectif de quelqu'un sur une collection, tel que le serveur le calcule.
struct AccesNomme: Identifiable {
    let id: String
    let email: String?
    let droit: DroitSurCollection
    /// D'où vient cet accès, en clair. Les libellés viennent du serveur : lui seul sait
    /// de quel groupe il s'agit.
    let origines: [String]
    /// Cette ligne se retire-t-elle depuis cet écran ?
    ///
    /// Faux pour un accès qui vient du rôle ou d'un groupe : le bouton n'a alors rien à
    /// faire là. Le serveur tranche, plutôt que la vue devine — c'est ce qui évite de
    /// promettre une révocation qui ne ferme rien.
    let revocable: Bool

    /// Un droit que cette version ne connaît pas fait écarter la ligne : mieux vaut une
    /// entrée absente qu'une entrée dont le libellé mentirait sur ce qu'elle autorise.
    init?(_ dto: OrgCollectionAccessDTO) {
        guard let droit = DroitSurCollection(rawValue: dto.permission) else { return nil }
        self.id = dto.userId
        self.email = dto.email
        self.droit = droit
        self.origines = dto.sources.map(\.label)
        self.revocable = dto.revocable
    }
}
