import SwiftUI

/// Les deux réglages que l'utilisateur impose à l'application : son apparence et sa langue.
///
/// L'un et l'autre suivent le système par défaut — c'est ce qu'attend quelqu'un qui a déjà
/// réglé son téléphone —, mais le défaut n'est pas une fatalité : un coffre s'ouvre aussi
/// bien dans un train de nuit que dans un bureau en plein soleil, et la langue du téléphone
/// n'est pas toujours celle dans laquelle on veut lire ses mots de passe.
///
/// Le choix vit dans les préférences du groupe d'applications plutôt que dans celles de
/// l'app : l'extension de remplissage automatique est un autre processus, et une fenêtre
/// surgie en plein Safari qui reviendrait au thème clair trahirait qu'il s'agit d'un
/// morceau rapporté.
@MainActor
final class Preferences: ObservableObject {
    static let shared = Preferences()

    @Published var apparence: Apparence {
        didSet { defaults?.set(apparence.rawValue, forKey: Clefs.apparence) }
    }

    @Published var langue: Langue {
        didSet { defaults?.set(langue.rawValue, forKey: Clefs.langue) }
    }

    /// Afficher l'icône des sites. Le coffre est chiffré de bout en bout : le serveur n'en
    /// connaît pas le contenu. Réclamer une icône, en revanche, lui nomme un domaine — le
    /// choix revient donc à l'utilisateur, et il est réversible.
    @Published var afficheLesIcones: Bool {
        didSet { defaults?.set(afficheLesIcones, forKey: Clefs.icones) }
    }

    private let defaults = UserDefaults(suiteName: SharedStore.appGroup)

    private enum Clefs {
        static let apparence = "gp.apparence"
        static let langue = "gp.langue"
        static let icones = "gp.icones"
    }

    private init() {
        let lus = UserDefaults(suiteName: SharedStore.appGroup)
        apparence = Apparence(rawValue: lus?.string(forKey: Clefs.apparence) ?? "") ?? .systeme
        langue = Langue(rawValue: lus?.string(forKey: Clefs.langue) ?? "") ?? .systeme
        // Allumé par défaut, comme sur le web : une liste de pastilles grises se reconnaît
        // moins vite qu'une liste de logos, et le proxy est celui du serveur de l'utilisateur.
        afficheLesIcones = lus?.object(forKey: Clefs.icones) as? Bool ?? true
    }

    /// `nil` laisse SwiftUI suivre le réglage du système.
    var colorScheme: ColorScheme? { apparence.colorScheme }

    /// `nil` laisse le système choisir parmi les langues que l'app connaît.
    var locale: Locale? { langue.locale }

    /// Le paquet de la langue choisie ; celui de l'application quand on suit le système.
    /// C'est lui, et non la locale, qui décide dans quel `.lproj` la traduction est lue.
    var bundle: Bundle {
        guard let code = langue.code,
            let chemin = Bundle.main.path(forResource: code, ofType: "lproj"),
            let paquet = Bundle(path: chemin)
        else { return .main }
        return paquet
    }
}

/// Traduit une chaîne fabriquée en code — un message d'erreur, surtout — dans la langue
/// choisie par l'utilisateur.
///
/// `Text("…")` passe par le catalogue tout seul, avec la locale de l'environnement. Une
/// `String` construite dans un service, elle, ne traverse aucune vue : sans cette fonction
/// elle resterait en français au milieu d'une interface anglaise. Le littéral reste écrit
/// en clair pour que la compilation continue de l'extraire vers le catalogue.
@MainActor
func tr(_ valeur: String.LocalizationValue) -> String {
    String(
        localized: valeur, bundle: Preferences.shared.bundle,
        locale: Preferences.shared.locale ?? .autoupdatingCurrent)
}

/// Système, clair, sombre — les trois états qu'offre iOS lui-même.
enum Apparence: String, CaseIterable, Identifiable {
    case systeme
    case clair
    case sombre

    var id: String { rawValue }

    var colorScheme: ColorScheme? {
        switch self {
        case .systeme: return nil
        case .clair: return .light
        case .sombre: return .dark
        }
    }

    /// Traduit par le catalogue, comme le reste de l'interface.
    var libelle: LocalizedStringKey {
        switch self {
        case .systeme: return "Système"
        case .clair: return "Clair"
        case .sombre: return "Sombre"
        }
    }

    var icone: String {
        switch self {
        case .systeme: return "circle.lefthalf.filled"
        case .clair: return "sun.max"
        case .sombre: return "moon.stars"
        }
    }
}

/// Les langues dans lesquelles l'application existe. En ajouter une, c'est ajouter un cas
/// ici et une colonne au catalogue — le reste du code n'en sait rien.
enum Langue: String, CaseIterable, Identifiable {
    case systeme
    case francais
    case anglais

    var id: String { rawValue }

    var code: String? {
        switch self {
        case .systeme: return nil
        case .francais: return "fr"
        case .anglais: return "en"
        }
    }

    var locale: Locale? { code.map(Locale.init(identifier:)) }

    /// Le nom d'une langue s'écrit dans cette langue : quelqu'un qui cherche l'anglais
    /// cherche « English », pas « Anglais ». D'où `nil` pour le cas « Système », seul
    /// libellé de cette liste qui, lui, se traduit.
    var nomNatif: String? {
        switch self {
        case .systeme: return nil
        case .francais: return "Français"
        case .anglais: return "English"
        }
    }
}
