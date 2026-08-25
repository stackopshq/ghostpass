import SwiftUI

/// Création et modification. Le formulaire travaille sur des champs à plat puis
/// reconstitue le `VaultItem` au moment d'enregistrer : c'est le cœur Rust qui
/// chiffre, l'écran ne manipule que du clair éphémère.
struct ItemEditView: View {
    let target: EditTarget

    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var kind: Kind = .login
    @State private var name = ""
    @State private var notes = ""
    @State private var folder = ""
    @State private var username = ""
    @State private var password = ""
    @State private var uri = ""
    @State private var noteContent = ""
    @State private var cardholder = ""
    @State private var cardNumber = ""
    @State private var expMonth = ""
    @State private var expYear = ""
    @State private var cardCode = ""

    enum Kind: String, CaseIterable, Identifiable {
        case login = "Identifiant"
        case note = "Note"
        case card = "Carte"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nom", text: $name)
                    if isNew {
                        Picker("Type", selection: $kind) {
                            ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
                        }
                    }
                }

                switch kind {
                case .login:
                    Section("Identifiants") {
                        TextField("Nom d'utilisateur", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Mot de passe", text: $password)
                        TextField("Adresse du site", text: $uri)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                    }
                case .note:
                    Section("Contenu") {
                        TextEditor(text: $noteContent).frame(minHeight: 140)
                    }
                case .card:
                    Section("Carte") {
                        TextField("Titulaire", text: $cardholder)
                        TextField("Numéro", text: $cardNumber).keyboardType(.numberPad)
                        HStack {
                            TextField("MM", text: $expMonth).keyboardType(.numberPad)
                            TextField("AAAA", text: $expYear).keyboardType(.numberPad)
                        }
                        SecureField("Cryptogramme", text: $cardCode)
                    }
                }

                Section("Classement") {
                    TextField("Dossier (ex. Travail/Serveurs)", text: $folder)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...6)
                }
            }
            .navigationTitle(isNew ? "Nouvel élément" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") {
                        Task {
                            await store.save(build(), id: existingID)
                            dismiss()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: load)
        }
    }

    private var isNew: Bool {
        if case .new = target { return true }
        return false
    }

    private var existingID: String? {
        if case .existing(let entry) = target { return entry.id }
        return nil
    }

    private func load() {
        guard case .existing(let entry) = target else { return }
        name = entry.item.name
        notes = entry.item.notes ?? ""
        folder = entry.item.folder ?? ""
        switch entry.item.data {
        case .login(let login):
            kind = .login
            username = login.username
            password = login.password
            uri = login.uris.first ?? ""
        case .secureNote(let note):
            kind = .note
            noteContent = note.content
        case .card(let card):
            kind = .card
            cardholder = card.cardholder
            cardNumber = card.number
            expMonth = card.expMonth
            expYear = card.expYear
            cardCode = card.code
        }
    }

    private func build() -> VaultItem {
        let data: ItemData
        switch kind {
        case .login:
            data = .login(
                Login(
                    username: username, password: password,
                    uris: uri.isEmpty ? [] : [uri], totp: nil,
                    passwordHistory: previousPasswords()))
        case .note:
            data = .secureNote(SecureNote(content: noteContent))
        case .card:
            data = .card(
                Card(
                    cardholder: cardholder, number: cardNumber, expMonth: expMonth,
                    expYear: expYear, code: cardCode))
        }
        return VaultItem(
            name: name.trimmingCharacters(in: .whitespaces),
            notes: notes.isEmpty ? nil : notes,
            folder: folder.isEmpty ? nil : folder,
            data: data)
    }

    /// Un mot de passe remplacé rejoint l'historique plutôt que de disparaître : c'est
    /// ce que fait la web app, et c'est ce qui permet de récupérer un compte dont le
    /// changement de mot de passe a échoué à mi-chemin.
    private func previousPasswords() -> [String] {
        guard case .existing(let entry) = target, let login = entry.login else { return [] }
        guard login.password != password, !login.password.isEmpty else {
            return login.passwordHistory
        }
        return [login.password] + login.passwordHistory
    }
}
