import SwiftUI

/// Les icônes des sites, servies par *notre* serveur.
///
/// Demander une icône à Google ou à un service tiers reviendrait à lui annoncer les sites
/// que contient le coffre, un par un. Le backend de la suite expose donc son propre proxy
/// (`GET /api/icons?domain=…`), qui va chercher l'icône et la met en cache : aucun tiers ne
/// voit les domaines.
///
/// Le serveur, lui, les voit — c'est le prix de l'icône, et la raison pour laquelle
/// l'affichage se coupe depuis les réglages. Un coffre chiffré de bout en bout ne dit rien
/// de son contenu au serveur ; les requêtes d'icônes, elles, en disent quelque chose.
enum Favicon {
    /// L'adresse du proxy pour cet URI, ou `nil` s'il n'y a pas de domaine exploitable.
    static func url(pour adresse: String, serveur: String) -> URL? {
        guard estUnDomainePublic(SiteMatching.host(of: adresse)) else { return nil }
        let hote = SiteMatching.host(of: adresse)
        // Une adresse de serveur vide donnerait une URL relative — `/api/icons?…` sans
        // hôte — qui ne mène nulle part. Exiger l'hôte ferme ce chemin.
        guard var composants = URLComponents(string: serveur), composants.host != nil else {
            return nil
        }
        composants.path = "/api/icons"
        composants.queryItems = [URLQueryItem(name: "domain", value: hote)]
        return composants.url
    }

    /// Un domaine public, au sens où le proxy l'entend : des labels séparés par des points
    /// et une extension alphabétique. La règle est celle du serveur, appliquée ici pour ne
    /// pas lui envoyer une requête qu'il refusera.
    ///
    /// Elle écarte « localhost », les noms de machine du réseau local et les adresses IP —
    /// littérales ou entre crochets. Demander au serveur d'aller chercher une icône sur une
    /// IP privée n'aurait aucun sens, et lui apprendrait l'adressage du réseau de
    /// l'utilisateur pour rien.
    private static func estUnDomainePublic(_ hote: String) -> Bool {
        guard !hote.hasPrefix("["), hote.contains(".") else { return false }
        let labels = hote.components(separatedBy: ".")
        guard labels.count >= 2, let extension_ = labels.last, extension_.count >= 2 else {
            return false
        }
        return extension_.allSatisfy { $0.isLetter }
    }

    /// Une couleur de repli déterministe, la même que celle de la web app : deux écrans
    /// qui montrent le même coffre doivent lui donner les mêmes couleurs.
    private static let couleurs = [
        0xE0533F, 0xE0892F, 0x3F9E6B, 0x3F86E0, 0x7C5CF0, 0xD9528A, 0x2FA3A3, 0x9A7B3F,
    ]

    static func couleur(pour nom: String) -> Color {
        var empreinte: UInt32 = 0
        for scalaire in nom.unicodeScalars {
            empreinte = empreinte &* 31 &+ (scalaire.value & 0xFFFF)
        }
        return Color(rgb: couleurs[Int(empreinte) % couleurs.count])
    }

    /// L'initiale affichée à défaut d'icône. Un nom vide donne un point d'interrogation
    /// plutôt qu'une pastille muette.
    static func initiale(_ nom: String) -> String {
        let propre = nom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let premier = propre.first else { return "?" }
        return String(premier).uppercased()
    }
}

/// La pastille d'un élément : l'icône du site si on peut l'obtenir, sinon une initiale sur
/// fond coloré — celui-ci se calcule sur l'appareil et ne demande rien à personne.
struct SiteIcon: View {
    let nom: String
    var adresse: String?
    var taille: CGFloat = 38

    @EnvironmentObject private var prefs: Preferences

    var body: some View {
        Group {
            if prefs.afficheLesIcones, let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit().padding(taille * 0.18)
                    // Une icône absente ou un serveur qui refuse ne doit rien changer à la
                    // lisibilité de la liste : on retombe sur l'initiale, sans un mot.
                    default:
                        monogramme
                    }
                }
            } else {
                monogramme
            }
        }
        .frame(width: taille, height: taille)
        .background(fond, in: RoundedRectangle(cornerRadius: taille * 0.26))
        .overlay(
            RoundedRectangle(cornerRadius: taille * 0.26)
                .strokeBorder(Color.gpBorder, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var url: URL? {
        guard let adresse, !adresse.isEmpty else { return nil }
        let serveur = SharedStore.load()?.serverURL ?? ""
        guard !serveur.isEmpty else { return nil }
        return Favicon.url(pour: adresse, serveur: serveur)
    }

    private var monogramme: some View {
        Text(verbatim: Favicon.initiale(nom))
            .font(.system(size: taille * 0.42, weight: .semibold, design: .rounded))
            .foregroundStyle(Color.gpOnAccent)
    }

    /// Fond blanc sous une icône — beaucoup sont transparentes et taillées pour du clair —,
    /// teinté sous une initiale.
    private var fond: Color {
        if prefs.afficheLesIcones, url != nil { return .white }
        return Favicon.couleur(pour: nom)
    }
}
