import SwiftUI

/// Génération d'un mot de passe, présentée depuis le formulaire d'édition.
///
/// Le mot de passe n'est proposé que ; il n'est retenu que si l'utilisateur l'accepte.
/// Rien n'est enregistré ici — c'est l'écran d'édition qui décide.
struct PasswordGeneratorView: View {
    /// Appelé avec le mot de passe retenu.
    var onUse: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var options = GeneratorOptions()
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(password.isEmpty ? " " : password)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("text.generated")
                    Button("Régénérer", systemImage: "arrow.clockwise") { regenerate() }
                        .accessibilityIdentifier("button.regenerate")
                }

                Section("Longueur : \(options.length)") {
                    // Pas moins de 8 : en dessous, la longueur ne protège plus de rien.
                    Slider(value: lengthBinding, in: 8...64, step: 1)
                        .accessibilityIdentifier("slider.length")
                }

                Section("Caractères") {
                    Toggle("Minuscules", isOn: binding(\.lowercase))
                    Toggle("Majuscules", isOn: binding(\.uppercase))
                    Toggle("Chiffres", isOn: binding(\.digits))
                    Toggle("Symboles", isOn: binding(\.symbols))
                }
            }
            .navigationTitle("Générer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Utiliser") {
                        onUse(password)
                        dismiss()
                    }
                    .disabled(password.isEmpty)
                    .accessibilityIdentifier("button.usePassword")
                }
            }
            .onAppear(perform: regenerate)
        }
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
