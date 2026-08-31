import SwiftUI

/// Déverrouillage : la carte de verre posée sur la nuit, comme l'écran d'entrée des
/// autres produits de la suite. Deux états — une session enregistrée qu'on rouvre d'un
/// mot de passe, ou une connexion complète à décliner.
struct UnlockView: View {
    @EnvironmentObject private var store: VaultStore
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase

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
    @State private var biometrieDemandee = false
    /// Le SSO est-il proposé par ce serveur ? Nul tant qu'on n'a pas demandé — un bouton
    /// affiché puis retiré serait plus déroutant qu'un bouton qui apparaît.
    @State private var ssoDisponible: Bool?

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
                demanderLaBiometrie()
            } else {
                server = store.savedServer
                email = store.savedEmail
            }
        }
        // Au lancement à froid, `onAppear` se produit alors que l'application est encore
        // `.inactive` : iOS refuse d'y présenter la demande biométrique, le trousseau
        // répond « interaction impossible », et le store avale ce refus en silence — à
        // raison, ce n'est pas un échec. Mais rien ne repartait ensuite, et il fallait
        // appuyer soi-même sur un bouton pour obtenir ce qui devait venir seul.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { demanderLaBiometrie() }
        }
        // L'adresse peut changer sous les doigts : on redemande, mais seulement quand elle
        // devient plausible, pour ne pas interroger un serveur à chaque caractère tapé.
        .task(id: serveurEffectif) { await interrogerLeSSO() }
    }

    /// Demande au serveur s'il propose le SSO.
    ///
    /// L'échec est traité comme « pas de SSO » et non comme une erreur : un serveur
    /// antérieur à cette fonction ne connaît pas la route, et afficher un incident pour une
    /// fonction que personne n'a demandée serait du bruit.
    private func interrogerLeSSO() async {
        guard !useSavedSession, let url = ServerAddress.normaliser(serveurEffectif) else {
            ssoDisponible = nil
            return
        }
        ssoDisponible = await APIClient(baseURL: url).ssoActif()
    }

    @MainActor
    private func connecterParSSO() async {
        guard
            let fenetre = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first
        else { return }
        if await store.connecterParSSO(server: serveurEffectif, ancre: fenetre) {
            // La session est déposée : il ne reste que la phrase. On bascule sur le visage
            // qui la demande seule, plutôt que de laisser le formulaire complet affiché.
            useSavedSession = true
            password = ""
        }
    }

    /// Demande la biométrie, au plus une fois par présentation de cet écran.
    ///
    /// Deux chemins y mènent — l'apparition et le passage au premier plan — et sans ce
    /// garde, un lancement où les deux se produisent poserait deux fois la question. Le
    /// garde tient aussi après un refus : redemander à chaque retour dans l'application
    /// harcèlerait celui qui vient justement de dire non. Le bouton reste à sa portée.
    private func demanderLaBiometrie() {
        guard !biometrieDemandee, useSavedSession, store.canUnlockWithBiometrics else {
            return
        }
        biometrieDemandee = true
        Task { await store.unlockWithBiometrics() }
    }

    private var enseigne: some View {
        VStack(spacing: 10) {
            // La marque est sur fond transparent : posée à même l'écran, elle flottait.
            // Une plaque franchement noire ou franchement blanche la détache — pas une
            // surface du thème, qui la ferait se fondre à nouveau.
            //
            // `colorScheme` reflète le thème *effectif*, celui qu'imposent les préférences
            // de l'application le cas échéant, et non celui du système : c'est bien ce
            // qu'on veut, sans quoi la plaque jurerait pour qui force un thème.
            Image("LogoMark")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .padding(14)
                .background(
                    colorScheme == .dark ? Color.black : Color.white,
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color.gpBorder, lineWidth: 1)
                )
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
                    // `verbatim` : une adresse n'est pas du texte à traduire, et passer par
                    // une clé de localisation la faisait entrer au catalogue. Le domaine est
                    // celui que la RFC 2606 réserve aux exemples — il ne résout nulle part,
                    // donc personne ne se connectera par mégarde à l'instance d'un tiers.
                    TextField(
                        "", text: $server,
                        prompt: Text(verbatim: "https://ghostpass.example.com")
                            .foregroundColor(Color.gpMuted.opacity(0.7))
                    )
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
                    Button {
                        Task { await store.unlockWithBiometrics() }
                    } label: {
                        // Le geste attendu se reconnaît à son symbole plus vite qu'il ne se
                        // lit. On garde le nom en étiquette d'accessibilité : c'est une
                        // **action**, pas une décoration, et VoiceOver ne doit pas annoncer
                        // « image » là où il y a un bouton.
                        //
                        // `Biometrics.icon` suit le matériel — visage, empreinte, ou un
                        // bouclier neutre si l'appareil annonce une biométrie que cette
                        // version ne connaît pas. Une icône Face ID codée en dur mentirait
                        // sur un iPhone à Touch ID.
                        Image(systemName: store.biometryIcon)
                            .font(.system(size: 22, weight: .medium))
                            .frame(maxWidth: .infinity)
                    }
                    .accessibilityLabel("Déverrouiller avec \(store.biometryLabel)")
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(store.isBusy)
                    .accessibilityIdentifier("button.biometric")
                }

                // La récupération n'a de sens que sur une connexion complète : elle a
                // besoin de l'adresse du serveur et du compte, et elle réinitialise pour
                // de bon. On ne la propose donc pas derrière une session déjà enregistrée.
                // Le SSO ne se propose que sur une connexion complète : derrière une
                // session enregistrée, il n'y a plus d'identité à établir, seulement un
                // coffre à ouvrir — et cela, le SSO ne sait pas le faire.
                if !useSavedSession && ssoDisponible == true {
                    Button("Se connecter avec le SSO") {
                        Task { await connecterParSSO() }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(store.isBusy)
                    .accessibilityIdentifier("button.sso")
                }

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
