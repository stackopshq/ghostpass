import SwiftUI

struct ItemDetailView: View {
    let entry: VaultEntry
    var onEdit: () -> Void

    @EnvironmentObject private var store: VaultStore
    @State private var revealed = false

    /// L'entrée telle qu'elle est *maintenant* dans le coffre. Sans cela, l'écran garderait
    /// la copie reçue à la navigation et continuerait d'afficher l'ancien contenu après une
    /// modification — l'utilisateur croirait son enregistrement perdu.
    private var live: VaultEntry { store.entries.first { $0.id == entry.id } ?? entry }

    var body: some View {
        Form {
            switch live.item.data {
            case .login(let login):
                Section("Identifiants") {
                    CopyRow(label: "Nom d'utilisateur", value: login.username)
                    SecretRow(label: "Mot de passe", value: login.password, revealed: $revealed)
                }
                if let config = login.totp.flatMap(Totp.parse) {
                    Section("Code à usage unique") {
                        // `TimelineView` réévalue chaque seconde : pas de minuterie à
                        // démarrer ni à arrêter, et rien ne continue de tourner une fois
                        // l'écran quitté.
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            if let otp = Totp.code(for: config, at: context.date) {
                                HStack {
                                    Text(otp.code)
                                        .font(.system(.title2, design: .monospaced))
                                        .accessibilityIdentifier("text.totp")
                                    Spacer()
                                    Text("\(otp.remaining) s")
                                        .font(.footnote)
                                        .foregroundStyle(otp.remaining <= 5 ? .red : .secondary)
                                        .monospacedDigit()
                                    Button {
                                        Clipboard.copy(otp.code)
                                    } label: {
                                        Image(systemName: "doc.on.doc")
                                    }
                                    .buttonStyle(.borderless)
                                }
                            } else {
                                Text("Clé de vérification illisible.")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
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

            if let notes = live.item.notes, !notes.isEmpty {
                Section("Notes") { Text(notes).textSelection(.enabled) }
            }
            if let folder = live.item.folder, !folder.isEmpty {
                Section("Dossier") { Text(folder).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle(live.item.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("Modifier", action: onEdit)
                .accessibilityIdentifier("button.edit")
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
                Clipboard.copy(value)
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
                // `.enabled` et `.disabled` sont deux types distincts : un ternaire ne les
                // unifie pas. Le modificateur ne porte donc que sur le cas révélé — masqué,
                // il n'y aurait de toute façon que des puces à sélectionner.
                Group {
                    if revealed {
                        Text(value).textSelection(.enabled)
                    } else {
                        Text(String(repeating: "•", count: max(value.count, 8)))
                    }
                }
                .font(.system(.body, design: .monospaced))
            }
            Spacer()
            Button {
                revealed.toggle()
            } label: {
                Image(systemName: revealed ? "eye.slash" : "eye")
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("button.reveal")
            Button {
                Clipboard.copy(value)
            } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
    }
}
