import SwiftUI
import UniformTypeIdentifiers

/// Import d'un CSV exporté par un autre gestionnaire de mots de passe.
///
/// Deux temps : on lit le fichier et on montre ce qu'on y a trouvé, puis on dépose. Un
/// import qui part sans rien montrer est un import qu'on n'ose pas lancer — et celui-ci
/// écrit dans le coffre, ce qui ne se défait qu'entrée par entrée.
struct ImportView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var choix = false
    @State private var trouves: [VaultItem] = []
    @State private var nomDuFichier = ""
    @State private var echec: LocalizedStringKey?
    @State private var deposes: Int?

    var body: some View {
        NavigationStack {
            GhostScreen {
                if let deposes {
                    resultat(deposes)
                } else if trouves.isEmpty {
                    presentation
                } else {
                    apercu
                }
            }
            .navigationTitle("Importer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(deposes == nil ? "Annuler" : "Terminé") { dismiss() }
                        .foregroundStyle(deposes == nil ? Color.gpMuted : Color.gpAccentText)
                        .accessibilityIdentifier("button.closeImport")
                }
            }
            // Un sélecteur de fichiers rend l'application inactive sans qu'elle quitte
            // l'écran : on le dit au magasin, sinon le verrouillage immédiat couperait
            // l'opération en cours.
            //
            // Suspendu au seul moment où le sélecteur est présenté, et non à toute la vie
            // de l'écran : posé sur `onAppear`, il désarmait le verrouillage immédiat
            // pendant qu'on lisait la page, avant même d'avoir cliqué. Une exemption doit
            // durer exactement ce qu'elle protège.
            .onChange(of: choix) { _, present in
                store.unSelecteurDeFichiersEstOuvert = present
            }
            .onDisappear { store.unSelecteurDeFichiersEstOuvert = false }
            .fileImporter(
                isPresented: $choix, allowedContentTypes: [.commaSeparatedText, .text]
            ) { resultat in
                lire(resultat)
            }
        }
        .tint(Color.gpAccentText)
    }

    private var presentation: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 76, height: 76)
                .background(Color.gpAccent.opacity(0.14), in: Circle())
                .frame(maxWidth: .infinity, alignment: .center)

            Text(
                "Choisissez le fichier CSV exporté par votre gestionnaire actuel. Les colonnes de Bitwarden, Dashlane, 1Password, LastPass et Chrome sont reconnues."
            )
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)

            Text(
                "Le fichier est lu sur l'appareil et rien d'autre n'en sort : chaque entrée est chiffrée avant d'être déposée. Pensez à l'effacer ensuite — un export CSV contient vos mots de passe en clair."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)

            Button("Choisir un fichier") { choix = true }
                .buttonStyle(PrimaryButtonStyle(enabled: !store.isBusy))
                .disabled(store.isBusy)
                .accessibilityIdentifier("button.pickCsv")

            if let echec {
                Label {
                    Text(echec)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpDanger)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("text.importError")
            }
        }
        .glassCard()
    }

    private var apercu: some View {
        VStack(alignment: .leading, spacing: 16) {
            GhostSection(
                titre: "À importer",
                note:
                    "Rien n'est encore déposé. Les entrées rejoindront le coffre telles quelles ; aucune n'écrase ce qui s'y trouve déjà."
            ) {
                GhostRow(intitule: Text("Fichier"), valeur: nomDuFichier) {}
                GhostDivider()
                GhostRow(intitule: Text("Entrées trouvées"), valeur: "\(trouves.count)") {}
            }

            GhostSection(titre: "Aperçu") {
                // Les premières seulement : une liste de deux cents lignes n'apprendrait
                // rien de plus sur la bonne lecture des colonnes.
                ForEach(Array(trouves.prefix(5).enumerated()), id: \.offset) { rang, item in
                    if rang > 0 { GhostDivider() }
                    ligne(item)
                }
                if trouves.count > 5 {
                    GhostDivider()
                    Text("et \(trouves.count - 5) autres")
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }

            Button("Importer \(trouves.count) entrées") {
                Task {
                    let n = await store.importItems(trouves)
                    deposes = n
                }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: !store.isBusy))
            .disabled(store.isBusy)
            .accessibilityIdentifier("button.confirmImport")
        }
    }

    private func resultat(_ nombre: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label {
                Text("\(nombre) entrées importées")
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
            .font(.system(.headline, design: .rounded))
            .foregroundStyle(Color.gpInk)
            .accessibilityIdentifier("text.imported")

            if let message = store.errorMessage {
                Text(verbatim: message)
                    .font(.footnote)
                    .foregroundStyle(Color.gpDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("N'oubliez pas d'effacer le fichier CSV : il contient vos mots de passe en clair.")
                .font(.footnote)
                .foregroundStyle(Color.gpMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .glassCard()
    }

    private func ligne(_ item: VaultItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "person.badge.key")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 30, height: 30)
                .background(Color.gpAccent.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .foregroundStyle(Color.gpInk)
                    .lineLimit(1)
                if case .login(let login) = item.data, !login.username.isEmpty {
                    Text(verbatim: login.username)
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func lire(_ resultat: Result<URL, Error>) {
        echec = nil
        guard case .success(let url) = resultat else {
            if case .failure = resultat { echec = "Le fichier n'a pas pu être ouvert." }
            return
        }
        // Un fichier choisi hors du bac à sable de l'app ne se lit qu'après cette
        // permission, et elle se rend aussitôt.
        let autorise = url.startAccessingSecurityScopedResource()
        defer { if autorise { url.stopAccessingSecurityScopedResource() } }

        guard let donnees = try? Data(contentsOf: url) else {
            echec = "Le fichier n'a pas pu être lu."
            return
        }
        let items = CsvImport.items(String(decoding: donnees, as: UTF8.self))
        guard !items.isEmpty else {
            echec =
                "Aucune entrée trouvée : le fichier est vide, ou ses colonnes ne sont pas reconnues."
            return
        }
        nomDuFichier = url.lastPathComponent
        trouves = items
    }
}
