import SwiftUI

/// L'écran que voit l'utilisateur quand il demande un remplissage : d'abord le
/// déverrouillage, puis la liste — les entrées du site en cours en tête.
struct AutoFillView: View {
    @EnvironmentObject private var store: AutoFillStore
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Group {
                if store.isUnlocked {
                    liste
                } else {
                    deverrouillage
                }
            }
            .navigationTitle("GhostPass")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { store.cancel() }
                        .accessibilityIdentifier("button.cancel")
                }
            }
        }
    }

    private var deverrouillage: some View {
        Form {
            if store.hasSession {
                Section("Coffre") {
                    LabeledContent("Compte", value: store.account)
                    SecureField("Mot de passe maître", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("field.master")
                }
                Section {
                    Button("Déverrouiller") {
                        Task {
                            await store.unlock(password: password)
                            password = ""
                        }
                    }
                    .disabled(store.isBusy || password.isEmpty)
                    .accessibilityIdentifier("button.submit")

                    if store.canUseBiometrics {
                        Button("Déverrouiller avec \(store.biometryLabel)") {
                            Task { await store.unlockWithBiometrics() }
                        }
                        .disabled(store.isBusy)
                        .accessibilityIdentifier("button.biometric")
                    }
                }
            } else {
                // Sans session déposée, l'extension n'a rien à offrir : le dire vaut mieux
                // que d'afficher un formulaire qui ne mènera nulle part.
                ContentUnavailableView(
                    "Coffre indisponible", systemImage: "lock",
                    description: Text("Ouvrez GhostPass et connectez-vous une fois."))
            }

            if let message = store.errorMessage {
                Section { Text(message).foregroundStyle(.red) }
            }
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
                Section("Pour ce site") {
                    ForEach(store.suggested) { ligne($0) }
                }
            }
            if !store.others.isEmpty {
                Section(store.suggested.isEmpty ? "Coffre" : "Autres identifiants") {
                    ForEach(store.others) { ligne($0) }
                }
            }
        }
        .overlay {
            if store.entries.isEmpty {
                ContentUnavailableView(
                    "Aucun identifiant", systemImage: "key",
                    description: Text(store.errorMessage ?? "Le coffre local ne contient rien."))
            }
        }
    }

    private func ligne(_ entry: VaultEntry) -> some View {
        Button {
            store.pick(entry)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.item.name).foregroundStyle(.primary)
                if let login = entry.login, !login.username.isEmpty {
                    Text(login.username).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}
