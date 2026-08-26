import SwiftUI

/// La santé du coffre : ce qui est faible, ce qui est réutilisé, ce qui a fuité.
///
/// Les deux premières listes se calculent sur l'appareil, sans rien demander à personne.
/// La troisième interroge Have I Been Pwned, et c'est la seule chose de cette application
/// qui parle à un tiers : elle ne part donc qu'à la demande, sur un bouton, jamais toute
/// seule au chargement de l'écran.
struct HealthView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    var onOuvrir: (VaultEntry) -> Void

    @State private var verification = Verification.pasEncore
    @State private var compromis: [VaultEntry] = []

    private enum Verification {
        case pasEncore
        case enCours
        case faite
        case echouee
    }

    private var bilan: PasswordHealth.Bilan { PasswordHealth.bilan(store.entries) }

    var body: some View {
        NavigationStack {
            GhostScreen {
                let bilan = bilan
                resume(bilan)

                if !bilan.faibles.isEmpty {
                    section(
                        "Mots de passe faibles",
                        note: "Trop courts, ou faits d'une seule sorte de caractères.",
                        bilan.faibles, "exclamationmark.shield")
                }
                if !bilan.reutilises.isEmpty {
                    section(
                        "Mots de passe réutilisés",
                        note: "Une seule fuite suffit alors à ouvrir plusieurs comptes.",
                        bilan.reutilises, "arrow.triangle.2.circlepath")
                }
                fuites
                if !bilan.sansCode.isEmpty {
                    section(
                        "Sans code à usage unique",
                        note: "Le second facteur protège même un mot de passe connu.",
                        bilan.sansCode, "number")
                }
            }
            .navigationTitle("Santé du coffre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeHealth")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    /// Un état d'ensemble en tête : sans cela, un coffre sain n'afficherait qu'une page
    /// vide, qu'on prendrait pour un écran qui n'a pas fini de charger.
    private func resume(_ bilan: PasswordHealth.Bilan) -> some View {
        let sain = bilan.estSain
        return HStack(spacing: 14) {
            Image(systemName: sain ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(sain ? Color.gpSuccess : Color.gpDanger)
                .frame(width: 52, height: 52)
                .background(
                    (sain ? Color.gpSuccess : Color.gpDanger).opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Group {
                    if sain {
                        Text("Rien à signaler")
                    } else {
                        Text(
                            "\(bilan.faibles.count + bilan.reutilises.count) mots de passe à revoir"
                        )
                    }
                }
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(Color.gpInk)
                Text("\(store.entries.count) éléments examinés")
                    .font(.caption)
                    .foregroundStyle(Color.gpMuted)
            }
            Spacer(minLength: 0)
        }
        .glassCard()
        // Sans cette combinaison, la carte n'est pas un élément d'accessibilité à elle
        // seule : son identifiant ne désigne rien, et un test qui la cherche ne trouve
        // que le titre de l'écran — il croirait vérifier le résumé sans l'avoir vu.
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("card.healthSummary")
    }

    @ViewBuilder
    private var fuites: some View {
        GhostSection(
            titre: "Fuites connues",
            note: "Seuls les cinq premiers caractères de l'empreinte du mot de passe sont envoyés : ni le mot de passe ni son empreinte complète ne quittent l'appareil."
        ) {
            switch verification {
            case .pasEncore, .echouee:
                VStack(alignment: .leading, spacing: 10) {
                    if case .echouee = verification {
                        Label {
                            Text("Le service de vérification n'a pas répondu.")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .font(.footnote)
                        .foregroundStyle(Color.gpDanger)
                    }
                    Button("Vérifier les fuites") { Task { await verifier() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("button.checkBreaches")
                }
                .padding(14)

            case .enCours:
                HStack(spacing: 10) {
                    ProgressView().tint(Color.gpAccentText)
                    Text("Vérification…").foregroundStyle(Color.gpMuted)
                }
                .padding(14)

            case .faite where compromis.isEmpty:
                Label {
                    Text("Aucun mot de passe connu des fuites publiques.")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpSuccess)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .accessibilityIdentifier("text.noBreach")

            case .faite:
                ForEach(Array(compromis.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { GhostDivider() }
                    ligne(entry, "flame")
                }
            }
        }
    }

    private func section(
        _ titre: LocalizedStringKey, note: LocalizedStringKey, _ entries: [VaultEntry],
        _ icone: String
    ) -> some View {
        GhostSection(titre: titre, note: note) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                if index > 0 { GhostDivider() }
                ligne(entry, icone)
            }
        }
    }

    private func ligne(_ entry: VaultEntry, _ icone: String) -> some View {
        Button {
            // On désigne l'élément, puis on se referme : c'est l'écran du coffre qui
            // poussera le détail une fois la feuille partie.
            onOuvrir(entry)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icone)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.gpDanger)
                    .frame(width: 30, height: 30)
                    .background(Color.gpDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: entry.item.name)
                        .foregroundStyle(Color.gpInk)
                    if let login = entry.login, !login.username.isEmpty {
                        Text(verbatim: login.username)
                            .font(.caption)
                            .foregroundStyle(Color.gpMuted)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.gpMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Un appel par mot de passe *distinct* : deux comptes qui partagent le même mot de
    /// passe ne valent qu'une requête, et le service n'apprend rien de plus.
    private func verifier() async {
        verification = .enCours
        let motsDePasse = Set(
            store.entries.compactMap { $0.login?.password }.filter { !$0.isEmpty })
        var comptes: [String: Int] = [:]
        do {
            for mot in motsDePasse {
                comptes[mot] = try await Breach.pwnedCount(mot)
            }
        } catch {
            verification = .echouee
            return
        }
        compromis = store.entries.filter { entry in
            guard let mot = entry.login?.password else { return false }
            return (comptes[mot] ?? 0) > 0
        }
        verification = .faite
    }
}
