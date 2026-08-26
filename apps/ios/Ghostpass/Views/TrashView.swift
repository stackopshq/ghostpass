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
            ZStack {
                GhostBackground()

                List {
                    ForEach(entries) { entry in
                        ligne(entry)
                            .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .swipeActions(edge: .leading) {
                                Button("Restaurer") {
                                    Task {
                                        await store.restore(entry)
                                        await recharger()
                                    }
                                }
                                .tint(Color.gpAccent)
                            }
                            .swipeActions {
                                Button("Supprimer", role: .destructive) { aPurger = entry }
                            }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .overlay {
                    if chargement {
                        ProgressView().tint(Color.gpAccentText)
                    } else if entries.isEmpty {
                        ContentUnavailableView {
                            Label("Corbeille vide", systemImage: "trash")
                        } description: {
                            Text("Les éléments supprimés atterrissent ici.")
                        }
                        .foregroundStyle(Color.gpMuted)
                    }
                }
            }
            .navigationTitle("Corbeille")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
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
        .tint(Color.gpAccentText)
    }

    private func ligne(_ entry: VaultEntry) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "trash")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.gpMuted)
                .frame(width: 34, height: 34)
                .background(Color.gpSurface2, in: RoundedRectangle(cornerRadius: 9))
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

    private func recharger() async {
        chargement = true
        entries = await store.loadTrash()
        chargement = false
    }
}
