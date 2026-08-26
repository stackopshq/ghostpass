import SwiftUI

/// Le coffre : la liste des identifiants, posée sur la nuit de la suite.
struct VaultListView: View {
    @EnvironmentObject private var store: VaultStore
    @State private var search = ""
    /// Une seule feuille à la fois : deux modificateurs `.sheet` sur la même vue se
    /// marchent dessus, et c'est la première déclarée qui cesse de s'ouvrir.
    @State private var sheet: VaultSheet?
    /// Dossier affiché ; `nil` pour tout le coffre.
    @State private var folder: String?
    /// Le chemin de navigation, tenu à la main : c'est ce qui permet à l'écran de santé
    /// d'envoyer directement sur l'élément qu'il signale.
    @State private var chemin: [VaultEntry] = []
    /// L'élément qu'une feuille demande d'ouvrir. On attend qu'elle soit refermée pour
    /// pousser l'écran : présenter et empiler en même temps, et l'un des deux se perd.
    @State private var aOuvrir: VaultEntry?

    private var visible: [VaultEntry] {
        store.entries.filter { entry in
            // Un dossier contient aussi ce que rangent ses sous-dossiers.
            if let folder {
                let range = entry.item.folder ?? ""
                guard range == folder || range.hasPrefix(folder + "/") else { return false }
            }
            guard !search.isEmpty else { return true }
            return entry.item.name.localizedCaseInsensitiveContains(search)
                || (entry.login?.username.localizedCaseInsensitiveContains(search) ?? false)
                || (entry.login?.uris.contains { $0.localizedCaseInsensitiveContains(search) } ?? false)
        }
    }

