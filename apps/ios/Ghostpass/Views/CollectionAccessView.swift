import SwiftUI

/// Qui a accès à une collection, et comment le reprendre.
///
/// L'écran répond à une question que l'application posait sans y répondre : on pouvait
/// accorder un accès nommé sans jamais revoir à qui, ni le retirer.
///
/// Il montre les **trois** chemins d'accès, et c'est le point important :
///
/// - l'accès **nommé**, accordé à une personne — le seul qui se retire ici ;
/// - celui qu'un **groupe** confère — il se retire dans le groupe ;
/// - celui que le **rôle d'administrateur** donne : le serveur accorde la gestion de toute
///   collection à tout administrateur de l'équipe (`permissionFor`), sans que cela laisse
///   la moindre trace dans la liste des accès.
///
/// N'afficher que le premier laisserait croire qu'un retrait ferme la porte, alors qu'un
/// groupe peut la rouvrir aussitôt — et afficher « personne n'a accès » sur une collection
/// que chaque administrateur peut lire. Chaque ligne dit donc d'où l'accès vient.
struct CollectionAccessView: View {
    @EnvironmentObject private var store: VaultStore

    let ouvert: CoffrePartageOuvert
    let collection: OrgCollectionDTO
    let membres: [MembreDEquipe]
    let groupes: [OrgGroupDTO]
    let apres: () async -> Void

    @State private var acces: [AccesNomme] = []
    @State private var chargement = true
    @State private var aRevoquer: AccesNomme?

    var body: some View {
        GhostScreen {
            VStack(alignment: .leading, spacing: 16) {
                sectionNommes
                if !groupesQuiOuvrent.isEmpty { sectionGroupes }
                if !administrateurs.isEmpty { sectionAdministrateurs }
            }
        }
        .navigationTitle(Text(verbatim: collection.name))
        .navigationBarTitleDisplayMode(.inline)
        .task { await recharger() }
        .alert(item: $aRevoquer) { cible in
            // Le message dépend de ce qui subsiste après le retrait : promettre une porte
            // fermée quand un groupe la garde ouverte serait le pire des mensonges ici.
            Alert(
                title: Text("Retirer l'accès ?"),
                message: Text(consequenceDuRetrait(cible)),
                primaryButton: .destructive(Text("Retirer")) {
                    Task { await revoquer(cible) }
                },
                secondaryButton: .cancel(Text("Annuler")))
        }
    }

    // ─── Accès nommés ───

