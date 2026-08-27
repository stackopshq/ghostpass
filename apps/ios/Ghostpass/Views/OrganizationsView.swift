import SwiftUI

/// Les coffres partagés d'une équipe.
///
/// Un coffre d'organisation ne se déchiffre pas avec la clé du compte mais avec une Org Key,
/// que l'administrateur a scellée vers notre clé publique. L'ouvrir, c'est la faire ouvrir
/// par le cœur Rust **en vérifiant qu'elle vient bien de lui** — sans quoi un serveur actif
/// pourrait en glisser une autre et lire tout ce qu'on y écrirait ensuite.
struct OrganizationsView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var organisations: [Organisation] = []
    @State private var chargement = true
    @State private var ouvert: CoffrePartageOuvert?
    @State private var creation = false
    @State private var nom = ""

    var body: some View {
        NavigationStack {
            GhostScreen {
                if chargement {
                    ProgressView().tint(Color.gpAccentText)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else if organisations.isEmpty {
                    vide
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        if !invitations.isEmpty {
                            GhostSection(
                                titre: "Invitations",
                                note: "Accepter vous donnera accès aux coffres que l'équipe partage avec vous."
                            ) {
                                lignes(invitations)
                            }
                        }
                        if !actives.isEmpty {
                            GhostSection(titre: "Mes équipes") { lignes(actives) }
                        }
                        if !revoquees.isEmpty {
                            GhostSection(
                                titre: "Accès révoqués",
                                note: "Ces coffres ne s'ouvrent plus. Après une rotation de clé, ce que vous en aviez vu reste connu de vous — les mots de passe concernés doivent être changés par l'équipe."
                            ) {
                                lignes(revoquees)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Coffres partagés")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Terminé") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeOrgs")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        creation = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityIdentifier("button.newOrg")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task { await recharger() }
        .sheet(item: $ouvert) { coffre in
            OrgVaultView(ouvert: coffre).environmentObject(store)
        }
        .alert("Nouvelle équipe", isPresented: $creation) {
            TextField("Nom de l'équipe", text: $nom)
            Button("Annuler", role: .cancel) { nom = "" }
            Button("Créer") {
                let choisi = nom
                nom = ""
                Task {
                    if await store.creerUneOrganisation(nom: choisi) { await recharger() }
                }
            }
        } message: {
            Text(
                "La clé du coffre est créée sur cet appareil et scellée pour vous seul. Le serveur n'en connaîtra jamais le contenu."
            )
        }
    }

    private var invitations: [Organisation] { organisations.filter { $0.etat == .invited } }
    private var actives: [Organisation] { organisations.filter { $0.etat == .active } }
    private var revoquees: [Organisation] { organisations.filter { $0.etat == .revoked } }

    private var vide: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "person.2")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 68, height: 68)
                .background(Color.gpAccent.opacity(0.14), in: Circle())
                .frame(maxWidth: .infinity, alignment: .center)
            Text("Vous n'appartenez à aucune équipe.")
                .foregroundStyle(Color.gpInk)
                .frame(maxWidth: .infinity, alignment: .center)
            Text(
                "Créez-en une, ou attendez qu'on vous invite : les équipes dont vous ferez partie apparaîtront ici."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .glassCard()
    }

    @ViewBuilder private func lignes(_ groupe: [Organisation]) -> some View {
        ForEach(groupe) { organisation in
            ligne(organisation)
            if organisation.id != groupe.last?.id { Divider().overlay(Color.gpBorder) }
        }
    }

    private func ligne(_ organisation: Organisation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: organisation.nom)
                .foregroundStyle(Color.gpInk)
            Text(verbatim: "\(organisation.role.intitule) · \(organisation.etat.intitule)")
                .font(.footnote)
                .foregroundStyle(Color.gpMuted)

            switch organisation.etat {
            case .invited:
                Button("Rejoindre l'équipe") {
                    Task {
                        if await store.accepterLOrganisation(organisation.id) {
                            await recharger()
                        }
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("button.joinOrg")
            case .active:
                Button("Ouvrir le coffre") {
                    Task { ouvert = await store.ouvrirLOrganisation(organisation) }
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("button.openOrg")
            case .revoked:
                EmptyView()
            }
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    private func recharger() async {
        organisations = await store.organisations()
        chargement = false
    }
}

extension CoffrePartageOuvert: Identifiable {
    var id: String { organisation.id }
}
