import SwiftUI

/// La corbeille : ce que le serveur garde après une suppression.
///
/// Elle se consulte, elle ne se garde pas en mémoire. Un item supprimé n'a rien à faire
/// dans le coffre déverrouillé, et le recharger à l'ouverture coûte moins cher que de le
/// tenir à jour pour un écran qu'on visite rarement.
struct TrashView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var entries: [VaultEntry] = []
    @State private var chargement = true
    /// L'item dont on s'apprête à se débarrasser pour de bon.
    @State private var aPurger: VaultEntry?

    var body: some View {
        NavigationStack {
            List {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.item.name)
                        if let login = entry.login, !login.username.isEmpty {
                            Text(login.username).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button("Restaurer") {
                            Task {
                                await store.restore(entry)
                                await recharger()
                            }
                        }
                        .tint(.blue)
                    }
                    .swipeActions {
                        Button("Supprimer", role: .destructive) { aPurger = entry }
                    }
                }
            }
            .overlay {
                if chargement {
                    ProgressView()
                } else if entries.isEmpty {
                    ContentUnavailableView(
                        "Corbeille vide", systemImage: "trash",
                        description: Text("Les éléments supprimés atterrissent ici."))
                }
            }
            .navigationTitle("Corbeille")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .accessibilityIdentifier("button.closeTrash")
                }
            }
            // Une suppression définitive ne se rattrape pas : elle se confirme.
            .alert(
                "Supprimer définitivement ?",
                isPresented: .constant(aPurger != nil),
                presenting: aPurger,
                actions: { entry in
                    Button("Supprimer", role: .destructive) {
                        Task {
                            await store.purge(entry)
                            aPurger = nil
                            await recharger()
                        }
                    }
                    .accessibilityIdentifier("button.confirmPurge")
                    Button("Annuler", role: .cancel) { aPurger = nil }
                },
                message: { entry in
                    Text("« \(entry.item.name) » sera perdu, sans possibilité de retour.")
                })
            .task { await recharger() }
        }
    }

    private func recharger() async {
        chargement = true
        entries = await store.loadTrash()
        chargement = false
    }
}
