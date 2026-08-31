import SwiftUI

/// Partager un secret par un lien qui expire.
///
/// Le texte est chiffré ici, sous une clé tirée pour lui seul. Le serveur reçoit le chiffre,
/// jamais la clé : celle-ci vit dans le fragment du lien — la partie après le `#`, que les
/// navigateurs n'envoient jamais. Le serveur héberge donc quelque chose qu'il ne peut pas
/// lire, et se contente de compter les consultations avant d'effacer.
///
/// La conséquence tient en une phrase, et l'écran la dit : **quiconque a le lien peut lire**.
/// Le protéger, c'est choisir par quel canal on l'envoie.
struct SendView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    /// Pré-rempli quand on partage depuis un élément du coffre.
    var secretInitial: String = ""

    @State private var secret = ""
    @State private var heures = 24
    @State private var consultations = 1
    @State private var lien: URL?
    @State private var copie = false

    private var duree: [(Int, LocalizedStringKey)] {
        [(1, "1 heure"), (24, "1 jour"), (168, "1 semaine"), (720, "30 jours")]
    }

    var body: some View {
        NavigationStack {
            GhostScreen {
                if let lien {
                    resultat(lien)
                } else {
                    formulaire
                }
            }
            .navigationTitle("Partager un secret")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(lien == nil ? "Annuler" : "Terminé") { dismiss() }
                        .foregroundStyle(lien == nil ? Color.gpMuted : Color.gpAccentText)
                        .fontWeight(lien == nil ? .regular : .semibold)
                        .accessibilityIdentifier("button.closeSend")
                }
            }
        }
        .tint(Color.gpAccentText)
        .onAppear { if secret.isEmpty { secret = secretInitial } }
        // Le serveur peut désigner un autre domaine que le sien pour héberger le partage.
        // C'est ce domaine qui servira la page où la clé de déchiffrement arrivera, dans
        // le fragment du lien : lui faire confiance sans le dire reviendrait à laisser le
        // serveur choisir qui peut lire le secret. On le montre, et l'utilisateur tranche.
        .alert(
            "Envoyer vers ce domaine ?",
            isPresented: Binding(
                get: { store.destinationAConfirmer != nil },
                set: { if !$0 { store.destinationAConfirmer = nil } }),
            presenting: store.destinationAConfirmer,
            actions: { _ in
                Button("Envoyer") { Task { lien = await store.confirmerLaDestination() } }
                Button("Annuler", role: .cancel) { Task { await store.refuserLaDestination() } }
            },
            message: { hote in
                Text(
                    "Votre serveur héberge ce partage sur « \(hote) », qui n'est pas son propre domaine. C'est là que la clé de déchiffrement arrivera quand le destinataire ouvrira le lien. N'acceptez que si ce domaine vous est connu."
                )
            })
    }

    private var formulaire: some View {
        VStack(alignment: .leading, spacing: 16) {
            GhostSection(
                titre: "Le secret",
                note:
                    "Il est chiffré sur cet appareil. Le serveur n'en reçoit que le chiffre, jamais la clé."
            ) {
                TextEditor(text: $secret)
                    .frame(minHeight: 120)
                    .scrollContentBackground(.hidden)
                    .foregroundStyle(Color.gpInk)
                    .padding(10)
                    .accessibilityIdentifier("field.sendSecret")
            }

            GhostSection(titre: "Durée de vie") {
                Picker(selection: $heures) {
                    ForEach(duree, id: \.0) { Text($0.1).tag($0.0) }
                } label: {
                    EmptyView()
                }
                .pickerStyle(.segmented)
                .padding(14)
                .accessibilityIdentifier("picker.sendExpiry")
            }

            GhostSection(
                titre: "Consultations",
                note:
                    "Le lien s'efface une fois ce nombre atteint. Une seule consultation vous dit aussi que quelqu'un d'autre l'a lu avant vous."
            ) {
                Stepper(value: $consultations, in: 1...100) {
                    Text(verbatim: String(format: tr("%d consultation(s)"), consultations))
                        .foregroundStyle(Color.gpInk)
                }
                .padding(14)
                .accessibilityIdentifier("stepper.sendViews")
            }

            Button("Créer le lien") {
                Task {
                    lien = await store.partager(
                        secret, heures: heures, consultations: consultations,
                        // Un texte libre n'a pas de nom. Le registre en a besoin d'un pour
                        // être lisible ailleurs — la date de création, qu'il retient aussi,
                        // distingue les lignes entre elles.
                        nom: tr("Secret partagé"))
                }
            }
            .buttonStyle(
                PrimaryButtonStyle(
                    enabled: !secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        && !store.isBusy)
            )
            .disabled(
                secret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isBusy
            )
            .accessibilityIdentifier("button.createSend")

            if let message = store.errorMessage {
                Label {
                    Text(verbatim: message)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpDanger)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func resultat(_ lien: URL) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GhostSection(
                titre: "Le lien",
                note:
                    "Quiconque l'a peut lire le secret. Envoyez-le par un canal différent de celui où vous avez annoncé son existence."
            ) {
                Text(verbatim: lien.absoluteString)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.gpInk)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .accessibilityIdentifier("text.sendLink")
            }

            Button(copie ? "Lien copié" : "Copier le lien") {
                Clipboard.copy(lien.absoluteString)
                copie = true
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("button.copySend")

            ShareLink(item: lien) {
                Text("Partager…")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())

            Label {
                Text(
                    "La clé se trouve après le # du lien. Elle n'a jamais été envoyée au serveur, et ne peut plus être retrouvée si vous perdez le lien."
                )
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "lock.shield")
            }
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
        }
    }
}
