import SwiftUI

/// Le détail d'un élément du coffre.
struct ItemDetailView: View {
    let entry: VaultEntry
    var onEdit: () -> Void = {}
    /// Coffre d'un tiers, ouvert par accès d'urgence : on regarde, on ne touche pas. Sans
    /// cela, le bouton favori écrirait dans *notre* coffre pour l'identifiant d'un autre.
    var lectureSeule = false

    @EnvironmentObject private var store: VaultStore
    @State private var revealed = false
    /// L'historique est replié par défaut : ce sont des mots de passe périmés, on ne les
    /// consulte qu'en cas de besoin, et les déployer d'office allongerait l'écran pour rien.
    @State private var historiqueDeploye = false
    /// Les anciens mots de passe dévoilés, par rang. Un par un : les afficher tous d'un
    /// coup exposerait sans nécessité tout ce que l'élément a jamais protégé.
    @State private var anciensDevoiles: Set<Int> = []
    /// Le libellé de la dernière copie — une clef de traduction, pas un texte tout fait :
    /// il s'affiche, donc il se traduit.
    @State private var copie: LocalizedStringKey?

    /// L'entrée telle qu'elle est *maintenant* dans le coffre. Sans cela, l'écran garderait
    /// la copie reçue à la navigation et continuerait d'afficher l'ancien contenu après une
    /// modification — l'utilisateur croirait son enregistrement perdu.
    private var live: VaultEntry {
        guard !lectureSeule else { return entry }
        return store.entries.first { $0.id == entry.id } ?? entry
    }

    var body: some View {
        GhostScreen {
            switch live.item.data {
            case .login(let login): contenuIdentifiant(login)
            case .secureNote(let note): contenuNote(note)
            case .card(let card): contenuCarte(card)
            }

            if let notes = live.item.notes, !notes.isEmpty {
                GhostSection(titre: "Notes") {
                    Text(verbatim: notes)
                        .foregroundStyle(Color.gpInk)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }
            if let folder = live.item.folder, !folder.isEmpty {
                GhostSection(titre: "Dossier") {
                    // Le nom du dossier est celui qu'a choisi l'utilisateur : il se
                    // montre tel quel, sans passer par le catalogue.
                    Label {
                        Text(verbatim: folder)
                    } icon: {
                        Image(systemName: "folder")
                    }
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                }
            }
        }
        .navigationTitle(Text(verbatim: live.item.name))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !lectureSeule {
                Button {
                    Task { await store.toggleFavorite(live) }
                } label: {
                    Image(systemName: store.isFavorite(live) ? "star.fill" : "star")
                }
                .foregroundStyle(Color.gpAccentText)
                .accessibilityLabel(
                    store.isFavorite(live) ? "Retirer des favoris" : "Mettre en favori"
                )
                .accessibilityIdentifier("button.favorite")

                Button("Modifier", action: onEdit)
                    .foregroundStyle(Color.gpAccentText)
                    .accessibilityIdentifier("button.edit")
            }
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
                valeur: revealed
                    ? login.password : String(repeating: "•", count: max(login.password.count, 8)),
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
            if !login.password.isEmpty {
                GhostDivider()
                force(login.password)
            }
        }

        if !login.passwordHistory.isEmpty {
            historique(login.passwordHistory)
        }

        if let config = login.totp.flatMap(Totp.parse) {
            GhostSection(
                titre: "Code à usage unique",
                note: "Renouvelé toutes les \(config.period) secondes."
            ) {
                // `TimelineView` réévalue chaque seconde : pas de minuterie à démarrer ni
                // à arrêter, et rien ne continue de tourner une fois l'écran quitté.
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let otp = Totp.code(for: config, at: context.date) {
                        HStack(spacing: 14) {
                            Text(verbatim: otp.code)
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
                        Text(verbatim: uri)
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
            Text(verbatim: note.content)
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
                GhostIconButton(systemImage: "doc.on.doc") {
                    copier(card.cardholder, "Titulaire copié")
                }
            }
            GhostDivider()
            GhostRow(
                intitule: "Numéro",
                valeur: revealed
                    ? card.number : String(repeating: "•", count: max(card.number.count, 8)),
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

    /// Les mots de passe qu'on a remplacés. Ils servent le jour où un changement a échoué
    /// à mi-chemin — le service a gardé l'ancien, l'application le nouveau — et ce jour-là,
    /// les avoir gardés fait la différence entre récupérer un compte et le perdre.
    private func historique(_ anciens: [String]) -> some View {
        GhostSection {
            Button {
                historiqueDeploye.toggle()
                if !historiqueDeploye { anciensDevoiles = [] }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.gpMuted)
                    Text("Anciens mots de passe (\(anciens.count))")
                        .font(.subheadline)
                        .foregroundStyle(Color.gpInk)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.gpMuted)
                        .rotationEffect(.degrees(historiqueDeploye ? 90 : 0))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("button.history")

            if historiqueDeploye {
                ForEach(Array(anciens.enumerated()), id: \.offset) { rang, ancien in
                    GhostDivider()
                    let devoile = anciensDevoiles.contains(rang)
                    GhostRow(
                        intitule: "Remplacé",
                        valeur: devoile
                            ? ancien : String(repeating: "•", count: max(ancien.count, 8)),
                        monospace: true, estSecret: !devoile
                    ) {
                        GhostIconButton(systemImage: devoile ? "eye.slash" : "eye") {
                            if devoile {
                                anciensDevoiles.remove(rang)
                            } else {
                                anciensDevoiles.insert(rang)
                            }
                        }
                        GhostIconButton(systemImage: "doc.on.doc") {
                            copier(ancien, "Ancien mot de passe copié")
                        }
                    }
                }
            }
        }
        .animation(.snappy, value: historiqueDeploye)
    }

    /// La force du mot de passe, au même barème que la web app : une jauge et un mot.
    /// Le dire ici évite d'avoir à ouvrir l'écran de santé pour le savoir.
    private func force(_ motDePasse: String) -> some View {
        let force = PasswordHealth.force(motDePasse)
        return HStack(spacing: 10) {
            Text("Force").font(.caption).foregroundStyle(Color.gpMuted)
            Spacer(minLength: 8)
            HStack(spacing: 3) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(index < force.niveau ? force.couleur : Color.gpBorderStrong)
                        .frame(width: 18, height: 4)
                }
            }
            Text(force.libelle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(force.couleur)
                .accessibilityIdentifier("text.strength")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
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
            Label {
                // Le délai s'ajoute au message plutôt que d'y être interpolé : deux clefs
                // de traduction se composent, une clef ne s'insère pas dans une autre.
                Text(copie) + Text(" — effacé dans \(Int(Clipboard.lifetime)) s")
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
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

    private func copier(_ valeur: String, _ message: LocalizedStringKey) {
        Clipboard.copy(valeur)
        copie = message
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            copie = nil
        }
    }
}
