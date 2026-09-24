import SwiftUI

/// Le journal du compte : connexions et actions sensibles.
///
/// C'est le seul écran où l'on peut s'apercevoir qu'un accès n'était pas le sien. Il est
/// donc construit pour être parcouru vite : les appareils inconnus et les actions qui
/// retirent une protection sont signalés, le reste s'efface.
struct ActivityView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var connexions: [Connexion] = []
    @State private var actions: [ActionDuJournal] = []
    @State private var chargement = true

    var body: some View {
        NavigationStack {
            GhostScreen {
                if chargement {
                    ProgressView().tint(Color.gpAccentText)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        sectionActions
                        sectionConnexions
                    }
                }
            }
            .navigationTitle("Journal du compte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Terminé") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeActivity")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task {
            connexions = await store.connexions()
            actions = await store.actionsDuJournal()
            chargement = false
        }
    }

    private var sectionActions: some View {
        GhostSection(
            titre: "Actions sensibles",
            note:
                "Ce qui retire une protection ou ouvre le coffre à quelqu'un d'autre. Une ligne que vous ne reconnaissez pas mérite de changer votre mot de passe maître."
        ) {
            if actions.isEmpty {
                Text("Aucune action enregistrée.")
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else {
                ForEach(actions) { action in
                    ligneAction(action)
                    if action.id != actions.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private func ligneAction(_ action: ActionDuJournal) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: action.estSensible ? "exclamationmark.triangle.fill" : "circle.fill")
                .font(.system(size: action.estSensible ? 13 : 6))
                .foregroundStyle(action.estSensible ? Color.gpDanger : Color.gpMuted)
                .frame(width: 16, alignment: .center)
                .padding(.top, action.estSensible ? 2 : 7)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: action.intitule)
                    .foregroundStyle(action.estSensible ? Color.gpInk : Color.gpMuted)
                Text(verbatim: detail(action.quand, action.ip, action.cible))
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    private var sectionConnexions: some View {
        GhostSection(
            titre: "Connexions",
            note:
                "Un appareil inconnu signalé ici, que vous ne reconnaissez pas, veut dire que quelqu'un connaît votre mot de passe maître."
        ) {
            if connexions.isEmpty {
                Text("Aucune connexion enregistrée.")
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else {
                ForEach(connexions) { connexion in
                    ligneConnexion(connexion)
                    if connexion.id != connexions.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private func ligneConnexion(_ connexion: Connexion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(verbatim: connexion.quand.formatted(date: .abbreviated, time: .shortened))
                    .foregroundStyle(Color.gpInk)
                if connexion.nouvelAppareil {
                    Text("Nouvel appareil")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.gpOnAccent)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.gpDanger, in: Capsule())
                }
            }
            if let appareil = connexion.appareil, !appareil.isEmpty {
                Text(verbatim: appareil)
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let ip = connexion.ip, !ip.isEmpty {
                Text(verbatim: ip)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.gpMuted)
            }
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    /// La date, puis l'adresse et la cible si elles apportent quelque chose.
    private func detail(_ quand: Date, _ ip: String?, _ cible: String?) -> String {
        var morceaux = [quand.formatted(date: .abbreviated, time: .shortened)]
        if let cible, !cible.isEmpty { morceaux.append(cible) }
        if let ip, !ip.isEmpty { morceaux.append(ip) }
        return morceaux.joined(separator: " · ")
    }
}
