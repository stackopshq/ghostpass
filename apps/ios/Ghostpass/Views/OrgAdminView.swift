import SwiftUI

/// L'administration d'une équipe : membres, collections, groupes.
///
/// Réservé aux administrateurs — le serveur le vérifie de toute façon, mais proposer un
/// geste qu'il refusera est une promesse non tenue.
struct OrgAdminView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffrePartageOuvert
    /// Rejoué après toute opération qui change ce que le coffre contient — les collections
    /// sont capturées à l'ouverture, une nouvelle ne s'y ajoute pas toute seule.
    let apres: () async -> Void

    @State private var membres: [MembreDEquipe] = []
    @State private var groupes: [OrgGroupDTO] = []
    @State private var chargement = true
    @State private var invitation = false
    @State private var nouvelleCollection = false
    @State private var nouveauGroupe = false
    @State private var aRevoquer: MembreDEquipe?
    @State private var saisie = ""

    var body: some View {
        NavigationStack {
            GhostScreen {
                if chargement {
                    ProgressView().tint(Color.gpAccentText)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        sectionMembres
                        sectionCollections
                        sectionGroupes
                    }
                }
            }
            .navigationTitle("Administration")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Terminé") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeOrgAdmin")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task { await recharger() }
        .sheet(isPresented: $invitation) {
            OrgInviteView(ouvert: ouvert) { await recharger() }
                .environmentObject(store)
        }
        .alert("Nouvelle collection", isPresented: $nouvelleCollection) {
            TextField("Nom", text: $saisie)
            Button("Annuler", role: .cancel) { saisie = "" }
            Button("Créer") {
                let nom = saisie
                saisie = ""
                Task {
                    if await store.creerUneCollection(ouvert, nom: nom) { await apres() }
                }
            }
        }
        .alert("Nouveau groupe", isPresented: $nouveauGroupe) {
            TextField("Nom", text: $saisie)
            Button("Annuler", role: .cancel) { saisie = "" }
            Button("Créer") {
                let nom = saisie
                saisie = ""
                Task {
                    if await store.creerUnGroupe(ouvert.organisation, nom: nom) {
                        await recharger()
                    }
                }
            }
        }
        .alert(
            "Révoquer ce membre ?",
            isPresented: Binding(
                get: { aRevoquer != nil }, set: { if !$0 { aRevoquer = nil } })
        ) {
            Button("Annuler", role: .cancel) { aRevoquer = nil }
            Button("Révoquer", role: .destructive) {
                if let cible = aRevoquer { Task { await revoquer(cible) } }
            }
        } message: {
            Text(
                "La clé de l'équipe sera changée et redistribuée aux autres membres. Ce que cette personne a déjà vu reste connu d'elle : les mots de passe concernés doivent être changés."
            )
        }
    }

    // ─── Membres ───

    private var sectionMembres: some View {
        GhostSection(
            titre: "Membres",
            note: "Inviter quelqu'un lui scelle la clé de l'équipe vers sa clé publique. Le serveur ne transporte qu'un blob qu'il ne peut pas ouvrir."
        ) {
            VStack(spacing: 0) {
                ForEach(membres) { membre in
                    ligneMembre(membre)
                    Divider().overlay(Color.gpBorder)
                }
                Button("Inviter quelqu'un") { invitation = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(14)
                    .accessibilityIdentifier("button.inviteMember")
            }
        }
    }

    private func ligneMembre(_ membre: MembreDEquipe) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: membre.email ?? membre.id)
                    .foregroundStyle(Color.gpInk)
                Text(verbatim: "\(membre.role.intitule) · \(membre.etat.intitule)")
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
            }
            Spacer()
            Menu {
                ForEach([RoleDOrganisation.admin, .member, .readonly], id: \.rawValue) { role in
                    Button(LocalizedStringKey(role.intitule)) {
                        Task {
                            if await store.changerLeRole(
                                ouvert.organisation, membre: membre.id, role: role)
                            {
                                await recharger()
                            }
                        }
                    }
                }
                Divider()
                Button("Révoquer", role: .destructive) { aRevoquer = membre }
            } label: {
                Image(systemName: "ellipsis.circle").foregroundStyle(Color.gpAccentText)
            }
            .accessibilityLabel("Modifier ce membre")
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    private func revoquer(_ membre: MembreDEquipe) async {
        let restants = membres.filter { $0.id != membre.id }
        let ok = await store.revoquerEtFaireTourner(
            ouvert, revoquer: membre.id, restants: restants)
        aRevoquer = nil
        if ok {
            await recharger()
            // La clé de l'équipe a changé : le coffre ouvert tient encore l'ancienne, et
            // tout ce qu'il afficherait désormais serait illisible. On referme.
            await apres()
            dismiss()
        }
    }

    // ─── Collections ───

    private var sectionCollections: some View {
        GhostSection(titre: "Collections") {
            VStack(spacing: 0) {
                if ouvert.collections.isEmpty {
                    Text("Aucune collection.")
                        .foregroundStyle(Color.gpMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                } else {
                    ForEach(ouvert.collections) { collection in
                        Text(verbatim: collection.name)
                            .foregroundStyle(Color.gpInk)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                        Divider().overlay(Color.gpBorder)
                    }
                }
                Button("Nouvelle collection") { nouvelleCollection = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(14)
                    .accessibilityIdentifier("button.newCollection")
            }
        }
    }

    // ─── Groupes ───

    private var sectionGroupes: some View {
        GhostSection(
            titre: "Groupes",
            note: "Un groupe donne accès à des collections. C'est par lui qu'on ouvre un coffre à plusieurs personnes sans les nommer une à une."
        ) {
            VStack(spacing: 0) {
                ForEach(groupes) { groupe in
                    ligneGroupe(groupe)
                    Divider().overlay(Color.gpBorder)
                }
                Button("Nouveau groupe") { nouveauGroupe = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(14)
                    .accessibilityIdentifier("button.newGroup")
            }
        }
    }

    private func ligneGroupe(_ groupe: OrgGroupDTO) -> some View {
        NavigationLink {
            OrgGroupView(ouvert: ouvert, groupe: groupe, membres: membres) {
                await recharger()
            }
            .environmentObject(store)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: groupe.name).foregroundStyle(Color.gpInk)
                    Text(
                        verbatim: String(
                            format: tr("%1$d membres · %2$d collections"),
                            groupe.members.count, groupe.collections.count)
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Color.gpMuted)
            }
            .padding(14)
        }
    }

    private func recharger() async {
        membres = await store.membres(ouvert.organisation)
        groupes = await store.groupes(ouvert.organisation)
        chargement = false
    }
}
