import SwiftUI

/// Le détail d'un élément du coffre.
struct ItemDetailView: View {
    let entry: VaultEntry
    var onEdit: () -> Void

    @EnvironmentObject private var store: VaultStore
    @State private var revealed = false
    @State private var copie: String?

    /// L'entrée telle qu'elle est *maintenant* dans le coffre. Sans cela, l'écran garderait
    /// la copie reçue à la navigation et continuerait d'afficher l'ancien contenu après une
    /// modification — l'utilisateur croirait son enregistrement perdu.
    private var live: VaultEntry { store.entries.first { $0.id == entry.id } ?? entry }

    var body: some View {
        GhostScreen {
            switch live.item.data {
            case .login(let login): contenuIdentifiant(login)
            case .secureNote(let note): contenuNote(note)
            case .card(let card): contenuCarte(card)
            }

            if let notes = live.item.notes, !notes.isEmpty {
                GhostSection(titre: "Notes") {
                    Text(notes)
                        .foregroundStyle(Color.gpInk)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }
            if let folder = live.item.folder, !folder.isEmpty {
                GhostSection(titre: "Dossier") {
                    Label(folder, systemImage: "folder")
                        .foregroundStyle(Color.gpMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }
        }
        .navigationTitle(live.item.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("Modifier", action: onEdit)
                .foregroundStyle(Color.gpAccentText)
                .accessibilityIdentifier("button.edit")
        }
        .overlay(alignment: .bottom) { confirmationDeCopie }
        .animation(.snappy, value: copie)
    }

    @ViewBuilder
    private func contenuIdentifiant(_ login: Login) -> some View {
        GhostSection(titre: "Identifiants") {
            GhostRow(intitule: "Nom d'utilisateur", valeur: login.username) {
                GhostIconButton(systemImage: "doc.on.doc") {
                    copier(login.username, "Nom d'utilisateur copié")
                }
            }
            GhostDivider()
            GhostRow(
                intitule: "Mot de passe",
                valeur: revealed ? login.password : String(repeating: "•", count: max(login.password.count, 8)),
                monospace: true, estSecret: !revealed
            ) {
                GhostIconButton(systemImage: revealed ? "eye.slash" : "eye") {
                    revealed.toggle()
                }
                .accessibilityIdentifier("button.reveal")
                GhostIconButton(systemImage: "doc.on.doc") {
                    copier(login.password, "Mot de passe copié")
                }
            }
        }

        if let config = login.totp.flatMap(Totp.parse) {
            GhostSection(titre: "Code à usage unique", note: "Renouvelé toutes les \(config.period) secondes.") {
                // `TimelineView` réévalue chaque seconde : pas de minuterie à démarrer ni
                // à arrêter, et rien ne continue de tourner une fois l'écran quitté.
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let otp = Totp.code(for: config, at: context.date) {
                        HStack(spacing: 14) {
                            Text(otp.code)
                                .font(.system(.title2, design: .monospaced, weight: .semibold))
                                .foregroundStyle(Color.gpInk)
                                .accessibilityIdentifier("text.totp")
                            Spacer()
                            compteARebours(otp.remaining, sur: config.period)
                            GhostIconButton(systemImage: "doc.on.doc") {
                                copier(otp.code, "Code copié")
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    } else {
                        Text("Clé de vérification illisible.")
                            .foregroundStyle(Color.gpMuted)
                            .padding(14)
                    }
                }
            }
        }

        if !login.uris.isEmpty {
            GhostSection(titre: "Adresses") {
                ForEach(Array(login.uris.enumerated()), id: \.offset) { index, uri in
                    if index > 0 { GhostDivider() }
                    HStack {
                        Text(uri)
                            .font(.callout)
                            .foregroundStyle(Color.gpInk)
                            .textSelection(.enabled)
                        Spacer(minLength: 8)
                        GhostIconButton(systemImage: "doc.on.doc") { copier(uri, "Adresse copiée") }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }
        }
    }

    @ViewBuilder
    private func contenuNote(_ note: SecureNote) -> some View {
        GhostSection(titre: "Note") {
            Text(note.content)
                .foregroundStyle(Color.gpInk)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
        }
    }

    @ViewBuilder
    private func contenuCarte(_ card: Card) -> some View {
        GhostSection(titre: "Carte") {
            GhostRow(intitule: "Titulaire", valeur: card.cardholder) {
                GhostIconButton(systemImage: "doc.on.doc") { copier(card.cardholder, "Titulaire copié") }
            }
            GhostDivider()
            GhostRow(
                intitule: "Numéro",
                valeur: revealed ? card.number : String(repeating: "•", count: max(card.number.count, 8)),
                monospace: true, estSecret: !revealed
            ) {
                GhostIconButton(systemImage: revealed ? "eye.slash" : "eye") { revealed.toggle() }
                    .accessibilityIdentifier("button.reveal")
                GhostIconButton(systemImage: "doc.on.doc") { copier(card.number, "Numéro copié") }
            }
            GhostDivider()
            GhostRow(intitule: "Expiration", valeur: "\(card.expMonth)/\(card.expYear)") {}
        }
    }

    /// Le temps qu'il reste au code, lisible d'un coup d'œil : un anneau qui se vide, et
    /// qui vire au rouge quand il ne faut plus compter dessus.
    private func compteARebours(_ restant: Int, sur periode: Int) -> some View {
        let fraction = Double(restant) / Double(max(periode, 1))
        let urgent = restant <= 5
        return HStack(spacing: 6) {
            ZStack {
                Circle().stroke(Color.gpBorderStrong, lineWidth: 2.5)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(
                        urgent ? Color.gpDanger : Color.gpAccentText,
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 18, height: 18)
            Text("\(restant) s")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(urgent ? Color.gpDanger : Color.gpMuted)
        }
    }

    /// Une copie ne dit rien d'elle-même : sans retour, on ne sait pas si elle a eu lieu.
    @ViewBuilder
    private var confirmationDeCopie: some View {
        if let copie {
            Label(copie, systemImage: "checkmark.circle.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Color.gpInk)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.gpBorder, lineWidth: 1))
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func copier(_ valeur: String, _ message: String) {
        Clipboard.copy(valeur)
        copie = "\(message) — effacé dans \(Int(Clipboard.lifetime)) s"
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            copie = nil
        }
    }
}
