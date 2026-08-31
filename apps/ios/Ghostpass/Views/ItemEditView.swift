import SwiftUI

/// Création et modification. Le formulaire travaille sur des champs à plat puis
/// reconstitue le `VaultItem` au moment d'enregistrer : c'est le cœur Rust qui
/// chiffre, l'écran ne manipule que du clair éphémère.
struct ItemEditView: View {
    let target: EditTarget
    /// Où enregistrer. Par défaut le coffre personnel ; une collection d'équipe fournit le
    /// sien, car un item partagé se chiffre sous l'Org Key et non sous la nôtre. Le
    /// formulaire, lui, est le même — il n'y a aucune raison d'en tenir deux.
    var enregistrer: ((VaultItem, String?) async -> Void)?

    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var kind: Kind = .login
    @State private var name = ""
    @State private var notes = ""
    @State private var folder = ""
    @State private var username = ""
    @State private var password = ""
    @State private var uri = ""
    @State private var totp = ""
    @State private var noteContent = ""
    @State private var cardholder = ""
    @State private var cardNumber = ""
    @State private var expMonth = ""
    @State private var expYear = ""
    @State private var cardCode = ""
    @State private var generating = false
    @State private var scanEnCours = false

    enum Kind: String, CaseIterable, Identifiable {
        case login
        case note
        case card
        var id: String { rawValue }

        /// Une clef de traduction, pas le `rawValue` : celui-ci identifie le cas dans le
        /// code, ce qui s'affiche est autre chose et change avec la langue.
        var libelle: LocalizedStringKey {
            switch self {
            case .login: return "Identifiant"
            case .note: return "Note"
            case .card: return "Carte"
            }
        }

        var icone: String {
            switch self {
            case .login: return "person.badge.key"
            case .note: return "note.text"
            case .card: return "creditcard"
            }
        }
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                GhostSection(titre: "Nom") {
                    TextField("", text: $name, prompt: invite("GitHub, Amazon…"))
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.name")
                }

                if isNew {
                    selecteurDeType
                }

                switch kind {
                case .login: champsIdentifiant
                case .note: champsNote
                case .card: champsCarte
                }

