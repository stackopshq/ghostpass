import SwiftUI

/// Réinitialiser le mot de passe maître avec la clé de récupération.
///
/// Rien ne s'ouvre ici : le serveur invalide toutes les sessions, et c'est voulu — si
/// quelqu'un vient de réinitialiser le mot de passe, celles restées ouvertes ailleurs
/// n'ont plus lieu d'être. L'écran renvoie donc à la connexion, avec le nouveau.
struct RecoverAccountView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    /// L'adresse et le compte déjà saisis sur l'écran de déverrouillage : les redemander
    /// ne servirait qu'à les faire retaper.
    let serveur: String
    let email: String
    /// Appelé après une réinitialisation réussie, pour prévenir l'écran d'accueil.
    var onReussite: () -> Void

    @State private var cle = ""
    @State private var nouveau = ""

    private var pretARepondre: Bool {
        !cle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && nouveau.count >= 8
            && !store.isBusy
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                GhostSection(
                    note: "Le nouveau mot de passe rechiffre la clé du coffre. Son contenu reste intact : rien n'est perdu, rien n'est déchiffré côté serveur."
                ) {
                    TextField("", text: .constant(email), prompt: invite("Adresse e-mail"))
                        .disabled(true)
                        .foregroundStyle(Color.gpMuted)
                        .padding(14)
                    GhostDivider()
                    TextField("", text: $cle, prompt: invite("Clé de récupération"), axis: .vertical)
                        .lineLimit(2...4)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.recoveryKey")
                    GhostDivider()
                    SecureField("", text: $nouveau, prompt: invite("Nouveau mot de passe maître"))
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.newMaster")
                }

                if !nouveau.isEmpty && nouveau.count < 8 {
                    Text("Huit caractères au minimum.")
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                }

                if let message = store.errorMessage {
                    Label {
                        Text(verbatim: message)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.gpDanger)
                    .fixedSize(horizontal: false, vertical: true)
                }

                Button("Réinitialiser") {
                    Task {
                        let fait = await store.recoverAccount(
                            server: serveur, email: email, recoveryKey: cle, newPassword: nouveau)
                        if fait {
                            onReussite()
                            dismiss()
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle(enabled: pretARepondre))
                .disabled(!pretARepondre)
                .accessibilityIdentifier("button.submitRecovery")
            }
            .navigationTitle("Mot de passe oublié")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") {
                        store.errorMessage = nil
                        dismiss()
                    }
                    .foregroundStyle(Color.gpMuted)
                    .accessibilityIdentifier("button.cancelRecovery")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private func invite(_ texte: LocalizedStringKey) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }
}
