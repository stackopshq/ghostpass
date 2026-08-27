import SwiftUI

/// Un groupe : qui en fait partie, et ce qu'il ouvre.
///
/// C'est le seul endroit où les droits se règlent. Passer par un groupe plutôt que par des
/// accès nommés permet de retirer quelqu'un d'un coup, sans repasser sur chaque collection.
struct OrgGroupView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffrePartageOuvert
    let groupe: OrgGroupDTO
    let membres: [MembreDEquipe]
    let apres: () async -> Void

    @State private var dedans: Set<String> = []
    @State private var droits: [String: DroitSurCollection] = [:]
    @State private var aSupprimer = false

    var body: some View {
        GhostScreen {
            VStack(alignment: .leading, spacing: 16) {
                sectionMembres
                sectionCollections
                Button("Supprimer ce groupe", role: .destructive) { aSupprimer = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("button.deleteGroup")
            }
        }
        .navigationTitle(Text(verbatim: groupe.name))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            dedans = Set(groupe.members.map(\.userId))
            droits = Dictionary(
                uniqueKeysWithValues: groupe.collections.compactMap { acces in
                    DroitSurCollection(rawValue: acces.permission).map { (acces.collectionId, $0) }
                })
        }
        .alert("Supprimer ce groupe ?", isPresented: $aSupprimer) {
            Button("Annuler", role: .cancel) {}
            Button("Supprimer", role: .destructive) {
                Task {
                    if await store.supprimerLeGroupe(ouvert.organisation, groupe: groupe.id) {
                        await apres()
                        dismiss()
                    }
                }
            }
        } message: {
            Text(
                "Ses membres perdront les accès qu'il leur donnait. Les identifiants, eux, restent dans leurs collections."
            )
        }
    }

    private var sectionMembres: some View {
        GhostSection(titre: "Membres du groupe") {
            VStack(spacing: 0) {
                ForEach(membres) { membre in
                    Toggle(
                        isOn: Binding(
                            get: { dedans.contains(membre.id) },
                            set: { dedans_ in Task { await basculer(membre, dedans_) } })
                    ) {
                        Text(verbatim: membre.email ?? membre.id)
                            .foregroundStyle(Color.gpInk)
                    }
                    .tint(Color.gpAccent)
                    .padding(14)
                    if membre.id != membres.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private var sectionCollections: some View {
        GhostSection(
            titre: "Ce que le groupe ouvre",
            note: "Lecture pour consulter, écriture pour modifier, gestion pour régler les accès de la collection."
        ) {
            VStack(spacing: 0) {
                ForEach(ouvert.collections) { collection in
                    HStack {
                        Text(verbatim: collection.name).foregroundStyle(Color.gpInk)
                        Spacer()
                        Menu {
                            ForEach(DroitSurCollection.allCases) { droit in
                                Button(LocalizedStringKey(droit.intitule)) {
                                    Task { await regler(collection.id, droit) }
                                }
                            }
                            if droits[collection.id] != nil {
                                Divider()
                                Button("Retirer l'accès", role: .destructive) {
                                    Task { await retirer(collection.id) }
                                }
                            }
                        } label: {
                            Text(verbatim: droits[collection.id]?.intitule ?? tr("Aucun accès"))
                                .font(.footnote)
                                .foregroundStyle(Color.gpAccentText)
                        }
                    }
                    .padding(14)
                    if collection.id != ouvert.collections.last?.id {
                        Divider().overlay(Color.gpBorder)
                    }
                }
            }
        }
    }

    private func basculer(_ membre: MembreDEquipe, _ dedansMaintenant: Bool) async {
        let ok =
            dedansMaintenant
            ? await store.ajouterAuGroupe(
                ouvert.organisation, groupe: groupe.id, membre: membre.id)
            : await store.retirerDuGroupe(
                ouvert.organisation, groupe: groupe.id, membre: membre.id)
        // On ne coche que si le serveur a suivi : un interrupteur qui bouge sans effet ferait
        // croire à un droit accordé qui ne l'est pas.
        if ok {
            if dedansMaintenant { dedans.insert(membre.id) } else { dedans.remove(membre.id) }
            await apres()
        }
    }

    private func regler(_ collection: String, _ droit: DroitSurCollection) async {
        if await store.donnerAcces(
            ouvert.organisation, groupe: groupe.id, collection: collection, droit: droit)
        {
            droits[collection] = droit
            await apres()
        }
    }

    private func retirer(_ collection: String) async {
        if await store.retirerLAcces(
            ouvert.organisation, groupe: groupe.id, collection: collection)
        {
            droits[collection] = nil
            await apres()
        }
    }
}
