import SwiftUI

/// Inviter quelqu'un dans une équipe.
///
/// Le geste a l'air anodin — une adresse, un rôle — mais il scelle la clé du coffre vers la
/// clé publique de cette personne. C'est irrévocable au sens strict : la reprendre suppose
/// une rotation, et ce qu'elle aura vu d'ici là restera connu d'elle.
struct OrgInviteView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffrePartageOuvert
    let apres: () async -> Void

    @State private var email = ""
    @State private var role: RoleDOrganisation = .member

    private var emailValide: Bool {
        let parts = email.split(separator: "@")
        return parts.count == 2 && parts.allSatisfy { !$0.isEmpty } && parts[1].contains(".")
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(alignment: .leading, spacing: 16) {
                    GhostSection(
                        titre: "La personne",
                        note: "Elle doit déjà posséder un compte GhostPass : c'est sa clé publique qui protège celle de l'équipe."
                    ) {
                        TextField("adresse@exemple.com", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                            .foregroundStyle(Color.gpInk)
                            .padding(14)
                            .accessibilityIdentifier("field.memberEmail")
                    }

                    GhostSection(titre: "Son rôle") {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach([RoleDOrganisation.admin, .member, .readonly], id: \.rawValue) {
                                candidat in
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
                                            Text(verbatim: explication(candidat))
                                                .font(.footnote)
                                                .foregroundStyle(Color.gpMuted)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                }
                                .accessibilityIdentifier("orgRole.\(candidat.rawValue)")
                            }
                        }
                        .padding(14)
                    }

                    Button("Inviter") {
                        Task {
                            let ok = await store.inviterDansLEquipe(
                                ouvert, email: email.trimmingCharacters(in: .whitespaces),
                                role: role)
                            if ok {
                                await apres()
                                dismiss()
                            }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(enabled: emailValide && !store.isBusy))
                    .disabled(!emailValide || store.isBusy)
                    .accessibilityIdentifier("button.confirmMember")

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
            .navigationTitle("Inviter")
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

    private func explication(_ role: RoleDOrganisation) -> String {
        switch role {
        case .admin: return tr("Peut inviter, révoquer et gérer les droits.")
        case .member: return tr("Peut lire et modifier les identifiants partagés.")
        case .readonly: return tr("Peut lire, sans rien modifier.")
        }
    }
}
