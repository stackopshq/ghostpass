import SwiftUI

/// L'écran que voit l'utilisateur quand il demande un remplissage : d'abord le
/// déverrouillage, puis la liste — les entrées du site en cours en tête.
struct AutoFillView: View {
    @EnvironmentObject private var store: AutoFillStore
    @State private var password = ""

    var body: some View {
        NavigationStack {
            ZStack {
                GhostBackground()
                Group {
                    if store.isUnlocked {
                        liste
                    } else {
                        deverrouillage
                    }
                }
            }
            .navigationTitle("GhostPass")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { store.cancel() }
                        .foregroundStyle(Color.gpMuted)
                        .accessibilityIdentifier("button.cancel")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private var deverrouillage: some View {
        ScrollView {
            VStack(spacing: 18) {
                if store.hasSession {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Compte").sectionLabel()
                            Text(store.account)
                                .foregroundStyle(Color.gpMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .ghostField()
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Mot de passe maître").sectionLabel()
                            SecureField("", text: $password, prompt: invite("Votre mot de passe"))
                                .ghostField()
                                .accessibilityIdentifier("field.master")
                        }

                        if let message = store.errorMessage {
                            Label(message, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(Color.gpDanger)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        VStack(spacing: 10) {
                            Button("Déverrouiller") {
                                Task {
                                    await store.unlock(password: password)
                                    password = ""
                                }
                            }
                            .buttonStyle(PrimaryButtonStyle(enabled: !store.isBusy && !password.isEmpty))
                            .disabled(store.isBusy || password.isEmpty)
                            .accessibilityIdentifier("button.submit")

                            if store.canUseBiometrics {
                                Button("Déverrouiller avec \(store.biometryLabel)") {
                                    Task { await store.unlockWithBiometrics() }
                                }
                                .buttonStyle(SecondaryButtonStyle())
                                .disabled(store.isBusy)
                                .accessibilityIdentifier("button.biometric")
                            }
                        }
                    }
                    .glassCard()
                } else {
                    // Sans session déposée, l'extension n'a rien à offrir : le dire vaut
                    // mieux que d'afficher un formulaire qui ne mènera nulle part.
                    ContentUnavailableView {
                        Label("Coffre indisponible", systemImage: "lock")
                    } description: {
                        Text("Ouvrez GhostPass et connectez-vous une fois.")
                    }
                    .foregroundStyle(Color.gpMuted)
                }
            }
            .padding(20)
        }
        .onAppear {
            // La biométrie d'emblée : c'est le geste attendu, et le remplissage doit
            // aboutir en quelques secondes.
            if store.canUseBiometrics {
                Task { await store.unlockWithBiometrics() }
            }
        }
    }

    private var liste: some View {
        List {
            if !store.suggested.isEmpty {
                section("Pour ce site", store.suggested)
            }
            if !store.others.isEmpty {
                section(store.suggested.isEmpty ? "Coffre" : "Autres identifiants", store.others)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if store.entries.isEmpty {
                ContentUnavailableView {
                    Label("Aucun identifiant", systemImage: "key")
                } description: {
                    Text(store.errorMessage ?? "Le coffre local ne contient rien.")
                }
                .foregroundStyle(Color.gpMuted)
            }
        }
    }

    private func section(_ titre: String, _ entries: [VaultEntry]) -> some View {
        Section {
            ForEach(entries) { entry in
                ligne(entry)
                    .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        } header: {
            Text(titre).sectionLabel().padding(.leading, 2)
        }
    }

    private func ligne(_ entry: VaultEntry) -> some View {
        Button {
            store.pick(entry)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "person.badge.key")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.gpAccentText)
                    .frame(width: 34, height: 34)
                    .background(Color.gpAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.item.name)
                        .font(.system(.body, weight: .medium))
                        .foregroundStyle(Color.gpInk)
                    if let login = entry.login, !login.username.isEmpty {
                        Text(login.username).font(.caption).foregroundStyle(Color.gpMuted)
                    }
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color.gpSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: GP.radius))
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(Color.gpBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func invite(_ texte: String) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }
}