    private var sectionNommes: some View {
        GhostSection(
            titre: "Accès nommés",
            note: "Accordés à une personne en particulier. Ce sont les seuls qui se retirent depuis cet écran."
        ) {
            VStack(spacing: 0) {
                if chargement {
                    ProgressView().padding(14).frame(maxWidth: .infinity)
                } else if acces.isEmpty {
                    Text("Personne n'a d'accès nommé sur cette collection.")
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
                Text(verbatim: nom(ligne.id, secours: ligne.email))
                    .foregroundStyle(Color.gpInk)
                // Signalé sur la ligne, pas seulement au moment de retirer : on doit
                // pouvoir constater d'un coup d'œil que cet accès est redondant.
                if let origine = autreOrigine(ligne.id) {
                    Text(verbatim: origine)
                        .font(.caption)
                        .foregroundStyle(Color.gpMuted)
                }
            }
            Spacer()
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
                    Menu(nom(membre.id, secours: membre.email)) {
                        ForEach(DroitSurCollection.allCases) { droit in
                            Button(LocalizedStringKey(droit.intitule)) {
                                Task { await accorder(membre.id, droit) }
                            }
                        }
                    }
                }
            } label: {
                Text("Accorder à un membre")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())
            .padding(14)
            .accessibilityIdentifier("button.grantAccess")
        }
    }

    // ─── Accès hérités d'un groupe ───

    private var sectionGroupes: some View {
        GhostSection(
            titre: "Par les groupes",
            note: "Ces accès ne se retirent pas ici : ils viennent du groupe, et c'est dans le groupe qu'ils se règlent."
        ) {
            VStack(spacing: 0) {
                ForEach(groupesQuiOuvrent, id: \.groupe.id) { entree in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: entree.groupe.name).foregroundStyle(Color.gpInk)
                            Text(
                                String(
                                    format: tr("%d membre(s)"), entree.groupe.members.count)
                            )
                            .font(.caption)
                            .foregroundStyle(Color.gpMuted)
                        }
                        Spacer()
                        Text(LocalizedStringKey(entree.droit.intitule))
                            .font(.footnote)
                            .foregroundStyle(Color.gpMuted)
                    }
                    .padding(14)
                    if entree.groupe.id != groupesQuiOuvrent.last?.groupe.id {
                        Divider().overlay(Color.gpBorder)
                    }
                }
            }
        }
    }

    // ─── Accès venant du rôle ───

    private var sectionAdministrateurs: some View {
        GhostSection(
            titre: "Par leur rôle",
            note: "Un administrateur de l'équipe gère toutes les collections, y compris celle-ci. Cet accès ne se retire qu'en changeant son rôle."
        ) {
            VStack(spacing: 0) {
                ForEach(administrateurs) { membre in
                    HStack {
                        Text(verbatim: nom(membre.id, secours: membre.email))
                            .foregroundStyle(Color.gpInk)
                        Spacer()
                        Text("Administrateur")
                            .font(.footnote)
                            .foregroundStyle(Color.gpMuted)
                    }
                    .padding(14)
                    if membre.id != administrateurs.last?.id {
                        Divider().overlay(Color.gpBorder)
                    }
                }
            }
        }
    }

    // ─── Ce que le serveur dit, mis en français ───

    private var administrateurs: [MembreDEquipe] {
        membres.filter { $0.role == .admin && $0.etat == .active }
    }

    private var groupesQuiOuvrent: [(groupe: OrgGroupDTO, droit: DroitSurCollection)] {
        groupes.compactMap { groupe in
            guard
                let acces = groupe.collections.first(where: { $0.collectionId == collection.id }),
                let droit = DroitSurCollection(rawValue: acces.permission)
            else { return nil }
            return (groupe, droit)
        }
    }

    /// D'où cette personne tiendrait encore la collection si on retirait son accès nommé.
    /// Affiché sur la ligne, pas seulement au moment de retirer : on doit pouvoir constater
    /// d'un coup d'œil qu'un accès fait doublon.
    private func autreOrigine(_ membre: String) -> String? {
        if administrateurs.contains(where: { $0.id == membre }) {
            return tr("Également par son rôle d'administrateur")
        }
        if let groupe = groupeQuiDonneAussi(membre) {
            return String(format: tr("Également par le groupe « %@ »"), groupe.name)
        }
        return nil
    }

    /// Le premier groupe qui donne aussi la collection à cette personne, s'il y en a un.
    private func groupeQuiDonneAussi(_ membre: String) -> OrgGroupDTO? {
        groupesQuiOuvrent.first { $0.groupe.members.contains { $0.userId == membre } }?.groupe
    }

    private func nom(_ identifiant: String, secours: String?) -> String {
        secours ?? membres.first { $0.id == identifiant }?.email ?? identifiant
    }

    private func consequenceDuRetrait(_ cible: AccesNomme) -> String {
        if administrateurs.contains(where: { $0.id == cible.id }) {
            return tr(
                "Cette personne gardera l'accès : elle administre l'équipe, ce qui lui donne la gestion de toutes les collections."
            )
        }
        if let groupe = groupeQuiDonneAussi(cible.id) {
            return String(
                format: tr(
                    "Cette personne gardera l'accès : le groupe « %@ » le lui donne aussi. Pour le lui retirer entièrement, sortez-la de ce groupe."
                ), groupe.name)
        }
        return tr("Cette personne perdra l'accès à cette collection.")
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
