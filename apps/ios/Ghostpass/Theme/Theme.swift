import SwiftUI

/// Le système visuel de la suite, transposé de `ghostcal/frontend/src/app/globals.css`.
///
/// Les produits partagent la même structure — nuit profonde, surfaces de verre fumé,
/// halo coloré diffusé depuis le haut — et ne se distinguent que par leur accent, qui est
/// la teinte de leur logo. Pour GhostPass, c'est le violet : `#7B4DFF`, et sa variante
/// claire `#B79CFF` pour ce qui doit rester lisible sur fond sombre.
///
/// Les deux palettes existent, comme sur le web : le sombre est la teinte d'origine, le
/// clair une déclinaison de plein jour. On suit le réglage du système plutôt que d'imposer
/// l'un des deux.
extension Color {
    /// Fond de page.
    static let gpBase = adaptative(sombre: 0x0B0F19, clair: 0xF5F8FC)
    /// Cartes et lignes.
    static let gpSurface = adaptative(sombre: 0x1E293B, clair: 0xFFFFFF)
    /// Champs et surfaces imbriquées.
    static let gpSurface2 = adaptative(sombre: 0x161E2E, clair: 0xEEF3F9)
    /// Texte principal.
    static let gpInk = adaptative(sombre: 0xE2E8F0, clair: 0x0F1B2D)
    /// Texte secondaire.
    static let gpMuted = adaptative(sombre: 0x94A3B8, clair: 0x5B6B82)

    /// Accent plein : fonds de boutons, pastilles. Assez sombre pour porter du blanc.
    static let gpAccent = adaptative(sombre: 0x7B4DFF, clair: 0x5B2FD0)
    /// Accent en texte ou en icône. Sur fond de nuit, le violet plein manque de clarté :
    /// c'est la teinte haute du logo qui prend le relais.
    static let gpAccentText = adaptative(sombre: 0xB79CFF, clair: 0x5B2FD0)
    /// Ce qui se pose sur `gpAccent`.
    static let gpOnAccent = Color.white

    static let gpBorder = adaptativeAlpha(sombre: (0xFFFFFF, 0.08), clair: (0x0F172A, 0.10))
    static let gpBorderStrong = adaptativeAlpha(sombre: (0xFFFFFF, 0.16), clair: (0x0F172A, 0.16))

    static let gpDanger = adaptative(sombre: 0xFB7185, clair: 0xD11F45)
    static let gpSuccess = adaptative(sombre: 0x4ADE80, clair: 0x15803D)

    /// Une teinte fixe, en hexadécimal. Sert aux couleurs qui ne dépendent pas du thème :
    /// les pastilles d'initiale, dont la palette est partagée avec la web app.
    init(rgb: Int) {
        self.init(UIColor(rgb: rgb, alpha: 1))
    }

    private static func adaptative(sombre: Int, clair: Int) -> Color {
        Color(
            UIColor { traits in
                UIColor(rgb: traits.userInterfaceStyle == .dark ? sombre : clair, alpha: 1)
            })
    }

    private static func adaptativeAlpha(
        sombre: (Int, CGFloat), clair: (Int, CGFloat)
    ) -> Color {
        Color(
            UIColor { traits in
                let (rgb, alpha) = traits.userInterfaceStyle == .dark ? sombre : clair
                return UIColor(rgb: rgb, alpha: alpha)
            })
    }
}

extension UIColor {
    fileprivate convenience init(rgb: Int, alpha: CGFloat) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha)
    }
}

/// Mesures partagées. Les mêmes que sur le web : contrôles à 8, cartes à 16.
enum GP {
    static let radius: CGFloat = 12
    static let radiusCard: CGFloat = 16
    static let gap: CGFloat = 12
    static let padding: CGFloat = 16
    static let paddingCard: CGFloat = 24
}

/// Le fond de l'application : nuit profonde et halo diffusé depuis le haut — la lueur du
/// fantôme, qui donne sa profondeur à l'ensemble sans rien coûter en lisibilité.
struct GhostBackground: View {
    var body: some View {
        Color.gpBase
            .overlay(alignment: .top) {
                RadialGradient(
                    colors: [Color.gpAccent.opacity(0.18), .clear],
                    center: .top, startRadius: 0, endRadius: 520
                )
                .frame(height: 620)
                .offset(y: -140)
                .blur(radius: 40)
            }
            .ignoresSafeArea()
    }
}

