import SwiftUI

/// Choix du dossier affiché, et gestion de ceux qui existent.
///
/// Une feuille plutôt qu'une colonne latérale : sur un téléphone, l'arborescence de la web
/// app tiendrait mal, et le filtre ne sert que par intermittence. Les chemins hiérarchiques
/// (`Travail/Serveurs`) restent lisibles tels quels, sans arbre à déplier.
struct FoldersView: View {
    @Binding var selection: FiltreDuCoffre

    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var creation = false
    @State private var nouveau = ""
    @State private var aSupprimer: String?

    var body: some View {
        NavigationStack {
            ZStack {
                GhostBackground()

                List {
                    if creation {
                        champDeCreation
                            .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    ligne(
                        titre: Text("Tous les éléments"), icone: "tray.full",
                        compte: store.entries.count, filtre: .tout)

                    if !store.folderPaths.isEmpty {
                        Section {
                            ForEach(store.folderPaths, id: \.self) { chemin in
                                ligne(
                                    // Un nom de dossier appartient à l'utilisateur : il
                                    // s'affiche tel quel, jamais traduit.
                                    titre: Text(verbatim: chemin), icone: "folder",
                                    compte: store.itemCount(in: chemin),
                                    filtre: .dossier(chemin)
                                )
                                .swipeActions {
                                    // Seuls les dossiers vides s'effacent du registre : les
                                    // autres n'y figurent pas, ils naissent de leurs éléments.
                                    if store.emptyFolders.contains(chemin) {
                                        Button("Supprimer", role: .destructive) {
                                            aSupprimer = chemin
                                        }
                                    }
                                }
                            }
                        } header: {
                            Text("Dossiers").sectionLabel().padding(.leading, 2)
                        }
                    }

                    // Une section par équipe. Les collections y sont des frontières de
                    // partage, pas des rangements : les mêler aux dossiers personnels
                    // laisserait croire qu'on peut y ranger ce qu'on veut.
                    ForEach(store.collectionsVisibles) { equipe in
                        Section {
                            ForEach(equipe.collections) { collection in
                                ligne(
                                    titre: Text(verbatim: collection.nom),
                                    icone: "person.2",
                                    compte: collection.compte,
                                    filtre: .collection(
                                        organisation: collection.organisation,
                                        collection: collection.id, nom: collection.nom))
                            }
                        } header: {
                            Text(verbatim: equipe.nom).sectionLabel().padding(.leading, 2)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .overlay {
                    if store.folderPaths.isEmpty {
                        ContentUnavailableView {
                            Label("Aucun dossier", systemImage: "folder")
                        } description: {
                            Text("Créez-en un, ou renseignez un dossier sur un élément.")
                        }
                        .foregroundStyle(Color.gpMuted)
                    }
                }
            }
            .navigationTitle("Dossiers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeFolders")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        nouveau = ""
                        creation.toggle()
                    } label: {
                        Image(systemName: "folder.badge.plus")
                    }
                    .foregroundStyle(Color.gpAccentText)
                    .accessibilityIdentifier("button.newFolder")
                }
            }
            .alert(
                "Supprimer ce dossier ?", isPresented: presentation($aSupprimer),
                presenting: aSupprimer,
                actions: { chemin in
                    Button("Supprimer", role: .destructive) {
                        Task { await store.removeFolder(chemin) }
                        if selection == .dossier(chemin) { selection = .tout }
                        aSupprimer = nil
                    }
                    Button("Annuler", role: .cancel) { aSupprimer = nil }
                },
                message: { chemin in
                    Text("« \(chemin) » disparaîtra de la liste. Aucun élément n'est supprimé.")
                })
        }
        .tint(Color.gpAccentText)
    }

    /// Saisie en ligne plutôt qu'en alerte : un champ d'alerte SwiftUI n'expose pas son
    /// identifiant d'accessibilité, et l'ensemble se présente mal depuis une feuille.
    private var champDeCreation: some View {
        HStack(spacing: 10) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 34, height: 34)
                .background(Color.gpAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))

            TextField(
                "", text: $nouveau,
                prompt: Text("Travail/Serveurs").foregroundColor(Color.gpMuted.opacity(0.7))
            )
            .foregroundStyle(Color.gpInk)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .onSubmit { creer() }
            .accessibilityIdentifier("field.folderName")

            Button("Créer", action: creer)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(nouveau.isEmpty ? Color.gpMuted : Color.gpAccentText)
                .disabled(nouveau.isEmpty)
                .accessibilityIdentifier("button.createFolder")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.gpSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: GP.radius))
        .overlay(
            RoundedRectangle(cornerRadius: GP.radius)
                .strokeBorder(Color.gpAccent, lineWidth: 1.5))
    }

    private func creer() {
        let chemin = nouveau
        nouveau = ""
        creation = false
        guard !VaultStore.normaliser(chemin).isEmpty else { return }
        Task { await store.createFolder(chemin) }
    }

    private func ligne(titre: Text, icone: String, compte: Int, filtre: FiltreDuCoffre)
        -> some View
    {
        Button {
            selection = filtre
            dismiss()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icone)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.gpAccentText)
                    .frame(width: 34, height: 34)
                    .background(Color.gpAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))

                titre
                    .font(.system(.body, weight: .medium))
                    .foregroundStyle(Color.gpInk)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text("\(compte)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.gpMuted)

                if selection == filtre {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.gpAccentText)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color.gpSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: GP.radius))
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(
                        selection == filtre ? Color.gpAccent : Color.gpBorder,
                        lineWidth: selection == filtre ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// Une liaison qui écrit en retour. `.constant` refuse la fermeture que le système
    /// lui demande d'enregistrer : SwiftUI croit alors l'alerte encore présentée, et la
    /// suivante ne s'affiche plus — le défaut qui a rendu la proposition biométrique
    /// intapable, en plus discret ici puisqu'il n'y a qu'une alerte sur cet écran.
    private func presentation<T>(_ valeur: Binding<T?>) -> Binding<Bool> {
        Binding(
            get: { valeur.wrappedValue != nil },
            set: { presente in
                if !presente { valeur.wrappedValue = nil }
            })
    }
}
