import SwiftUI

/// Qui a accès à une collection, et comment le reprendre.
///
/// L'écran répond à une question que l'application posait sans y répondre : on pouvait
/// accorder un accès nommé sans jamais revoir à qui, ni le retirer.
///
/// Il montre l'accès **effectif**, tel que le serveur le calcule — rôle d'administrateur,
/// octroi direct et appartenance à un groupe additionnés, le maximum retenu. Chaque ligne
/// dit d'où l'accès vient.
///
/// Cette vue recomposait d'abord ces trois sources de son côté, faute que la route ne
/// rende que les octrois directs. Elle ne le fait plus : le serveur seul connaît les
/// groupes de chacun, et deux calculs concurrents auraient fini par diverger. Le bouton de
/// retrait, en particulier, ne s'affiche que sur ce que le serveur déclare révocable — un
/// rôle se change, une appartenance à un groupe se retire dans le groupe.
struct CollectionAccessView: View {
    @EnvironmentObject private var store: VaultStore

    let ouvert: CoffrePartageOuvert
    let collection: OrgCollectionDTO
    let membres: [MembreDEquipe]
    let apres: () async -> Void

    @State private var acces: [AccesNomme] = []
    @State private var chargement = true
    @State private var aRevoquer: AccesNomme?

    var body: some View {
        GhostScreen {
            VStack(alignment: .leading, spacing: 16) {
                sectionAcces
            }
        }
        .navigationTitle(Text(verbatim: collection.name))
        .navigationBarTitleDisplayMode(.inline)
        .task { await recharger() }
        .alert(item: $aRevoquer) { cible in
            Alert(
                title: Text("Retirer l'accès ?"),
                message: Text("Cette personne perdra l'accès qu'un octroi direct lui donnait."),
                primaryButton: .destructive(Text("Retirer")) {
                    Task { await revoquer(cible) }
                },
                secondaryButton: .cancel(Text("Annuler")))
        }
    }

    private var sectionAcces: some View {
        GhostSection(
            titre: "Qui a accès",
            note:
                "L'accès effectif : rôle, octroi direct et groupes réunis. Seul un octroi direct se retire ici."
        ) {
            VStack(spacing: 0) {
                if chargement {
                    ProgressView().padding(14).frame(maxWidth: .infinity)
                } else if acces.isEmpty {
                    Text("Personne n'a accès à cette collection.")
                        .foregroundStyle(Color.gpMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                } else {
                    ForEach(acces) { ligne in
                        ligneDAcces(ligne)
                        Divider().overlay(Color.gpBorder)
                    }
                }
                menuDOctroi
            }
        }
    }

    private func ligneDAcces(_ ligne: AccesNomme) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: ligne.email ?? ligne.id)
                    .foregroundStyle(Color.gpInk)
                // Les origines viennent du serveur, en clair : « administratrice de
                // l'organisation », « groupe Ops ». Les afficher évite de croire qu'un
                // retrait fermera une porte que le rôle ou un groupe garde ouverte.
                if !ligne.origines.isEmpty {
                    Text(verbatim: ligne.origines.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                }
            }
            Spacer()
            if ligne.revocable {
                Menu {
                    ForEach(DroitSurCollection.allCases) { droit in
                        Button(LocalizedStringKey(droit.intitule)) {
                            Task { await accorder(ligne.id, droit) }
                        }
                    }
                    Divider()
                    Button("Retirer l'accès", role: .destructive) { aRevoquer = ligne }
                } label: {
                    Text(LocalizedStringKey(ligne.droit.intitule))
                        .font(.footnote)
                        .foregroundStyle(Color.gpAccentText)
                }
                .accessibilityIdentifier("menu.access.\(ligne.id)")
            } else {
                // Rien à proposer : ce droit ne vient pas d'ici. Un menu grisé ferait
                // croire à une action momentanément indisponible.
                Text(LocalizedStringKey(ligne.droit.intitule))
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
            }
        }
        .padding(14)
    }

    @ViewBuilder
    private var menuDOctroi: some View {
        let candidats = membres.filter { m in !acces.contains { $0.id == m.id } }
        if candidats.isEmpty {
            EmptyView()
        } else {
            Menu {
                ForEach(candidats) { membre in
                    Menu(membre.email ?? membre.id) {
                        ForEach(DroitSurCollection.allCases) { droit in
                            Button(LocalizedStringKey(droit.intitule)) {
                                Task { await accorder(membre.id, droit) }
                            }
                        }
                    }
                }
            } label: {
                Text("Accorder à un membre").frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())
            .padding(14)
            .accessibilityIdentifier("button.grantAccess")
        }
    }

    // ─── Actions ───

    private func recharger() async {
        chargement = true
        acces = await store.accesDeLaCollection(ouvert.organisation, collection: collection.id)
        chargement = false
    }

    private func accorder(_ membre: String, _ droit: DroitSurCollection) async {
        if await store.accorderLAccesNomme(
            ouvert.organisation, collection: collection.id, membre: membre, droit: droit)
        {
            await recharger()
            await apres()
        }
    }

    private func revoquer(_ cible: AccesNomme) async {
        if await store.revoquerLAccesNomme(
            ouvert.organisation, collection: collection.id, membre: cible.id)
        {
            await recharger()
            await apres()
        }
    }
}
