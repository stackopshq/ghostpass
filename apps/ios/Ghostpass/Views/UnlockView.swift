import SwiftUI

struct UnlockView: View {
    @EnvironmentObject private var store: VaultStore

    @State private var server = ""
    @State private var email = ""
    @State private var password = ""
    @State private var totpCode = ""
    @State private var needsTotp = false
    /// Une session enregistrée se rouvre avec le seul mot de passe maître, sans réseau.
    @State private var useSavedSession = false

    var body: some View {
        NavigationStack {
            Form {
                if useSavedSession {
                    Section("Coffre") {
                        LabeledContent("Compte", value: store.savedEmail)
                        SecureField("Mot de passe maître", text: $password)
                            .textContentType(.password)
                    }
                } else {
                    Section("Serveur") {
                        TextField("https://ghostpass.stackops.ch", text: $server)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                    }
                    Section("Compte") {
                        TextField("Adresse e-mail", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                        SecureField("Mot de passe maître", text: $password)
                            .textContentType(.password)
                        if needsTotp {
                            TextField("Code à 6 chiffres", text: $totpCode)
                                .keyboardType(.numberPad)
                        }
                    }
                }

                if let message = store.errorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                    }
                }

                Section {
                    Button(action: submit) {
                        if store.isBusy {
                            ProgressView()
                        } else {
                            Text(useSavedSession ? "Déverrouiller" : "Se connecter")
                        }
                    }
                    .disabled(store.isBusy || password.isEmpty)

                    if store.hasSavedSession {
                        Button(useSavedSession ? "Utiliser un autre compte" : "Coffre enregistré") {
                            useSavedSession.toggle()
                            password = ""
                        }
                        .font(.footnote)
                    }
                }
            }
            .navigationTitle("GhostPass")
            .onAppear {
                if store.hasSavedSession {
                    useSavedSession = true
                } else {
                    server = store.savedServer
                    email = store.savedEmail
                }
            }
        }
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
