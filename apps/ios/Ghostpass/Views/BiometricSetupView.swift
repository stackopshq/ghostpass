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
            Form {
                Section {
                    SecureField("Mot de passe maître", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("field.masterConfirm")
                } footer: {
                    Text(
                        "Votre mot de passe maître sera conservé dans le trousseau de cet "
                            + "appareil, relisible par \(store.biometryLabel) seul. "
                            + "Ajouter un visage ou une empreinte annule cet accès.")
                }

                if let message = store.errorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Activer \(store.biometryLabel)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") {
                        store.errorMessage = nil
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Activer") {
                        // On ne referme que si le mot de passe a réellement ouvert le
                        // coffre : sinon l'erreur reste sous les yeux, ici même.
                        if store.enableBiometrics(password: password) { dismiss() }
                        password = ""
                    }
                    .disabled(password.isEmpty)
                    .accessibilityIdentifier("button.confirmBiometric")
                }
            }
        }
    }
}