                GhostSection(titre: "Classement") {
                    TextField("", text: $folder, prompt: invite("Dossier — Travail/Serveurs"))
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.folder")
                    GhostDivider()
                    TextField("", text: $notes, prompt: invite("Notes"), axis: .vertical)
                        .lineLimit(2...6)
                        .foregroundStyle(Color.gpInk)
                        .padding(14)
                        .accessibilityIdentifier("field.notes")
                }
            }
            .navigationTitle(isNew ? Text("Nouvel élément") : Text("Modifier"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                        .foregroundStyle(Color.gpMuted)
                        .accessibilityIdentifier("button.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") {
                        Task {
                            if let enregistrer {
                                await enregistrer(build(), existingID)
                            } else {
                                await store.save(build(), id: existingID)
                            }
                            dismiss()
                        }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.gpAccentText)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("button.save")
                }
            }
            .onAppear(perform: load)
            .sheet(isPresented: $generating) {
                PasswordGeneratorView { password = $0 }
            }
            .sheet(isPresented: $scanEnCours) {
                ScanDeTotpView { totp = $0 }
            }
        }
        .tint(Color.gpAccentText)
    }

    /// Le type ne se choisit qu'à la création : le changer ensuite reviendrait à remplacer
    /// l'élément, pas à le modifier.
    private var selecteurDeType: some View {
        HStack(spacing: 10) {
            ForEach(Kind.allCases) { cas in
                Button {
                    kind = cas
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: cas.icone).font(.system(size: 17, weight: .medium))
                        Text(cas.libelle).font(.caption.weight(.medium))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        kind == cas ? Color.gpAccent.opacity(0.18) : Color.gpSurface.opacity(0.7),
                        in: RoundedRectangle(cornerRadius: GP.radius)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: GP.radius)
                            .strokeBorder(
                                kind == cas ? Color.gpAccent : Color.gpBorder,
                                lineWidth: kind == cas ? 1.5 : 1)
                    )
                    .foregroundStyle(kind == cas ? Color.gpAccentText : Color.gpMuted)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var champsIdentifiant: some View {
        Group {
            GhostSection(titre: "Identifiants") {
                TextField("", text: $username, prompt: invite("Nom d'utilisateur"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(Color.gpInk)
                    .padding(14)
                    .accessibilityIdentifier("field.username")
                GhostDivider()
                HStack(spacing: 8) {
                    SecureField("", text: $password, prompt: invite("Mot de passe"))
                        .foregroundStyle(Color.gpInk)
                        .accessibilityIdentifier("field.password")
                    GhostIconButton(systemImage: "dice") { generating = true }
                        .accessibilityIdentifier("button.generate")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                GhostDivider()
                TextField("", text: $uri, prompt: invite("Adresse du site"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .foregroundStyle(Color.gpInk)
                    .padding(14)
                    .accessibilityIdentifier("field.uri")
            }

            GhostSection(
                titre: "Code à usage unique",
                note:
                    "La clé reste chiffrée dans l'élément ; les codes sont calculés sur l'appareil."
            ) {
                HStack(spacing: 10) {
                    TextField("", text: $totp, prompt: invite("Clé ou URI otpauth://"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(Color.gpInk)
                        .accessibilityIdentifier("field.totp")

                    // Recopier trente-deux caractères base32 à la main est le moment où
                    // l'on se trompe. Le QR code porte la même clé, plus la période et le
                    // nombre de chiffres que la saisie manuelle laisse aux valeurs par
                    // défaut — parfois à tort.
                    Button {
                        scanEnCours = true
                    } label: {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 17, weight: .medium))
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.gpAccentText)
                    .accessibilityLabel("Scanner le QR code")
                    .accessibilityIdentifier("button.scanTotp")
                }
                .padding(14)
            }
        }
    }

    private var champsNote: some View {
        GhostSection(titre: "Contenu") {
            TextField("", text: $noteContent, prompt: invite("Votre note"), axis: .vertical)
                .lineLimit(6...14)
                .foregroundStyle(Color.gpInk)
                .padding(14)
                .accessibilityIdentifier("field.note")
        }
    }

    private var champsCarte: some View {
        GhostSection(titre: "Carte") {
            TextField("", text: $cardholder, prompt: invite("Titulaire"))
                .foregroundStyle(Color.gpInk)
                .padding(14)
            GhostDivider()
            TextField("", text: $cardNumber, prompt: invite("Numéro"))
                .keyboardType(.numberPad)
                .foregroundStyle(Color.gpInk)
                .padding(14)
            GhostDivider()
            HStack(spacing: 12) {
                TextField("", text: $expMonth, prompt: invite("MM")).keyboardType(.numberPad)
                TextField("", text: $expYear, prompt: invite("AAAA")).keyboardType(.numberPad)
                SecureField("", text: $cardCode, prompt: invite("Cryptogramme"))
            }
            .foregroundStyle(Color.gpInk)
            .padding(14)
        }
    }

    private func invite(_ texte: LocalizedStringKey) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }

    private var isNew: Bool { target.estNeuf }

    private var existingID: String? {
        if case .existing(let entry) = target { return entry.id }
        return nil
    }

    private func load() {
        if case .nouveauDepuisUnLien(let uri) = target {
            // Le secret d'abord : c'est la seule chose que le lien garantisse. Le nom et
            // le compte sont une commodité, et leur absence ne doit rien empêcher.
            kind = .login
            totp = uri
            let etiquette = Totp.etiquette(uri)
            name = etiquette.service ?? etiquette.compte ?? ""
            username = etiquette.compte ?? ""
            return
        }
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
            totp = login.totp ?? ""
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
                    uris: uri.isEmpty ? [] : [uri],
                    // Sans cette ligne, modifier un item effaçait sa clé TOTP en silence.
                    totp: totp.isEmpty ? nil : totp,
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
    ///
    /// L'historique est plafonné, comme sur le web. Sans plafond il grossirait sans fin,
    /// et un item chiffré qui enfle à chaque modification finit par coûter cher à
    /// transporter — pour des mots de passe que personne ne remontera jamais si loin.
    private func previousPasswords() -> [String] {
        guard case .existing(let entry) = target, let login = entry.login else { return [] }
        guard login.password != password, !login.password.isEmpty else {
            return Array(login.passwordHistory.prefix(VaultConstants.passwordHistoryLimit))
        }
        return Array(
            ([login.password] + login.passwordHistory)
                .prefix(VaultConstants.passwordHistoryLimit))
    }
}
