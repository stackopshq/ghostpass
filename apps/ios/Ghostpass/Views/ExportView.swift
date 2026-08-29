import SwiftUI
import UniformTypeIdentifiers

/// Export du coffre en CSV.
///
/// Le fichier produit contient tous les mots de passe en clair — c'est ce qu'est un export
/// CSV, et c'est ce qui le rend utile pour partir ailleurs. D'où deux garde-fous : le mot
/// de passe maître est redemandé, parce qu'un téléphone déverrouillé posé sur une table ne
/// doit pas suffire à vider le coffre ; et l'écran rappelle d'effacer le fichier ensuite.
struct ExportView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var motDePasse = ""
    @State private var document: DocumentCsv?
    @State private var enregistrement = false
    @State private var fait = false

    var body: some View {
        NavigationStack {
            GhostScreen {
                if fait {
                    resultat
                } else {
                    formulaire
                }
            }
            .navigationTitle("Exporter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(fait ? "Terminé" : "Annuler") {
                        store.errorMessage = nil
                        dismiss()
                    }
                    .foregroundStyle(fait ? Color.gpAccentText : Color.gpMuted)
                    .accessibilityIdentifier("button.closeExport")
                }
            }
            .fileExporter(
                isPresented: $enregistrement, document: document,
                contentType: .commaSeparatedText,
                defaultFilename: CsvExport.nomDeFichier()
            ) { resultat in
                if case .success = resultat { fait = true }
                // Un export annulé n'est pas un échec : on laisse l'écran en place.
                document = nil
            }
        }
        .tint(Color.gpAccentText)
    }

    private var formulaire: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 76, height: 76)
                .background(Color.gpAccent.opacity(0.14), in: Circle())
                .frame(maxWidth: .infinity, alignment: .center)

            Text(
                "Le fichier contiendra vos \(store.entries.count) entrées, mots de passe compris, en clair. Il se relit dans n'importe quel gestionnaire — et par n'importe qui."
            )
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 7) {
                Text("Mot de passe maître").sectionLabel()
                SecureField("", text: $motDePasse, prompt: invite("Votre mot de passe"))
                    .ghostField()
                    .accessibilityIdentifier("field.exportMaster")
            }

            if let message = store.errorMessage {
                Label {
                    Text(verbatim: message)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpDanger)
                .fixedSize(horizontal: false, vertical: true)
            }

            Button("Préparer le fichier") { preparer() }
                .buttonStyle(
                    PrimaryButtonStyle(enabled: !motDePasse.isEmpty && !store.entries.isEmpty)
                )
                .disabled(motDePasse.isEmpty || store.entries.isEmpty)
                .accessibilityIdentifier("button.prepareExport")
        }
        .glassCard()
    }

    private var resultat: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label {
                Text("Fichier enregistré.")
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
            .font(.system(.headline, design: .rounded))
            .foregroundStyle(Color.gpInk)
            .accessibilityIdentifier("text.exported")

            Text(
                "Mettez-le à l'abri, puis effacez-le : tant qu'il existe, vos mots de passe sont lisibles par qui met la main dessus."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .glassCard()
    }

    /// Vérifie le mot de passe maître avant de fabriquer le fichier. La vérification passe
    /// par le cœur Rust — c'est une dérivation Argon2id, pas une comparaison de chaînes.
    private func preparer() {
        guard store.verifyMasterPassword(motDePasse) else { return }
        motDePasse = ""
        document = DocumentCsv(texte: CsvExport.texte(store.entries))
        enregistrement = true
    }

    private func invite(_ texte: LocalizedStringKey) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }
}

/// Le fichier tel que le voit `fileExporter`. Rien n'est écrit sur le disque tant que
/// l'utilisateur n'a pas choisi la destination.
struct DocumentCsv: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }

    let texte: String

    init(texte: String) { self.texte = texte }

    init(configuration: ReadConfiguration) throws {
        guard let donnees = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        texte = String(decoding: donnees, as: UTF8.self)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(texte.utf8))
    }
}