    var body: some View {
        NavigationStack(path: $chemin) {
            ZStack {
                GhostBackground()

                List {
                    if store.isOffline {
                        bandeauHorsLigne
                            .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    filtreDeDossier
                        .listRowInsets(.init(top: 0, leading: 16, bottom: 8, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)

                    // Les favoris en tête, et seulement quand on regarde le coffre
                    // entier : sous un filtre ou une recherche, les répéter reviendrait à
                    // montrer deux fois les mêmes lignes.
                    if !favoris.isEmpty {
                        Section {
                            ForEach(favoris) { entry in
                                ligne(entry)
                            }
                        } header: {
                            // L'intitulé s'affiche en capitales : c'est l'identifiant, et
                            // non le libellé, qui permet de le retrouver dans les tests.
                            Text("Favoris").sectionLabel().padding(.leading, 2)
                                .accessibilityIdentifier("header.favorites")
                        }
                        .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }

                    ForEach(visible) { entry in
                        ligne(entry)
                            .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
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
                        Button("Santé du coffre", systemImage: "checkmark.shield") {
                            sheet = .health
                        }
                        .accessibilityIdentifier("button.health")
                        Button("Corbeille", systemImage: "trash") { sheet = .trash }
                            .accessibilityIdentifier("button.trash")
                        Button("Réglages", systemImage: "gearshape") { sheet = .settings }
                            .accessibilityIdentifier("button.preferences")
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
            .sheet(item: $sheet, onDismiss: ouvrirLElementDemande) { destination in
                switch destination {
                case .newItem:
                    ItemEditView(target: .new).environmentObject(store)
                case .editItem(let entry):
                    ItemEditView(target: .existing(entry)).environmentObject(store)
                case .biometrics:
                    BiometricSetupView().environmentObject(store)
                case .trash:
                    TrashView().environmentObject(store)
                case .folders:
                    FoldersView(selection: $folder).environmentObject(store)
                case .settings:
                    SettingsView().environmentObject(Preferences.shared)
                case .biometricOffer:
                    BiometricOfferView().environmentObject(store)
                case .health:
                    HealthView { aOuvrir = $0 }.environmentObject(store)
                }
            }
            // Une seule alerte, et rien d'autre par-dessus : deux modificateurs `.alert`
            // sur la même vue se marchent dessus exactement comme deux `.sheet`. La
            // liaison écrit en retour — un `.constant` ignore la fermeture que le système
            // lui demande d'enregistrer, et SwiftUI croit ensuite l'alerte encore là.
            .alert(
                "Erreur", isPresented: erreurAffichee,
                actions: { Button("OK") { store.errorMessage = nil } },
                message: { Text(verbatim: store.errorMessage ?? "") })
            // La proposition d'activer la biométrie arrive avec le coffre, une fois le
            // déchiffrement terminé.
            .onAppear { proposerLaBiometrieSiBesoin() }
            .onChange(of: store.offersBiometricEnrollment) { _, _ in
                proposerLaBiometrieSiBesoin()
            }
        }
        .tint(Color.gpAccentText)
    }

    /// Une liaison qui écrit en retour : fermer l'alerte efface le message qu'elle
    /// portait, plutôt que de laisser SwiftUI la croire encore présentée.
    private var erreurAffichee: Binding<Bool> {
        Binding(
            get: { store.errorMessage != nil },
            set: { presente in
                if !presente { store.errorMessage = nil }
            })
    }

    /// Les favoris, tant qu'aucun filtre ne restreint déjà la liste.
    private var favoris: [VaultEntry] {
        guard folder == nil, search.isEmpty else { return [] }
        return store.favoriteEntries
    }

    /// Une ligne du coffre. Un lien en bonne et due forme : masquer le `NavigationLink`
    /// sous une opacité nulle le rendrait inatteignable, au clavier comme au doigt. Le
    /// chevron du système fait donc l'affaire.
    private func ligne(_ entry: VaultEntry) -> some View {
        NavigationLink(value: entry) {
            VaultRow(entry: entry, favori: store.isFavorite(entry))
        }
        .swipeActions(edge: .leading) {
            Button(store.isFavorite(entry) ? "Retirer des favoris" : "Mettre en favori") {
                Task { await store.toggleFavorite(entry) }
            }
            .tint(Color.gpAccent)
        }
        .swipeActions {
            Button("Supprimer", role: .destructive) {
                Task { await store.delete(entry) }
            }
        }
    }

    private func ouvrirLElementDemande() {
        guard let entry = aOuvrir else { return }
        aOuvrir = nil
        chemin = [entry]
    }

    /// N'ouvre la feuille que si rien d'autre n'est déjà présenté : deux feuilles qui se
    /// succèdent trop vite s'annulent, et l'utilisateur se retrouve devant rien.
    private func proposerLaBiometrieSiBesoin() {
        guard store.offersBiometricEnrollment, sheet == nil else { return }
        sheet = .biometricOffer
    }

    /// Le filtre courant, toujours visible : un dossier sélectionné qu'on aurait oublié
    /// donnerait l'impression d'un coffre amputé.
    private var filtreDeDossier: some View {
        Button {
            sheet = .folders
        } label: {
            HStack(spacing: 8) {
                Image(systemName: folder == nil ? "tray.full" : "folder.fill")
                    .font(.system(size: 13, weight: .medium))
                Group {
                    if let folder {
                        Text(verbatim: folder)
                    } else {
                        Text("Tous les éléments")
                    }
                }
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                Spacer(minLength: 4)
                Text("\(visible.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.gpMuted)
            }
            .foregroundStyle(folder == nil ? Color.gpMuted : Color.gpAccentText)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                folder == nil ? Color.gpSurface2 : Color.gpAccent.opacity(0.16),
                in: RoundedRectangle(cornerRadius: GP.radius)
            )
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(folder == nil ? Color.gpBorder : Color.gpAccent, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("button.folderFilter")
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
    case folders
    case settings
    case biometricOffer
    case health

    var id: String {
        switch self {
        case .newItem: return "new"
        case .editItem(let entry): return entry.id
        case .biometrics: return "biometrics"
        case .trash: return "trash"
        case .folders: return "folders"
        case .settings: return "settings"
        case .biometricOffer: return "biometricOffer"
        case .health: return "health"
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
    var favori = false

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
                Text(verbatim: entry.item.name)
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Color.gpInk)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            if favori {
                Image(systemName: "star.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.gpAccentText)
                    .accessibilityHidden(true)
            }
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
