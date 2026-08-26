import SwiftUI

/// La reprise d'un compte : imposer un nouveau mot de passe maître au donneur.
///
/// C'est l'action la plus lourde de l'application — après elle, le propriétaire d'origine ne
/// peut plus ouvrir son propre coffre. L'écran ne cherche donc pas à la rendre fluide : il
/// dit ce qu'elle fait, redemande le mot de passe, et n'active le bouton qu'ensuite.
struct EmergencyTakeoverView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffreDUrgenceOuvert
    let apres: () async -> Void

    @State private var motDePasse = ""
    @State private var confirmation = ""

    /// Même exigence qu'à l'inscription : ce mot de passe protégera un coffre entier.
    private var assezSolide: Bool { motDePasse.count >= 12 }
    private var valide: Bool { assezSolide && motDePasse == confirmation }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(alignment: .leading, spacing: 16) {
                    avertissement

                    GhostSection(
                        titre: "Nouveau mot de passe maître",
                        note: "Douze caractères au minimum. Il remplacera celui du propriétaire."
                    ) {
                        VStack(spacing: 0) {
                            SecureField("Nouveau mot de passe", text: $motDePasse)
                                .padding(14)
                                .accessibilityIdentifier("field.takeoverPassword")
                            Divider().overlay(Color.gpBorder)
                            SecureField("Confirmer", text: $confirmation)
                                .padding(14)
                                .accessibilityIdentifier("field.takeoverConfirm")
                        }
                        .foregroundStyle(Color.gpInk)
                    }

                    if !confirmation.isEmpty && motDePasse != confirmation {
                        Text("Les deux saisies diffèrent.")
                            .font(.footnote)
                            .foregroundStyle(Color.gpDanger)
                    }

                    Button("Reprendre le compte") {
                        Task {
                            let ok = await store.reprendreLeCompte(
                                ouvert, nouveauMotDePasse: motDePasse)
                            if ok {
                                await apres()
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(enabled: valide && !store.isBusy))
                    .disabled(!valide || store.isBusy)
                    .accessibilityIdentifier("button.confirmTakeover")

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
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .navigationTitle("Reprise du compte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                        .foregroundStyle(Color.gpMuted)
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private var avertissement: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(
                    verbatim: String(
                        format: tr("%@ ne pourra plus ouvrir son coffre."), ouvert.donneur))
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Color.gpDanger)
            .fixedSize(horizontal: false, vertical: true)

            Text(
                "Les données ne sont pas perdues : elles restent chiffrées par la même clé, seule la façon de l'ouvrir change. Mais elle ne s'ouvrira plus qu'avec le mot de passe que vous choisissez ici."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .glassCard()
    }
}
