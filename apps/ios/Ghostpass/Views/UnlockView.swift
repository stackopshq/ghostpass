import SwiftUI

/// Déverrouillage : la carte de verre posée sur la nuit, comme l'écran d'entrée des
/// autres produits de la suite. Deux états — une session enregistrée qu'on rouvre d'un
/// mot de passe, ou une connexion complète à décliner.
struct UnlockView: View {
    @EnvironmentObject private var store: VaultStore

    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var totpCode = ""
    @State private var needsTotp = false
    /// Une session enregistrée se rouvre avec le seul mot de passe maître, sans réseau.
    @State private var useSavedSession = false
    /// L'écran de réinitialisation, ouvert depuis « Mot de passe maître oublié ? ».
    @State private var recuperation = false
    /// Affiché après une réinitialisation réussie : sans un mot, on retomberait sur le
    /// formulaire de connexion sans savoir si quelque chose s'est passé.
    @State private var messageDeReinitialisation = false

    var body: some View {
        ZStack {
            GhostBackground()

            ScrollView {
                VStack(spacing: 24) {
                    enseigne
                    carte
                }
                .frame(maxWidth: 420)
                .padding(.horizontal, 20)
                .padding(.vertical, 40)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            // Le clavier couvre le bas de la carte — le lien de récupération, notamment.
            // Un tap dans le vide ne le referme pas en SwiftUI ; faire défiler, si.
            .scrollDismissesKeyboard(.immediately)
        }
        .sheet(isPresented: $recuperation) {
            RecoverAccountView(serveur: serveurEffectif, email: email) {
                messageDeReinitialisation = true
                password = ""
                useSavedSession = false
            }
            .environmentObject(store)
        }
        .onAppear {
            if store.hasSavedSession {
                useSavedSession = true
                // Une session enregistrée et la biométrie configurée : on la propose
                // d'emblée, c'est le geste attendu à l'ouverture de l'app.
                if store.canUnlockWithBiometrics {
                    Task { await store.unlockWithBiometrics() }
                }
            } else {
                server = store.savedServer
                email = store.savedEmail
            }
        }
    }

    private var enseigne: some View {
        VStack(spacing: 10) {
            Image("LogoMark")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                // La marque rayonne : c'est le seul néon de cet écran, et c'est ce qui
                // rattache GhostPass au reste de la suite.
                .neon()
            Text("GhostPass")
                .font(.system(.title, design: .rounded, weight: .bold))
                .foregroundStyle(Color.gpInk)
            Group {
                // Deux `Text` plutôt qu'un ternaire : les deux branches sont des clefs de
                // traduction, et un ternaire les ramènerait à de simples chaînes.
                if useSavedSession {
                    Text("Coffre enregistré sur cet appareil")
                } else {
                    Text("Coffre chiffré de bout en bout")
                }
            }
            .font(.footnote)
            .foregroundStyle(Color.gpMuted)
        }
    }

    private var carte: some View {
        VStack(alignment: .leading, spacing: 18) {
            if useSavedSession {
                champ("Compte") {
                    Text(verbatim: store.savedEmail)
                        .foregroundStyle(Color.gpMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .ghostField()
                }
                champ("Mot de passe maître") {
                    SecureField("", text: $password, prompt: invite("Votre mot de passe"))
                        .ghostField()
                        .accessibilityIdentifier("field.master")
                }
            } else {
                champ("Serveur") {
                    TextField("", text: $server, prompt: invite("https://ghostpass.stackops.ch"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .ghostField()
                        .accessibilityIdentifier("field.server")
                }
                champ("Adresse e-mail") {
                    TextField("", text: $email, prompt: invite("vous@exemple.ch"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .ghostField()
                        .accessibilityIdentifier("field.email")
                }
                champ("Mot de passe maître") {
                    SecureField("", text: $password, prompt: invite("Votre mot de passe"))
                        .ghostField()
                        .accessibilityIdentifier("field.master")
                }
                if needsTotp {
                    champ("Code à six chiffres") {
                        TextField("", text: $totpCode, prompt: invite("123456"))
                            .keyboardType(.numberPad)
                            .ghostField()
                            .accessibilityIdentifier("field.totp")
                    }
                }
            }

            if messageDeReinitialisation {
                Label {
                    Text("Mot de passe réinitialisé. Connectez-vous avec le nouveau.")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpSuccess)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("text.recovered")
            }

            if let message = store.errorMessage {
                // Le message arrive déjà traduit : les services passent par `tr(…)`.
                // Le réafficher comme une clef le ferait chercher une seconde fois.
                Label {
                    Text(verbatim: message)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                .font(.footnote)
                .foregroundStyle(Color.gpDanger)
                .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                Button(action: submit) {
                    if store.isBusy {
                        ProgressView().tint(Color.gpOnAccent)
                    } else if useSavedSession {
                        Text("Déverrouiller")
                    } else {
                        Text("Se connecter")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(enabled: !store.isBusy && !password.isEmpty))
                .disabled(store.isBusy || password.isEmpty)
                .accessibilityIdentifier("button.submit")

                if useSavedSession && store.canUnlockWithBiometrics {
                    Button("Déverrouiller avec \(store.biometryLabel)") {
                        Task { await store.unlockWithBiometrics() }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(store.isBusy)
                    .accessibilityIdentifier("button.biometric")
                }

                // La récupération n'a de sens que sur une connexion complète : elle a
                // besoin de l'adresse du serveur et du compte, et elle réinitialise pour
                // de bon. On ne la propose donc pas derrière une session déjà enregistrée.
                if !useSavedSession {
                    Button("Mot de passe maître oublié ?") {
                        store.errorMessage = nil
                        recuperation = true
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.gpAccentText)
                    .disabled(email.isEmpty || store.isBusy)
                    .padding(.top, 2)
                    .accessibilityIdentifier("button.forgotPassword")
                }

                if store.hasSavedSession {
                    Button {
                        useSavedSession.toggle()
                        password = ""
                        store.errorMessage = nil
                    } label: {
                        if useSavedSession {
                            Text("Utiliser un autre compte")
                        } else {
                            Text("Revenir au coffre enregistré")
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.gpAccentText)
                    .padding(.top, 2)
                    .accessibilityIdentifier("button.switchAccount")
                }
            }
        }
        .glassCard()
    }

    /// L'adresse saisie, ou celle de la session enregistrée si le champ est vide : la
    /// récupération part du même serveur que la connexion.
    private var serveurEffectif: String {
        let saisi = server.trimmingCharacters(in: .whitespacesAndNewlines)
        return saisi.isEmpty ? store.savedServer : saisi
    }

    private func champ<Contenu: View>(
        _ intitule: LocalizedStringKey, @ViewBuilder _ contenu: () -> Contenu
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(intitule).sectionLabel()
            contenu()
        }
    }

    /// Un texte d'invite lisible : le gris par défaut de SwiftUI disparaît sur nos surfaces.
    private func invite(_ texte: LocalizedStringKey) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }

    private func submit() {
        Task {
            if useSavedSession {
                await store.unlockOffline(password: password)
            } else {
                await store.signIn(
                    server: server, email: email, password: password,
                    totpCode: needsTotp ? totpCode : nil)
                // Le serveur ne réclame le second facteur qu'après validation du
                // mot de passe : le champ n'apparaît donc qu'une fois utile.
                if case .some(let message) = store.errorMessage,
                    message.contains("2FA") || message.contains("Second facteur")
                {
                    needsTotp = true
                }
            }
            if store.isUnlocked { password = "" }
        }
    }
}
