import SwiftUI

struct ItemDetailView: View {
    let entry: VaultEntry
    var onEdit: () -> Void

    @State private var revealed = false

    var body: some View {
        Form {
            switch entry.item.data {
            case .login(let login):
                Section("Identifiants") {
                    CopyRow(label: "Nom d'utilisateur", value: login.username)
                    SecretRow(label: "Mot de passe", value: login.password, revealed: $revealed)
                }
                if !login.uris.isEmpty {
                    Section("Adresses") {
                        ForEach(login.uris, id: \.self) { uri in
                            Text(uri).font(.callout).textSelection(.enabled)
                        }
                    }
                }
            case .secureNote(let note):
                Section("Note") {
                    Text(note.content).textSelection(.enabled)
                }
            case .card(let card):
                Section("Carte") {
                    CopyRow(label: "Titulaire", value: card.cardholder)
                    SecretRow(label: "Numéro", value: card.number, revealed: $revealed)
                    LabeledContent("Expiration", value: "\(card.expMonth)/\(card.expYear)")
                }
            }

            if let notes = entry.item.notes, !notes.isEmpty {
                Section("Notes") { Text(notes).textSelection(.enabled) }
            }
            if let folder = entry.item.folder, !folder.isEmpty {
                Section("Dossier") { Text(folder).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle(entry.item.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("Modifier", action: onEdit)
        }
    }
}

private struct CopyRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            LabeledContent(label, value: value)
            Spacer()
            Button {
                UIPasteboard.general.string = value
            } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
    }
}

/// Un secret ne s'affiche que sur demande explicite, et la copie ne l'affiche pas :
/// l'épaule du voisin est un modèle de menace plus courant que l'attaquant distant.
private struct SecretRow: View {
    let label: String
    let value: String
    @Binding var revealed: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(revealed ? value : String(repeating: "•", count: max(value.count, 8)))
                    .font(.system(.body, design: .monospaced))
                    .textSelection(revealed ? .enabled : .disabled)
            }
            Spacer()
            Button {
                revealed.toggle()
            } label: {
                Image(systemName: revealed ? "eye.slash" : "eye")
            }
            .buttonStyle(.borderless)
            Button {
                UIPasteboard.general.string = value
            } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
    }
}
