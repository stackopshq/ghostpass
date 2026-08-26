import SwiftUI

struct VaultListView: View {
    @EnvironmentObject private var store: VaultStore
    @State private var search = ""
    /// Une seule feuille à la fois : deux modificateurs `.sheet` sur la même vue se
    /// marchent dessus, et c'est la première déclarée qui cesse de s'ouvrir.
    @State private var sheet: VaultSheet?

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
                if store.isOffline {
                    Label(
                        "Hors ligne — coffre affiché depuis cet appareil",
                        systemImage: "wifi.slash"
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("banner.offline")
                }
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
                // On repart de l'entrée telle qu'elle est dans le coffre, pas de la copie
                // capturée à la navigation : sinon une seconde modification rouvrirait
                // le formulaire avec le contenu d'avant la première.
                ItemDetailView(entry: entry) {
                    sheet = .editItem(store.entries.first { $0.id == entry.id } ?? entry)
                }
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
                        .accessibilityIdentifier("button.lock")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if store.biometryAvailable {
                            if store.isBiometricEnabled {
                                Button("Désactiver \(store.biometryLabel)", role: .destructive) {
                                    store.disableBiometrics()
                                }
                                .accessibilityIdentifier("button.biometricOff")
                            } else {
                                Button("Activer \(store.biometryLabel)") {
                                    sheet = .biometrics
                                }
                                .accessibilityIdentifier("button.biometricOn")
                            }
                        }
                        Button("Se déconnecter", role: .destructive) {
                            Task { await store.signOut() }
                        }
                        .accessibilityIdentifier("button.signOut")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("button.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        sheet = .newItem
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityIdentifier("button.add")
                }
            }
            .sheet(item: $sheet) { destination in
                switch destination {
                case .newItem:
                    ItemEditView(target: .new).environmentObject(store)
                case .editItem(let entry):
                    ItemEditView(target: .existing(entry)).environmentObject(store)
                case .biometrics:
                    BiometricSetupView().environmentObject(store)
                }
            }
            .alert(
                "Erreur", isPresented: .constant(store.errorMessage != nil),
                actions: { Button("OK") { store.errorMessage = nil } },
                message: { Text(store.errorMessage ?? "") })
            .alert(
                "Utiliser \(store.biometryLabel) ?",
                isPresented: $store.offersBiometricEnrollment,
                actions: {
                    Button("Activer") { store.acceptOfferedBiometrics() }
                        .accessibilityIdentifier("button.acceptBiometric")
                    Button("Plus tard", role: .cancel) { store.declineBiometrics() }
                        .accessibilityIdentifier("button.laterBiometric")
                },
                message: {
                    Text(
                        "Votre mot de passe maître sera conservé dans le trousseau de cet "
                            + "appareil, relisible par \(store.biometryLabel) seul.")
                })
        }
    }
}

/// Ce que la liste peut présenter par-dessus elle.
enum VaultSheet: Identifiable {
    case newItem
    case editItem(VaultEntry)
    case biometrics

    var id: String {
        switch self {
        case .newItem: return "new"
        case .editItem(let entry): return entry.id
        case .biometrics: return "biometrics"
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
