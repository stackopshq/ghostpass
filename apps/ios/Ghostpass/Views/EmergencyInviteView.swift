import SwiftUI

/// Désigner un contact de confiance.
///
/// Deux réglages seulement, mais tous deux irréversibles dans leurs effets : le rôle, et le
/// délai pendant lequel on pourra encore dire non. L'écran les explique plutôt que de les
/// nommer — « reprise du compte » ne dit pas à qui appartiendra le coffre après coup.
struct EmergencyInviteView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let apres: () async -> Void

    @State private var email = ""
    @State private var role: RoleDUrgence = .view
    @State private var delai = 7

    private var emailValide: Bool {
        let parts = email.split(separator: "@")
        return parts.count == 2 && parts.allSatisfy { !$0.isEmpty } && parts[1].contains(".")
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(alignment: .leading, spacing: 16) {
                    GhostSection(
                        titre: "Le contact",
                        note:
                            "Il doit déjà posséder un compte GhostPass : c'est sa clé publique qui protège la vôtre."
                    ) {
                        TextField("adresse@exemple.com", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                            .foregroundStyle(Color.gpInk)
                            .padding(14)
                            .accessibilityIdentifier("field.emergencyEmail")
                    }

                    GhostSection(titre: "Ce qu'il pourra faire") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(RoleDUrgence.allCases) { candidat in
                                Button {
                                    role = candidat
                                } label: {
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(
                                            systemName: role == candidat
                                                ? "largecircle.fill.circle" : "circle"
                                        )
                                        .foregroundStyle(
                                            role == candidat ? Color.gpAccentText : Color.gpMuted)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(verbatim: candidat.intitule)
                                                .foregroundStyle(Color.gpInk)
                                            Text(verbatim: candidat.explication)
                                                .font(.footnote)
                                                .foregroundStyle(Color.gpMuted)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                }
                                .accessibilityIdentifier("role.\(candidat.rawValue)")
                            }
                        }
                        .padding(14)
                    }

                    GhostSection(
                        titre: "Le délai avant ouverture",
                        note:
                            "Quand le contact demandera l'accès, vous serez prévenu et pourrez refuser pendant ce temps. Passé ce délai sans réponse de votre part, l'accès s'ouvre — c'est précisément ce qui le rend utile le jour où vous ne pouvez plus répondre."
                    ) {
                        Stepper(
                            value: $delai, in: 1...90,
                            label: {
                                Text(
                                    verbatim: String(
                                        format: tr("%d jours"), delai)
                                )
                                .foregroundStyle(Color.gpInk)
                            }
                        )
                        .padding(14)
                        .accessibilityIdentifier("stepper.emergencyDelay")
                    }

                    Button("Confier l'accès") {
                        Task {
                            let ok = await store.confierLAcces(
                                a: email.trimmingCharacters(in: .whitespaces), role: role,
                                delai: delai)
                            if ok {
                                await apres()
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(enabled: emailValide && !store.isBusy))
                    .disabled(!emailValide || store.isBusy)
                    .accessibilityIdentifier("button.confirmInvite")

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
            .navigationTitle("Confier l'accès")
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
}
