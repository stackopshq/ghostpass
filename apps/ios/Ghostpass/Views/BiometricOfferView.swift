import SwiftUI

/// La proposition d'activer la biométrie, juste après un premier déverrouillage.
///
/// C'était une alerte. Une alerte SwiftUI posée sur cet écran s'affichait bien mais ne
/// répondait plus : ses boutons n'exécutaient rien, et elle restait là, à bloquer le
/// coffre — le même travers que les deux `.sheet` concurrents corrigés plus tôt. Une
/// feuille fait le travail, et laisse la place d'expliquer ce qu'on met dans le trousseau
/// plutôt que de l'énoncer en trois lignes serrées.
struct BiometricOfferView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                GhostBackground()
                VStack(spacing: 22) {
                    Spacer(minLength: 0)

                    Image(systemName: store.biometryIcon)
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(Color.gpAccentText)
                        .frame(width: 92, height: 92)
                        .background(Color.gpAccent.opacity(0.14), in: Circle())

                    VStack(spacing: 10) {
                        Text("Utiliser \(store.biometryLabel) ?")
                            .font(.system(.title2, design: .rounded, weight: .semibold))
                            .foregroundStyle(Color.gpInk)
                        Text(
                            "Votre mot de passe maître sera conservé dans le trousseau de cet appareil, relisible par \(store.biometryLabel) seul."
                        )
                        .font(.footnote)
                        .foregroundStyle(Color.gpMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 8)

                    Spacer(minLength: 0)

                    VStack(spacing: 10) {
                        Button("Activer") {
                            store.acceptOfferedBiometrics()
                            dismiss()
                        }
                        .buttonStyle(PrimaryButtonStyle(enabled: true))
                        .accessibilityIdentifier("button.acceptBiometric")

                        Button("Plus tard") {
                            store.declineBiometrics()
                            dismiss()
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("button.laterBiometric")
                    }
                }
                .padding(24)
                .frame(maxWidth: 520)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .tint(Color.gpAccentText)
        .onDisappear {
            // Refermer d'un glissement, c'est écarter la proposition : sans cela, elle
            // resterait « en attente » et reviendrait au premier changement d'écran.
            if store.offersBiometricEnrollment { store.declineBiometrics() }
        }
    }
}
