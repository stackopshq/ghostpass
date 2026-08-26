import SwiftUI

/// Activation du déverrouillage biométrique, depuis les réglages du coffre.
///
/// Une feuille et non une alerte : présentée depuis un menu qui se referme, une alerte se
/// perd un cycle sur deux et son champ n'apparaît jamais. Une feuille se présente toujours.
struct BiometricSetupView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(spacing: 14) {
                    Image(systemName: "faceid")
                        .font(.system(size: 40, weight: .light))
                        .foregroundStyle(Color.gpAccentText)
                    Text("Déverrouiller avec \(store.biometryLabel)")
                        .font(.system(.title3, weight: .semibold))
                        .foregroundStyle(Color.gpInk)
                        .multilineTextAlignment(.center)
                    Text(
                        "Votre mot de passe maître sera conservé dans le trousseau de cet "
                            + "appareil, relisible par \(store.biometryLabel) seul. Ajouter un "
                            + "visage ou une empreinte annule cet accès."
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 12)

                GhostSection(titre: "Mot de passe maître") {
                    SecureField("", text: $password, prompt: invite("Pour confirmer que c'est bien vous"))
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.masterConfirm")
                }

                if let message = store.errorMessage {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.gpDanger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button("Activer") {
                    // On ne referme que si le mot de passe a réellement ouvert le
                    // coffre : sinon l'erreur reste sous les yeux, ici même.
                    if store.enableBiometrics(password: password) { dismiss() }
                    password = ""
                }
                .buttonStyle(PrimaryButtonStyle(enabled: !password.isEmpty))
                .disabled(password.isEmpty)
                .accessibilityIdentifier("button.confirmBiometric")
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") {
                        store.errorMessage = nil
                        dismiss()
                    }
                    .foregroundStyle(Color.gpMuted)
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private func invite(_ texte: String) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }
}
