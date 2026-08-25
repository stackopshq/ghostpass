import SwiftUI

struct VaultListView: View {
    @EnvironmentObject private var store: VaultStore
    @State private var search = ""
    @State private var editing: EditTarget?

    private var visible: [VaultEntry] {
        guard !search.isEmpty else { return store.entries }
        return store.entries.filter { entry in
            entry.item.name.localizedCaseInsensitiveContains(search)
                || (entry.login?.username.localizedCaseInsensitiveContains(search) ?? false)
                || (entry.login?.uris.contains { $0.localizedCaseInsensitiveContains(search) } ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(visible) { entry in
                    NavigationLink(value: entry) {
                        VaultRow(entry: entry)
                    }
                    .swipeActions {
                        Button("Supprimer", role: .destructive) {
                            Task { await store.delete(entry) }
                        }
                    }
                }
            }
            .navigationDestination(for: VaultEntry.self) { entry in
                ItemDetailView(entry: entry) { editing = .existing(entry) }
            }
            .searchable(text: $search, prompt: "Rechercher")
            .overlay {
                if store.entries.isEmpty {
                    ContentUnavailableView(
                        "Coffre vide", systemImage: "lock",
                        description: Text("Ajoutez un identifiant avec le bouton +."))
                }
            }
            .refreshable { await store.refresh() }
            .navigationTitle("Coffre")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Verrouiller") { store.lock() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editing = .new
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(item: $editing) { target in
                ItemEditView(target: target)
                    .environmentObject(store)
            }
            .alert(
                "Erreur", isPresented: .constant(store.errorMessage != nil),
                actions: { Button("OK") { store.errorMessage = nil } },
                message: { Text(store.errorMessage ?? "") })
        }
    }
}

/// Cible d'édition : soit un item existant, soit une création.
enum EditTarget: Identifiable {
    case new
    case existing(VaultEntry)

    var id: String {
        switch self {
        case .new: return "new"
        case .existing(let entry): return entry.id
        }
    }
}

private struct VaultRow: View {
    let entry: VaultEntry

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .frame(width: 28)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.item.name).font(.body)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var icon: String {
        switch entry.item.data {
        case .login: return "person.badge.key"
        case .secureNote: return "note.text"
        case .card: return "creditcard"
        }
    }

    private var subtitle: String? {
        switch entry.item.data {
        case .login(let login): return login.username
        case .secureNote: return "Note sécurisée"
        case .card(let card): return card.cardholder
        }
    }
}
