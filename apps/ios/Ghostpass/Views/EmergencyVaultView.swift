import SwiftUI

/// Le coffre d'un donneur, ouvert par son contact de confiance.
///
/// En lecture seule, toujours : on regarde les identifiants de quelqu'un d'autre, on ne les
/// modifie pas. Rien n'est mis en cache — à la fermeture de cet écran, le coffre déchiffré
/// disparaît, et il faudra repasser par le serveur pour le rouvrir.
struct EmergencyVaultView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    let ouvert: CoffreDUrgenceOuvert
    let apres: () async -> Void

    @State private var recherche = ""
    @State private var repriseDemandee = false

    private var visibles: [VaultEntry] {
        let q = recherche.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return ouvert.entrees }
        return ouvert.entrees.filter {
            $0.item.name.localizedCaseInsensitiveContains(q)
                || ($0.login?.username ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                VStack(alignment: .leading, spacing: 16) {
                    bandeau

                    if ouvert.entrees.isEmpty {
                        Text("Ce coffre est vide.")
                            .foregroundStyle(Color.gpMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .glassCard()
                    } else {
                        GhostSection(titre: "Identifiants") {
                            ForEach(visibles) { entree in
                                NavigationLink {
                                    ItemDetailView(entry: entree, lectureSeule: true)
                                        .environmentObject(store)
                                } label: {
                                    GhostRow(
                                        intitule: Text(verbatim: entree.item.name),
                                        valeur: entree.login?.username ?? ""
                                    ) {}
                                }
                                if entree.id != visibles.last?.id {
                                    Divider().overlay(Color.gpBorder)
                                }
                            }
                        }
                    }

                    if ouvert.role == .takeover {
                        reprise
                    }
                }
            }
            .searchable(text: $recherche, prompt: Text("Rechercher"))
            .navigationTitle(Text(verbatim: ouvert.donneur))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeGrantorVault")
                }
            }
        }
        .tint(Color.gpAccentText)
        .sheet(isPresented: $repriseDemandee) {
            EmergencyTakeoverView(ouvert: ouvert) {
                await apres()
                dismiss()
            }
            .environmentObject(store)
        }
    }

    private var bandeau: some View {
        Label {
            Text(
                "Vous consultez le coffre de quelqu'un d'autre. Cet accès est enregistré dans son journal."
            )
            .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "eye")
        }
        .font(.footnote)
        .foregroundStyle(Color.gpMuted)
        .padding(14)
        .glassCard()
    }

    private var reprise: some View {
        GhostSection(
            titre: "Reprise du compte",
            note:
                "Choisir un nouveau mot de passe maître rendra le coffre inaccessible à son propriétaire actuel. À ne faire que s'il ne peut plus s'en servir lui-même."
        ) {
            Button("Reprendre le compte") { repriseDemandee = true }
                .buttonStyle(SecondaryButtonStyle())
                .padding(14)
                .accessibilityIdentifier("button.takeover")
        }
    }
}
