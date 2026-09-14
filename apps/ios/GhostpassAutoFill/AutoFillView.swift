import SwiftUI

/// L'écran que voit l'utilisateur quand il demande un remplissage : d'abord le
/// déverrouillage, puis la liste — les entrées du site en cours en tête.
struct AutoFillView: View {
    @EnvironmentObject private var store: AutoFillStore
    @State private var password = ""

    /// Faut-il masquer ? **Pas** `scenePhase`, et c'est tout le sujet.
    ///
    /// Une extension n'a pas de cycle de vie de scène : `scenePhase` n'y vaut jamais
    /// `.active`. La condition `scenePhase != .active` était donc **toujours vraie**, et le
    /// voile couvrait l'extension en permanence dès qu'elle était déverrouillée. À l'écran,
    /// cela donnait le mot « GhostPass » seul au milieu d'un fond sombre — sans logo, le
    /// catalogue d'images manquant aussi à cette cible — c'est-à-dire quelque chose qui
    /// ressemble à une extension vide, jamais à un voile.
    ///
    /// Le simulateur n'aurait pas tranché : c'est un iPhone branché qui l'a montré.
    ///
    /// `NSExtensionHostWillResignActive` et ses voisines sont les notifications prévues
    /// pour cela — une extension ne peut pas interroger `UIApplication.shared`.
    @State private var masquer = false

    var body: some View {
        NavigationStack {
            ZStack {
                GhostBackground()
                Group {
                    if store.isUnlocked {
                        liste
                    } else {
                        deverrouillage
                    }
                }
            }
            // Le même voile que l'application, pour la même raison — et il manquait ici.
            // Cette liste montre des identifiants et des codes à usage unique en clair ;
            // le système photographie l'écran à la sortie, et l'extension n'échappe pas à
            // cette vignette sous prétexte que sa vie est courte.
            .overlay {
                if masquer && store.isUnlocked {
                    VoileDeConfidentialite()
                }
            }
            .onReceive(
                NotificationCenter.default.publisher(for: .NSExtensionHostWillResignActive)
            ) { _ in masquer = true }
            .onReceive(
                NotificationCenter.default.publisher(for: .NSExtensionHostDidEnterBackground)
            ) { _ in masquer = true }
            .onReceive(
                NotificationCenter.default.publisher(for: .NSExtensionHostDidBecomeActive)
            ) { _ in masquer = false }
            .navigationTitle("GhostPass")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { store.cancel() }
                        .foregroundStyle(Color.gpMuted)
                        .accessibilityIdentifier("button.cancel")
                }
            }
        }
        .tint(Color.gpAccentText)
    }

    private var deverrouillage: some View {
        ScrollView {
            VStack(spacing: 18) {
                if store.hasSession {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Compte").sectionLabel()
                            Text(verbatim: store.account)
                                .foregroundStyle(Color.gpMuted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .ghostField()
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            Text("Mot de passe maître").sectionLabel()
                            SecureField("", text: $password, prompt: invite("Votre mot de passe"))
                                .ghostField()
                                .accessibilityIdentifier("field.master")
                        }

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

                        VStack(spacing: 10) {
                            Button("Déverrouiller") {
                                Task {
                                    await store.unlock(password: password)
                                    password = ""
                                }
                            }
                            .buttonStyle(
                                PrimaryButtonStyle(enabled: !store.isBusy && !password.isEmpty)
                            )
                            .disabled(store.isBusy || password.isEmpty)
                            .accessibilityIdentifier("button.submit")

                            if store.canUseBiometrics {
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
                        }
                    }
                    .glassCard()
                } else {
                    // Sans session déposée, l'extension n'a rien à offrir : le dire vaut
                    // mieux que d'afficher un formulaire qui ne mènera nulle part.
                    //
                    // Encore faut-il dire la *bonne* raison. Quand le groupe d'applications
                    // manque, l'extension lit son propre conteneur, vide, et conclut à
                    // l'absence de session : inviter à ouvrir GhostPass enverrait alors
                    // refaire ce qui a déjà été fait.
                    ContentUnavailableView {
                        Label("Coffre indisponible", systemImage: "lock")
                    } description: {
                        if store.partageActif {
                            Text("Ouvrez GhostPass et connectez-vous une fois.")
                        } else {
                            Text(
                                "Cette version de l'application n'a pas le groupe d'applications : le remplissage ne peut pas lire le coffre."
                            )
                        }
                    }
                    .foregroundStyle(Color.gpMuted)
                }
            }
            .padding(20)
        }
        .onAppear {
            // La biométrie d'emblée : c'est le geste attendu, et le remplissage doit
            // aboutir en quelques secondes.
            if store.canUseBiometrics {
                Task { await store.unlockWithBiometrics() }
            }
        }
    }

    private var liste: some View {
        List {
            if !store.suggested.isEmpty {
                section(Text("Pour ce site"), store.suggested)
            }
            if !store.others.isEmpty {
                section(
                    store.suggested.isEmpty ? Text("Coffre") : Text(titreDesAutres),
                    store.others)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            if store.suggested.isEmpty && store.others.isEmpty {
                ContentUnavailableView {
                    Label(titreDuVide, systemImage: iconeDuMode)
                } description: {
                    if let message = store.errorMessage {
                        Text(verbatim: message)
                    } else {
                        Text("Le coffre local ne contient rien.")
                    }
                }
                .foregroundStyle(Color.gpMuted)
            }
        }
    }

    private func section(_ titre: Text, _ entries: [VaultEntry]) -> some View {
        Section {
            ForEach(entries) { entry in
                ligne(entry)
                    .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        } header: {
            titre.sectionLabel().padding(.leading, 2)
        }
    }

    private func ligne(_ entry: VaultEntry) -> some View {
        Button {
            store.pick(entry)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: iconeDuMode)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.gpAccentText)
                    .frame(width: 34, height: 34)
                    .background(Color.gpAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: entry.item.name)
                        .font(.system(.body, weight: .medium))
                        .foregroundStyle(Color.gpInk)
                    if let login = entry.login, !login.username.isEmpty {
                        Text(verbatim: login.username).font(.caption)
                            .foregroundStyle(Color.gpMuted)
                    }
                }
                Spacer(minLength: 8)
                // Le code est montré autant qu'il est rempli : si le champ visé refuse la
                // saisie automatique, il reste recopiable à la main plutôt que perdu.
                if store.demande == .codeAUsageUnique, let code = store.code(pour: entry) {
                    Text(verbatim: code)
                        .font(.system(.body, design: .monospaced, weight: .semibold))
                        .foregroundStyle(Color.gpAccentText)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color.gpSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: GP.radius))
            .overlay(
                RoundedRectangle(cornerRadius: GP.radius)
                    .strokeBorder(Color.gpBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // ─── Ce que le mode change dans les mots ───

    private var iconeDuMode: String {
        store.demande == .codeAUsageUnique ? "123.rectangle" : "person.badge.key"
    }

    private var titreDesAutres: LocalizedStringKey {
        store.demande == .codeAUsageUnique ? "Autres comptes" : "Autres identifiants"
    }

    private var titreDuVide: LocalizedStringKey {
        store.demande == .codeAUsageUnique ? "Aucun code" : "Aucun identifiant"
    }

    private func invite(_ texte: LocalizedStringKey) -> Text {
        Text(texte).foregroundColor(Color.gpMuted.opacity(0.7))
    }
}
