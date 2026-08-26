import SwiftUI

/// Génération d'un mot de passe, présentée depuis le formulaire d'édition.
///
/// Le mot de passe n'est que proposé ; il n'est retenu que si l'utilisateur l'accepte.
/// Rien n'est enregistré ici — c'est l'écran d'édition qui décide.
struct PasswordGeneratorView: View {
    /// Appelé avec le mot de passe retenu.
    var onUse: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options = GeneratorOptions()
    @State private var password = ""

    var body: some View {
        NavigationStack {
            GhostScreen {
                GhostSection {
                    VStack(spacing: 14) {
                        Text(password.isEmpty ? " " : password)
                            .font(.system(.title3, design: .monospaced, weight: .medium))
                            .foregroundStyle(Color.gpInk)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("text.generated")

                        HStack(spacing: 10) {
                            force
                            Spacer()
                            Button {
                                regenerate()
                            } label: {
                                Label("Régénérer", systemImage: "arrow.clockwise")
                                    .font(.subheadline.weight(.medium))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Color.gpAccentText)
                            .accessibilityIdentifier("button.regenerate")
                        }
                    }
                    .padding(16)
                }

                GhostSection(titre: "Longueur — \(options.length) caractères") {
                    // Pas moins de 8 : en dessous, la longueur ne protège plus de rien.
                    Slider(value: lengthBinding, in: 8...64, step: 1)
                        .tint(Color.gpAccent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .accessibilityIdentifier("slider.length")
                }

                GhostSection(titre: "Caractères") {
                    bascule("Minuscules", "a-z", \.lowercase)
                    GhostDivider()
                    bascule("Majuscules", "A-Z", \.uppercase)
                    GhostDivider()
                    bascule("Chiffres", "0-9", \.digits)
                    GhostDivider()
                    bascule("Symboles", "!@#$…", \.symbols)
                }
            }
            .navigationTitle("Générer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                        .foregroundStyle(Color.gpMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Utiliser") {
                        onUse(password)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.gpAccentText)
                    .disabled(password.isEmpty)
                    .accessibilityIdentifier("button.usePassword")
                }
            }
            .onAppear(perform: regenerate)
        }
        .tint(Color.gpAccentText)
    }

    private func bascule(
        _ titre: String, _ exemple: String, _ path: WritableKeyPath<GeneratorOptions, Bool>
    ) -> some View {
        Toggle(isOn: binding(path)) {
            HStack(spacing: 8) {
                Text(titre).foregroundStyle(Color.gpInk)
                Text(exemple)
                    .font(.caption.monospaced())
                    .foregroundStyle(Color.gpMuted)
            }
        }
        .tint(Color.gpAccent)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    /// Une jauge indicative, fondée sur la seule chose qu'on puisse mesurer ici : le
    /// nombre de combinaisons possibles. Elle ne dit rien de la fuite d'un mot de passe,
    /// seulement de ce qu'il en coûterait de le deviner.
    private var force: some View {
        let bits = entropie
        let (libelle, couleur): (String, Color) =
            bits >= 100 ? ("Excellent", .gpSuccess)
            : bits >= 72 ? ("Solide", .gpSuccess)
            : bits >= 50 ? ("Correct", .gpAccentText)
            : ("Faible", .gpDanger)
        return HStack(spacing: 8) {
            Text(libelle).font(.caption.weight(.semibold)).foregroundStyle(couleur)
            Text("≈ \(Int(bits)) bits").font(.caption2).foregroundStyle(Color.gpMuted)
        }
    }

    private var entropie: Double {
        var taille = 0
        if options.lowercase { taille += 26 }
        if options.uppercase { taille += 26 }
        if options.digits { taille += 10 }
        if options.symbols { taille += 24 }
        if taille == 0 { taille = 26 }
        return Double(options.length) * log2(Double(taille))
    }

    private func regenerate() {
        password = PasswordGenerator.generate(options)
    }

    /// Toute modification d'option régénère : voir l'effet du réglage évite de se
    /// demander s'il a été pris en compte.
    private func binding(_ path: WritableKeyPath<GeneratorOptions, Bool>) -> Binding<Bool> {
        Binding(
            get: { options[keyPath: path] },
            set: { options[keyPath: path] = $0; regenerate() })
    }

    private var lengthBinding: Binding<Double> {
        Binding(
            get: { Double(options.length) },
            set: { options.length = Int($0); regenerate() })
    }
}
