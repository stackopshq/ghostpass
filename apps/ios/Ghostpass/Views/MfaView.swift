import SwiftUI

/// Le second facteur du compte.
///
/// Il protège la connexion au serveur, pas le coffre lui-même : celui-ci reste chiffré par
/// le mot de passe maître, que le serveur ne connaît pas. Quelqu'un qui volerait le second
/// facteur n'obtiendrait donc que des blobs illisibles — mais il obtiendrait aussi la
/// possibilité de les effacer, ce qui suffit à justifier cette protection.
struct MfaView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.dismiss) private var dismiss

    @State private var actif: Bool?
    @State private var configuration: MfaSetupDTO?
    @State private var motDePasse = ""
    @State private var code = ""
    @State private var confirme = false
    @State private var copie = false

    var body: some View {
        NavigationStack {
            GhostScreen {
                switch (actif, configuration, confirme) {
                case (nil, _, _):
                    ProgressView().tint(Color.gpAccentText)
                        .frame(maxWidth: .infinity, minHeight: 120)
                case (_, _, true):
                    reussite
                case (_, .some(let c), _):
                    aScanner(c)
                case (.some(true), _, _):
                    desactivation
                default:
                    activation
                }
            }
            .navigationTitle("Second facteur")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(configuration == nil || confirme ? "Terminé" : "Annuler") { dismiss() }
                        .foregroundStyle(Color.gpAccentText)
                        .accessibilityIdentifier("button.closeMfa")
                }
            }
        }
        .tint(Color.gpAccentText)
        .task { actif = await store.secondFacteurActif() }
    }

    // ─── Activer ───

    private var activation: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label {
                Text(
                    "Un code à six chiffres sera demandé à chaque connexion, en plus du mot de passe maître."
                )
                .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "lock.shield")
            }
            .foregroundStyle(Color.gpMuted)
            .padding(14)
            .glassCard()

            GhostSection(
                titre: "Mot de passe maître",
                note: "Il est vérifié sur cet appareil et n'en sort pas : le serveur n'en reçoit qu'une empreinte."
            ) {
                SecureField("Votre mot de passe", text: $motDePasse)
                    .foregroundStyle(Color.gpInk)
                    .padding(14)
                    .accessibilityIdentifier("field.mfaMaster")
            }

            Button("Configurer") {
                Task { configuration = await store.preparerLeSecondFacteur(motDePasse: motDePasse) }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: !motDePasse.isEmpty && !store.isBusy))
            .disabled(motDePasse.isEmpty || store.isBusy)
            .accessibilityIdentifier("button.mfaSetup")

            erreur
        }
    }

    private func aScanner(_ c: MfaSetupDTO) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            GhostSection(
                titre: "À enregistrer dans votre application d'authentification",
                note: "Ce secret ne sera plus affiché. Sans lui et sans votre application, la connexion deviendra impossible — gardez un moyen de secours."
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(verbatim: c.secret)
                        .font(.system(.body, design: .monospaced, weight: .medium))
                        .foregroundStyle(Color.gpInk)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("text.mfaSecret")
                    Button(copie ? "Secret copié" : "Copier le secret") {
                        Clipboard.copy(c.secret)
                        copie = true
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(14)
            }

            GhostSection(
                titre: "Confirmer",
                note: "Tant que ce code n'est pas validé, le compte reste accessible sans second facteur. C'est ce qui évite de s'enfermer dehors avec une application mal configurée."
            ) {
                TextField("123456", text: $code)
                    .keyboardType(.numberPad)
                    .foregroundStyle(Color.gpInk)
                    .padding(14)
                    .accessibilityIdentifier("field.mfaCode")
            }

            Button("Activer") {
                Task {
                    if await store.confirmerLeSecondFacteur(code: code) {
                        confirme = true
                        actif = true
                    }
                }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: code.count == 6 && !store.isBusy))
            .disabled(code.count != 6 || store.isBusy)
            .accessibilityIdentifier("button.mfaActivate")

            erreur
        }
    }

    private var reussite: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Color.gpSuccess)
                .frame(width: 76, height: 76)
                .background(Color.gpSuccess.opacity(0.14), in: Circle())
                .frame(maxWidth: .infinity, alignment: .center)
            Text("Le second facteur est actif.")
                .foregroundStyle(Color.gpInk)
                .frame(maxWidth: .infinity, alignment: .center)
            Text(
                "Un code vous sera demandé à chaque connexion. Vos appareils déjà connectés le restent."
            )
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .glassCard()
    }

    // ─── Désactiver ───

    private var desactivation: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label {
                Text("Le second facteur est actif sur ce compte.")
            } icon: {
                Image(systemName: "checkmark.shield")
            }
            .foregroundStyle(Color.gpSuccess)
            .padding(14)
            .glassCard()

            GhostSection(
                titre: "Le retirer",
                note: "Les deux sont exigés : le mot de passe maître et un code valide. Un téléphone déverrouillé trouvé sur une table ne doit pas suffire à retirer la protection."
            ) {
                VStack(spacing: 0) {
                    SecureField("Mot de passe maître", text: $motDePasse)
                        .padding(14)
                        .accessibilityIdentifier("field.mfaMasterOff")
                    Divider().overlay(Color.gpBorder)
                    TextField("Code à six chiffres", text: $code)
                        .keyboardType(.numberPad)
                        .padding(14)
                        .accessibilityIdentifier("field.mfaCodeOff")
                }
                .foregroundStyle(Color.gpInk)
            }

            Button("Désactiver le second facteur", role: .destructive) {
                Task {
                    if await store.retirerLeSecondFacteur(motDePasse: motDePasse, code: code) {
                        actif = false
                        motDePasse = ""
                        code = ""
                    }
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(motDePasse.isEmpty || code.count != 6 || store.isBusy)
            .accessibilityIdentifier("button.mfaDisable")

            erreur
        }
    }

    @ViewBuilder private var erreur: some View {
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
