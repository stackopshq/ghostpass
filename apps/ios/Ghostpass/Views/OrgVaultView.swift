import SwiftUI

/// Le coffre d'une équipe : ses collections, et leurs identifiants.
///
/// Rien n'est mis en cache, contrairement au coffre personnel qui s'ouvre hors ligne. Un
/// accès partagé se révoque, et la révocation passe par une rotation d'Org Key : garder une
/// copie locale déchiffrable après un départ viderait cette rotation de son sens.
struct OrgVaultView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffrePartageOuvert

    @State private var choisie: OrgCollectionDTO?
    @State private var entrees: [VaultEntry] = []
    @State private var chargement = false
    @State private var recherche = ""
    @State private var edition: VaultEntry?
    @State private var creation = false
    @State private var administration = false
    @State private var aSupprimer: VaultEntry?

    /// Le droit réellement accordé sur la collection affichée, pas le rôle dans l'équipe.
    /// Un membre ordinaire peut avoir « write » sur une collection et rien sur la suivante :
    /// gager les boutons sur le rôle proposait des gestes que le serveur refusait ensuite.
    private var peutEcrire: Bool {
        guard let choisie else { return false }
        return VaultStore.peutEcrire(choisie, role: ouvert.organisation.role)
    }

    private var visibles: [VaultEntry] {
        let q = recherche.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return entrees }
        return entrees.filter {
            $0.item.name.localizedCaseInsensitiveContains(q)
                || ($0.login?.username ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(alignment: .leading, spacing: 16) {
                    if ouvert.collections.isEmpty {
                        aucuneCollection
                    } else {
                        selecteurDeCollection
                        contenu
                    }
                }
            }
            .searchable(text: $recherche, prompt: Text("Rechercher"))
            .navigationTitle(Text(verbatim: ouvert.organisation.nom))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeOrgVault")
                }
                if ouvert.organisation.role == .admin {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            administration = true
                        } label: {
                            Image(systemName: "person.2.badge.gearshape")
                        }
                        .accessibilityIdentifier("button.orgAdmin")
                    }
                }
                if peutEcrire {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            creation = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityIdentifier("button.addOrgItem")
                    }
                }
            }
        }
        .tint(Color.gpAccentText)
        .task {
            choisie = ouvert.collections.first
            await recharger()
        }
        .onChange(of: choisie?.id) { _, _ in Task { await recharger() } }
        .sheet(isPresented: $administration) {
            // L'administration change les collections et peut faire tourner la clé : dans les
            // deux cas ce qu'on affiche devient périmé, donc on referme plutôt que de montrer
            // un coffre dont la moitié ne se déchiffrerait plus.
            OrgAdminView(ouvert: ouvert) { dismiss() }
                .environmentObject(store)
        }
        .alert(
            "Supprimer cet identifiant ?", isPresented: presentation($aSupprimer),
            presenting: aSupprimer,
            actions: { entree in
                Button("Supprimer", role: .destructive) {
                    let cible = entree
                    aSupprimer = nil
                    Task { await supprimer(cible) }
                }
                Button("Annuler", role: .cancel) { aSupprimer = nil }
            },
            message: { entree in
                // Le serveur ne garde pas de corbeille et ne rend pas la main : dire
                // « définitivement » et « pour toute l'équipe » est le minimum avant un
                // geste que personne ne pourra défaire.
                Text(
                    "« \(entree.item.name) » disparaîtra définitivement, pour toute l'équipe."
                )
            }
        )
        .sheet(isPresented: $creation) { editeur(nil) }
        .sheet(item: $edition) { entree in editeur(entree) }
    }

    private var aucuneCollection: some View {
        Text(
            "Aucune collection ne vous est ouverte dans cette équipe. Un administrateur doit vous y donner accès."
        )
        .foregroundStyle(Color.gpMuted)
        .fixedSize(horizontal: false, vertical: true)
        .glassCard()
    }

    /// Un sélecteur plutôt qu'une navigation à deux niveaux : les équipes ont rarement plus
    /// d'une poignée de collections, et un aller-retour par écran pour chacune coûterait
    /// plus qu'il ne range.
    private var selecteurDeCollection: some View {
        GhostSection(titre: "Collection") {
            Picker(
                selection: Binding(
                    get: { choisie?.id ?? "" },
                    set: { id in choisie = ouvert.collections.first { $0.id == id } })
            ) {
                ForEach(ouvert.collections) { collection in
                    Text(verbatim: collection.name).tag(collection.id)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.gpAccentText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .accessibilityIdentifier("picker.collection")
        }
    }

    @ViewBuilder private var contenu: some View {
        if chargement {
            ProgressView().tint(Color.gpAccentText)
                .frame(maxWidth: .infinity, minHeight: 100)
        } else if entrees.isEmpty {
            Text("Cette collection est vide.")
                .foregroundStyle(Color.gpMuted)
                .glassCard()
        } else {
            GhostSection(titre: "Identifiants") {
                ForEach(visibles) { entree in
                    // La corbeille vit à côté du lien, pas dedans : un bouton placé dans
                    // l'étiquette d'un NavigationLink ne reçoit pas le toucher, c'est le
                    // lien qui l'absorbe. Et ces lignes ne sont pas celles d'une List :
                    // le balayage du coffre personnel n'existe pas ici.
                    HStack(spacing: 8) {
                        NavigationLink {
                            ItemDetailView(
                                entry: entree,
                                onEdit: { edition = entree },
                                lectureSeule: !peutEcrire
                            )
                            .environmentObject(store)
                        } label: {
                            GhostRow(
                                intitule: Text(verbatim: entree.item.name),
                                valeur: entree.login?.username ?? ""
                            ) {}
                        }

                        if peutEcrire {
                            Button {
                                aSupprimer = entree
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 15, weight: .medium))
                                    .frame(width: 34, height: 34)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Color.gpDanger)
                            .accessibilityLabel("Supprimer")
                            .accessibilityIdentifier("button.deleteOrgItem")
                        }
                    }
                    if entree.id != visibles.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private func editeur(_ entree: VaultEntry?) -> some View {
        ItemEditView(
            target: entree.map(EditTarget.existing) ?? .new,
            enregistrer: { item, id in
                guard let collection = choisie else { return }
                if await store.enregistrerDansLaCollection(
                    ouvert, collection: collection.id, item: item, remplace: id)
                {
                    await recharger()
                }
            }
        )
        .environmentObject(store)
    }

    private func supprimer(_ entree: VaultEntry) async {
        guard let collection = choisie else { return }
        if await store.supprimerDeLaCollection(
            ouvert, collection: collection.id, id: entree.id)
        {
            await recharger()
            // Le coffre unifié montre les mêmes lignes : sans cette relecture, l'élément
            // supprimé resterait affiché derrière cette feuille.
            await store.refresh()
        }
    }

    /// Voir `FoldersView.presentation` : `.constant` empêcherait l'alerte suivante de
    /// s'afficher, SwiftUI la croyant toujours présentée.
    private func presentation<T>(_ valeur: Binding<T?>) -> Binding<Bool> {
        Binding(
            get: { valeur.wrappedValue != nil },
            set: { presente in
                if !presente { valeur.wrappedValue = nil }
            })
    }

    private func recharger() async {
        guard let collection = choisie else { return }
        chargement = true
        entrees = await store.itemsPartages(ouvert, collection: collection.id)
        chargement = false
    }
}
