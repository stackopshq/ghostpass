import SwiftUI

/// Le coffre : la liste des identifiants, posée sur la nuit de la suite.
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
            ZStack {
                GhostBackground()

                List {
                    if store.isOffline {
                        bandeauHorsLigne
                            .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    ForEach(visible) { entry in
                        // Un lien en bonne et due forme : masquer le NavigationLink sous
                        // une opacité nulle le rendrait inatteignable, au clavier comme
                        // au doigt. Le chevron du système fait donc l'affaire.
                        NavigationLink(value: entry) {
                            VaultRow(entry: entry)
                        }
                        .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .swipeActions {
                            Button("Supprimer", role: .destructive) {
                                Task { await store.delete(entry) }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .overlay {
                    if store.entries.isEmpty {
                        coffreVide
                    } else if visible.isEmpty {
                        aucunResultat
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
            .refreshable { await store.refresh() }
            .navigationTitle("Coffre")
            .toolbarBackground(Color.gpBase.opacity(0.9), for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Verrouiller") { store.lock() }
                        .foregroundStyle(Color.gpAccentText)
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
                                Button("Activer \(store.biometryLabel)") { sheet = .biometrics }
                                    .accessibilityIdentifier("button.biometricOn")
                            }
                        }
                        Button("Corbeille", systemImage: "trash") { sheet = .trash }
                            .accessibilityIdentifier("button.trash")
                        Button("Se déconnecter", role: .destructive) {
                            Task { await store.signOut() }
                        }
                        .accessibilityIdentifier("button.signOut")
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Color.gpAccentText)
                    }
                    .accessibilityIdentifier("button.settings")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        sheet = .newItem
                    } label: {
                        Image(systemName: "plus")
                            .foregroundStyle(Color.gpAccentText)
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
                case .trash:
                    TrashView().environmentObject(store)
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
        .tint(Color.gpAccentText)
    }

    private var bandeauHorsLigne: some View {
        Label("Hors ligne — coffre affiché depuis cet appareil", systemImage: "wifi.slash")
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.gpSurface2, in: RoundedRectangle(cornerRadius: GP.radius))
            .accessibilityIdentifier("banner.offline")
    }

    private var coffreVide: some View {
        ContentUnavailableView {
            Label("Coffre vide", systemImage: "lock")
        } description: {
            Text("Ajoutez un identifiant avec le bouton +.")
        }
        .foregroundStyle(Color.gpMuted)
    }

    private var aucunResultat: some View {
        ContentUnavailableView.search(text: search)
            .foregroundStyle(Color.gpMuted)
    }
}

/// Ce que la liste peut présenter par-dessus elle.
enum VaultSheet: Identifiable {
    case newItem
    case editItem(VaultEntry)
    case biometrics
    case trash

    var id: String {
        switch self {
        case .newItem: return "new"
        case .editItem(let entry): return entry.id
        case .biometrics: return "biometrics"
        case .trash: return "trash"
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

/// Une ligne du coffre : une pastille de type, le nom, ce qui aide à le reconnaître.
private struct VaultRow: View {
    let entry: VaultEntry

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.gpAccent.opacity(0.16))
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.gpAccentText)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.item.name)
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Color.gpInk)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                        .lineLimit(1)
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