/// Carte de verre fumé : la surface translucide, bordée d'un filet clair.
struct GlassCard: ViewModifier {
    var padding: CGFloat = GP.paddingCard

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Color.gpSurface.opacity(0.65), in: rect)
            .overlay(rect.strokeBorder(Color.gpBorder, lineWidth: 1))
            .background(.ultraThinMaterial, in: rect)
    }

    private var rect: RoundedRectangle { RoundedRectangle(cornerRadius: GP.radiusCard) }
}

extension View {
    func glassCard(padding: CGFloat = GP.paddingCard) -> some View {
        modifier(GlassCard(padding: padding))
    }
}

/// Action principale : un bloc d'accent plein, pleine largeur.
struct PrimaryButtonStyle: ButtonStyle {
    var enabled = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, weight: .semibold))
            .foregroundStyle(Color.gpOnAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                Color.gpAccent.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.35),
                in: RoundedRectangle(cornerRadius: GP.radius))
            .contentShape(RoundedRectangle(cornerRadius: GP.radius))
    }
}

/// Action secondaire : le même bloc, mais creusé plutôt que plein.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, weight: .medium))
            .foregroundStyle(Color.gpAccentText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                Color.gpSurface2.opacity(configuration.isPressed ? 0.6 : 1),
                in: RoundedRectangle(cornerRadius: GP.radius)
            )
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(Color.gpBorder, lineWidth: 1))
    }
}

/// Champ de saisie : surface creusée, bordure discrète, texte au repos lisible.
struct GhostFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(Color.gpInk)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.gpSurface2, in: RoundedRectangle(cornerRadius: GP.radius))
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(Color.gpBorder, lineWidth: 1))
    }
}

extension View {
    func ghostField() -> some View { modifier(GhostFieldStyle()) }

    /// Intitulé de section : petites capitales espacées, comme sur le web.
    func sectionLabel() -> some View {
        font(.caption.weight(.semibold))
            .textCase(.uppercase)
            .kerning(0.6)
            .foregroundStyle(Color.gpMuted)
    }
}

// ─── Structures d'écran ───

/// Un écran de la suite : le fond de nuit, et un contenu qui défile par-dessus.
struct GhostScreen<Contenu: View>: View {
    var espacement: CGFloat = 22
    @ViewBuilder var contenu: () -> Contenu

    var body: some View {
        ZStack {
            GhostBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: espacement) {
                    contenu()
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 40)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// Une section : un intitulé en petites capitales, puis une carte qui réunit ses lignes.
struct GhostSection<Contenu: View>: View {
    // Clefs de traduction, pas des chaînes : ce qui s'écrit ici s'affiche, et doit donc
    // passer par le catalogue. Une `String` s'afficherait telle quelle, en français.
    var titre: LocalizedStringKey?
    var note: LocalizedStringKey?
    @ViewBuilder var contenu: () -> Contenu

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let titre { Text(titre).sectionLabel() }
            VStack(spacing: 0) { contenu() }
                .background(
                    Color.gpSurface.opacity(0.7),
                    in: RoundedRectangle(cornerRadius: GP.radiusCard)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: GP.radiusCard)
                        .strokeBorder(Color.gpBorder, lineWidth: 1))
            if let note {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(Color.gpMuted)
                    .padding(.horizontal, 2)
            }
        }
    }
}

/// Un filet de séparation entre deux lignes d'une même carte.
struct GhostDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.gpBorder)
            .frame(height: 1)
            .padding(.leading, 14)
    }
}

/// Une ligne de consultation : un intitulé, une valeur, et ce qu'on peut en faire.
struct GhostRow<Actions: View>: View {
    let intitule: LocalizedStringKey
    /// Le contenu du coffre, jamais traduit : un mot de passe reste ce qu'il est.
    let valeur: String
    var monospace = false
    var estSecret = false
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(intitule)
                    .font(.caption)
                    .foregroundStyle(Color.gpMuted)
                // `.enabled` et `.disabled` sont deux types distincts : un ternaire ne
                // les unifie pas. Le modificateur ne porte donc que sur ce qui se copie.
                Group {
                    if estSecret {
                        Text(verbatim: valeur)
                    } else {
                        Text(verbatim: valeur).textSelection(.enabled)
                    }
                }
                .font(monospace ? .system(.body, design: .monospaced) : .body)
                .foregroundStyle(Color.gpInk)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            HStack(spacing: 14) { actions() }
                .foregroundStyle(Color.gpAccentText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

/// Bouton d'action discret d'une ligne : une icône, une zone de frappe correcte.
struct GhostIconButton: View {
    let systemImage: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.gpAccentText)
    }
}
