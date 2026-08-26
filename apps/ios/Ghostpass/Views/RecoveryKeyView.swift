import SwiftUI

/// La clé de récupération : le seul moyen de rouvrir un coffre dont on a oublié le mot de
/// passe maître.
///
/// Elle ne s'affiche qu'une fois. Le serveur n'en reçoit qu'une preuve re-hachée, et
/// l'application ne la garde nulle part — c'est ce qui fait que personne d'autre ne peut
/// s'en servir, et c'est aussi ce qui rend cet écran irremplaçable. D'où l'insistance :
/// tant que la clé est à l'écran, on ne propose pas de partir sans l'avoir notée.
struct RecoveryKeyView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var cle: String?
    @State private var copiee = false

    var body: some View {
        NavigationStack {
            GhostScreen {
                if let cle {
                    resultat(cle)
                } else {
                    presentation
                }
            }
            .navigationTitle("Clé de récupération")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(cle == nil ? "Annuler" : "Terminé") { dismiss() }
                        .foregroundStyle(cle == nil ? Color.gpMuted : Color.gpAccentText)
                        .fontWeight(cle == nil ? .regular : .semibold)
                        .accessibilityIdentifier("button.closeRecovery")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private var presentation: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "key.horizontal")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Color.gpAccentText)
                .frame(width: 76, height: 76)
                .background(Color.gpAccent.opacity(0.14), in: Circle())
                .frame(maxWidth: .infinity, alignment: .center)

            Text(
                "Un coffre chiffré de bout en bout ne se rouvre pas sans son mot de passe maître : personne, pas même le serveur, ne peut le retrouver à votre place."
            )
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)

            Text(
                "La clé de récupération est la seule issue. Notez-la et rangez-la ailleurs que dans ce coffre."
            )
            .foregroundStyle(Color.gpMuted)
            .fixedSize(horizontal: false, vertical: true)

            Button("Créer une clé de récupération") {
                Task { cle = await store.createRecoveryKit() }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: !store.isBusy))
            .disabled(store.isBusy)
            .accessibilityIdentifier("button.createRecovery")

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
        .glassCard()
    }

    private func resultat(_ cle: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GhostSection(
                titre: "Votre clé de récupération",
                note: "Elle ne sera plus affichée. Sans elle, un mot de passe maître oublié rend le coffre définitivement illisible."
            ) {
                Text(verbatim: cle)
                    .font(.system(.body, design: .monospaced, weight: .medium))
                    .foregroundStyle(Color.gpInk)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .accessibilityIdentifier("text.recoveryKey")
            }

            Button {
                Clipboard.copy(cle)
                copiee = true
            } label: {
                Label(
                    copiee ? "Copiée" : "Copier la clé",
                    systemImage: copiee ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("button.copyRecovery")
        }
        .animation(.snappy, value: copiee)
    }
}
