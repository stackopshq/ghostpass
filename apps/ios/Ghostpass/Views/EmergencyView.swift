import SwiftUI

/// L'accès d'urgence : confier à quelqu'un la possibilité d'ouvrir son coffre, un jour où
/// l'on ne pourra plus le faire soi-même.
///
/// Tout le sel est dans le délai. Le contact demande l'accès, le donneur est prévenu et peut
/// refuser pendant N jours ; passé ce délai sans refus, l'accès s'ouvre. C'est ce qui permet
/// de survivre à un décès sans donner les clés à un vivant — et c'est le serveur qui compte
/// les jours, jamais l'application, qui ne fait que les afficher.
struct EmergencyView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var donnes: [LienDUrgence] = []
    @State private var recus: [LienDUrgence] = []
    @State private var chargement = true
    @State private var invitation = false
    @State private var ouvert: CoffreDUrgenceOuvert?
    @State private var aRevoquer: LienDUrgence?

    var body: some View {
        NavigationStack {
            GhostScreen {
                if chargement {
                    ProgressView().tint(Color.gpAccentText)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        mesContacts
                        ceuxQuiMOntChoisi
                    }
                }
            }
            .navigationTitle("Accès d'urgence")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Terminé") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeEmergency")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        invitation = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .accessibilityIdentifier("button.inviteEmergency")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task { await recharger() }
        .sheet(isPresented: $invitation) {
            EmergencyInviteView { await recharger() }
                .environmentObject(store)
        }
        .sheet(item: $ouvert) { coffre in
            EmergencyVaultView(ouvert: coffre) { await recharger() }
                .environmentObject(store)
        }
        .alert(
            "Retirer cet accès ?",
            isPresented: Binding(
                get: { aRevoquer != nil }, set: { if !$0 { aRevoquer = nil } })
        ) {
            Button("Annuler", role: .cancel) { aRevoquer = nil }
            Button("Retirer", role: .destructive) {
                if let lien = aRevoquer {
                    Task {
                        _ = await store.revoquerLUrgence(lien.id)
                        aRevoquer = nil
                        await recharger()
                    }
                }
            }
        } message: {
            Text(
                "Le contact ne pourra plus ouvrir votre coffre. La clé qui lui avait été scellée devient inutilisable."
            )
        }
    }

    // ─── Ce que j'ai confié ───

    private var mesContacts: some View {
        GhostSection(
            titre: "Mes contacts de confiance",
            note:
                "Ils pourront ouvrir votre coffre si vous ne le pouvez plus. Vous gardez la main tant que vous répondez."
        ) {
            if donnes.isEmpty {
                Text("Personne pour l'instant.")
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else {
                ForEach(donnes) { lien in
                    ligneDonnee(lien)
                    if lien.id != donnes.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private func ligneDonnee(_ lien: LienDUrgence) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: lien.contactEmail)
                        .foregroundStyle(Color.gpInk)
                    Text(verbatim: "\(lien.role.intitule) · \(lien.etat.intitule)")
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                }
                Spacer()
                Button {
                    aRevoquer = lien
                } label: {
                    Image(systemName: "trash")
                        .foregroundStyle(Color.gpDanger)
                }
                .accessibilityLabel("Retirer cet accès")
            }

            // Une demande en cours est le seul moment où le donneur doit agir vite : c'est
            // maintenant, ou l'accès s'ouvrira tout seul.
            if lien.etat == .requested {
                if let ouverture = lien.ouverturePrevue() {
                    Text(
                        verbatim: String(
                            format: tr("Accès automatique le %@ si vous ne faites rien."),
                            ouverture.formatted(date: .abbreviated, time: .shortened))
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.gpDanger)
                    .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 10) {
                    Button("Refuser") {
                        Task {
                            _ = await store.agirSurLUrgence(lien.id, action: "reject")
                            await recharger()
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button("Ouvrir maintenant") {
                        Task {
                            _ = await store.agirSurLUrgence(lien.id, action: "approve")
                            await recharger()
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    // ─── Ce qu'on m'a confié ───

    private var ceuxQuiMOntChoisi: some View {
        GhostSection(
            titre: "Coffres qui me sont confiés",
            note: "Ce que d'autres vous ont laissé, et ce que vous pouvez en faire."
        ) {
            if recus.isEmpty {
                Text("Personne ne vous a désigné.")
                    .foregroundStyle(Color.gpMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else {
                ForEach(recus) { lien in
                    ligneRecue(lien)
                    if lien.id != recus.last?.id { Divider().overlay(Color.gpBorder) }
                }
            }
        }
    }

    private func ligneRecue(_ lien: LienDUrgence) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: lien.contactEmail)
                .foregroundStyle(Color.gpInk)
            Text(verbatim: "\(lien.role.intitule) · \(lien.etat.intitule)")
                .font(.footnote)
                .foregroundStyle(Color.gpMuted)

            if lien.disponible {
                Button("Ouvrir le coffre") {
                    Task { ouvert = await store.ouvrirLeCoffreDUrgence(lien.id) }
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("button.openGrantorVault")
            } else {
                switch lien.etat {
                case .invited:
                    Button("Accepter") {
                        Task {
                            _ = await store.agirSurLUrgence(lien.id, action: "accept")
                            await recharger()
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                case .accepted:
                    Text(
                        verbatim: String(
                            format: tr(
                                "Demander l'accès préviendra %1$@, qui aura %2$d jours pour refuser."
                            ), lien.contactEmail, lien.waitDays)
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.gpMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    Button("Demander l'accès") {
                        Task {
                            _ = await store.agirSurLUrgence(lien.id, action: "request")
                            await recharger()
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                case .requested:
                    if let ouverture = lien.ouverturePrevue() {
                        Text(
                            verbatim: String(
                                format: tr("Accès possible à partir du %@."),
                                ouverture.formatted(date: .abbreviated, time: .shortened))
                        )
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                    }
                case .rejected:
                    Text("Le propriétaire a refusé.")
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                case .granted:
                    EmptyView()
                }
            }
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    private func recharger() async {
        let (d, r) = await store.lienDUrgence()
        donnes = d
        recus = r
        chargement = false
    }
}

extension CoffreDUrgenceOuvert: Identifiable {
    var id: String { lien }
}
