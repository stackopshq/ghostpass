import SwiftUI

/// Choix du dossier affiché, et gestion de ceux qui existent.
///
/// Une feuille plutôt qu'une colonne latérale : sur un téléphone, l'arborescence de la web
/// app tiendrait mal, et le filtre ne sert que par intermittence. Les chemins hiérarchiques
/// (`Travail/Serveurs`) restent lisibles tels quels, sans arbre à déplier.
struct FoldersView: View {
    @Binding var selection: String?

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
                        compte: store.entries.count, chemin: nil)

                    if !store.folderPaths.isEmpty {
                        Section {
                            ForEach(store.folderPaths, id: \.self) { chemin in
                                ligne(
                                    // Un nom de dossier appartient à l'utilisateur : il
                                    // s'affiche tel quel, jamais traduit.
                                    titre: Text(verbatim: chemin), icone: "folder",
                                    compte: store.itemCount(in: chemin), chemin: chemin
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
                        if selection == chemin { selection = nil }
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

    private func ligne(titre: Text, icone: String, compte: Int, chemin: String?) -> some View {
        Button {
            selection = chemin
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

                if selection == chemin {
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
                        selection == chemin ? Color.gpAccent : Color.gpBorder,
                        lineWidth: selection == chemin ? 1.5 : 1))
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
