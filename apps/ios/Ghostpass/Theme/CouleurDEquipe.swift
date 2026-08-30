import SwiftUI

/// La couleur d'une équipe : celle qu'on lui a choisie, ou celle qu'on lui attribue.
///
/// Deux exigences se croisent ici. **Distinguer sans configurer** : appartenir à trois
/// équipes et les voir toutes en bleu ne dit rien de plus que de ne rien afficher, donc
/// une couleur est attribuée d'office, dérivée de l'identifiant de l'équipe — la même
/// partout, sans rien à régler. **Et pouvoir choisir** : la couleur attribuée peut tomber
/// à côté de celle de la marque, ou se confondre avec celle d'une autre équipe pour un
/// œil qui distingue mal certaines teintes.
///
/// La palette est fixée plutôt que calculée. Une teinte tirée d'un hachage donne aussi
/// bien du kaki que du rose fluo, et il faut ensuite corriger la luminosité pour rester
/// lisible sur les deux thèmes : autant choisir d'avance des couleurs qui se distinguent
/// entre elles et qui tiennent sur fond clair comme sur fond sombre.
enum CouleurDEquipe {
    /// Huit teintes qui restent distinguables les unes des autres, y compris pour les
    /// formes courantes de daltonisme — on n'oppose jamais un rouge à un vert seuls.
    static let palette: [String] = [
        "#4C8DFF",  // bleu
        "#B57BFF",  // violet
        "#00C2A8",  // turquoise
        "#FF8A3D",  // orange
        "#E75480",  // rose
        "#3FBF5F",  // vert
        "#FFC53D",  // ambre
        "#7A8CFF",  // indigo
    ]

    /// La couleur attribuée d'office, stable pour un identifiant donné.
    ///
    /// La somme des octets suffit : il ne s'agit pas de résister à un adversaire, mais de
    /// rendre le même résultat sur l'iPhone, l'iPad et le web. Un hachage de bibliothèque
    /// ne le garantirait pas — `hashValue` de Swift varie d'un lancement à l'autre, ce qui
    /// aurait donné une couleur différente à chaque ouverture de l'application.
    static func attribuee(_ identifiant: String) -> String {
        guard !identifiant.isEmpty else { return palette[0] }
        let somme = identifiant.utf8.reduce(0) { ($0 + Int($1)) % 4096 }
        return palette[somme % palette.count]
    }

    /// La couleur retenue : celle du registre si elle existe, sinon celle attribuée.
    static func hex(_ identifiant: String, choisies: [String: String]) -> String {
        choisies[identifiant] ?? attribuee(identifiant)
    }

    /// Un `#RRGGBB` en couleur. Rend `nil` sur une chaîne qu'on ne sait pas lire : le
    /// registre est écrit par d'autres clients, et une valeur inattendue ne doit pas
    /// donner du noir sans qu'on sache pourquoi.
    static func couleur(_ hex: String) -> Color? {
        var texte = hex.trimmingCharacters(in: .whitespaces)
        if texte.hasPrefix("#") { texte.removeFirst() }
        guard texte.count == 6, let valeur = Int(texte, radix: 16) else { return nil }
        return Color(
            .sRGB,
            red: Double((valeur >> 16) & 0xFF) / 255,
            green: Double((valeur >> 8) & 0xFF) / 255,
            blue: Double(valeur & 0xFF) / 255)
    }

    /// Le `#RRGGBB` d'une couleur choisie au sélecteur.
    ///
    /// Le sélecteur rend une couleur d'espace étendu — l'écran de l'iPhone couvre le P3 —
    /// que l'on ramène en sRGB : le registre est relu par le web, où seul `#RRGGBB` a un
    /// sens. Une teinte très saturée choisie sur l'appareil paraîtra donc légèrement plus
    /// terne ailleurs, ce qui vaut mieux qu'une valeur que l'autre client ne saurait lire.
    static func hex(de couleur: Color) -> String {
        let composantes =
            UIColor(couleur).cgColor.converted(
                to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?
            .components ?? [0, 0, 0, 1]
        let canal = { (index: Int) -> Int in
            Int(
                (max(0, min(1, composantes.count > index ? composantes[index] : 0)) * 255)
                    .rounded())
        }
        return String(format: "#%02X%02X%02X", canal(0), canal(1), canal(2))
    }

    /// La couleur d'une équipe, prête à afficher, avec un repli sur l'accent du thème.
    static func couleur(de identifiant: String, choisies: [String: String]) -> Color {
        couleur(hex(identifiant, choisies: choisies)) ?? .gpAccentText
    }
}
