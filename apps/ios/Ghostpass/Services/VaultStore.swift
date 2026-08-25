import Foundation

/// État de l'application : session, coffre déchiffré, opérations CRUD.
///
/// `Account` vient du binding UniFFI ; il détient les clés côté Rust. On ne le
/// conserve qu'en mémoire, et `lock()` le relâche — le verrouillage n'est pas
/// une bascule d'affichage, c'est la perte effective des clés.
@MainActor
final class VaultStore: ObservableObject {
    @Published private(set) var entries: [VaultEntry] = []
    @Published private(set) var isUnlocked = false
    @Published private(set) var isBusy = false
    @Published var errorMessage: String?
    /// Vrai juste après un déverrouillage réussi, quand la biométrie est disponible mais
    /// pas encore configurée : l'UI peut alors proposer de l'activer.
    @Published var offersBiometricEnrollment = false

    private var account: Account?
    private var token: String?
    private var api: APIClient?
    /// Mot de passe maître retenu le temps de proposer l'enrôlement biométrique, jamais
    /// au-delà : `enableBiometrics` et `declineBiometrics` l'effacent tous les deux.
    private var pendingPassword: String?

    var hasSavedSession: Bool {
        Keychain.get(Keychain.Key.token) != nil && Keychain.get(Keychain.Key.email) != nil
    }

    var savedEmail: String { Keychain.get(Keychain.Key.email) ?? "" }
    var savedServer: String { Keychain.get(Keychain.Key.serverURL) ?? "" }

    // ─── Session ───

    /// Connexion complète : prelogin pour les paramètres KDF, dérivation du hash
    /// d'authentification côté Rust, puis déverrouillage local avec les blobs reçus.
    /// Le mot de passe ne quitte jamais l'appareil ; le serveur ne voit qu'un hash.
    func signIn(server: String, email: String, password: String, totpCode: String?) async {
        guard let url = URL(string: server) else {
            errorMessage = APIError.badURL.localizedDescription
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let client = APIClient(baseURL: url)
            let kdf = try await client.prelogin(email: email).kdfParams
            let hash = try masterPasswordHash(
                password: password, email: email, kdfParamsJson: kdf)
            let session = try await client.login(
                email: email, masterPasswordHash: hash, totpCode: totpCode)

            let unlocked = try Account.unlock(
                password: password,
                email: email,
                kdfParamsJson: session.kdfParams,
                encryptedUserKey: session.encryptedUserKey,
                encryptedPrivateKey: session.encryptedPrivateKey)

            account = unlocked
            token = session.token
            api = client
            isUnlocked = true
            errorMessage = nil

            Keychain.set(server, for: Keychain.Key.serverURL)
            Keychain.set(email, for: Keychain.Key.email)
            Keychain.set(session.token, for: Keychain.Key.token)
            Keychain.set(session.kdfParams, for: Keychain.Key.kdfParams)
            Keychain.set(session.encryptedUserKey, for: Keychain.Key.encryptedUserKey)
            Keychain.set(session.encryptedPrivateKey, for: Keychain.Key.encryptedPrivateKey)

            proposeBiometricsIfPossible(password)
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Réouverture sans appel réseau : les blobs sont déjà dans le trousseau, seul le
    /// mot de passe manque. C'est ce chemin qu'emprunte l'extension AutoFill, qui doit
    /// pouvoir déverrouiller sans dépendre de la disponibilité du serveur.
    func unlockOffline(password: String) async {
        guard let email = Keychain.get(Keychain.Key.email),
            let kdf = Keychain.get(Keychain.Key.kdfParams),
            let euk = Keychain.get(Keychain.Key.encryptedUserKey),
            let epk = Keychain.get(Keychain.Key.encryptedPrivateKey),
            let server = Keychain.get(Keychain.Key.serverURL),
            let url = URL(string: server)
        else {
            errorMessage = "Aucune session enregistrée sur cet appareil."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            account = try Account.unlock(
                password: password, email: email, kdfParamsJson: kdf,
                encryptedUserKey: euk, encryptedPrivateKey: epk)
            token = Keychain.get(Keychain.Key.token)
            api = APIClient(baseURL: url)
            isUnlocked = true
            errorMessage = nil
            proposeBiometricsIfPossible(password)
            await refresh()
        } catch {
            errorMessage = "Mot de passe maître incorrect."
        }
    }

    /// Relâche les clés. Les blobs chiffrés restent, pour permettre une réouverture.
    func lock() {
        account = nil
        entries = []
        isUnlocked = false
        pendingPassword = nil
        offersBiometricEnrollment = false
    }

    /// Déconnexion : révoque la session côté serveur et efface tout localement.
    func signOut() async {
        if let api, let token {
            try? await api.logout(token: token)
        }
        lock()
        token = nil
        api = nil
        for key in [
            Keychain.Key.token, Keychain.Key.kdfParams, Keychain.Key.encryptedUserKey,
            Keychain.Key.encryptedPrivateKey, Keychain.Key.masterPassword,
            Keychain.Key.biometricsEnabled,
        ] {
            Keychain.remove(key)
        }
    }

    // ─── Biométrie ───

    /// Le bouton « Déverrouiller avec Face ID » a-t-il un sens ici et maintenant ?
    var canUnlockWithBiometrics: Bool {
        Biometrics.isAvailable
            && Keychain.get(Keychain.Key.biometricsEnabled) == "1"
            && hasSavedSession
    }

    var biometryLabel: String { Biometrics.label }

    /// Déverrouille sans saisie : la biométrie autorise la relecture du mot de passe
    /// maître, et c'est toujours lui qui ouvre le coffre côté Rust.
    func unlockWithBiometrics() async {
        guard Keychain.get(Keychain.Key.biometricsEnabled) == "1" else { return }
        isBusy = true
        let prompt = "Déverrouiller votre coffre GhostPass"
        // La demande biométrique bloque le fil sur lequel elle est faite.
        let password = await Task.detached {
            Keychain.getBiometric(Keychain.Key.masterPassword, prompt: prompt)
        }.value
        isBusy = false
        guard let password else {
            // Refus, échec, ou entrée invalidée par un nouvel enrôlement : on ne
            // reste pas coincé, le mot de passe maître marche toujours.
            errorMessage = "\(Biometrics.label) n'a pas permis d'ouvrir le coffre."
            return
        }
        await unlockOffline(password: password)
    }

    /// Retient le mot de passe le temps de poser la question, si elle a lieu d'être.
    private func proposeBiometricsIfPossible(_ password: String) {
        guard Biometrics.isAvailable,
            Keychain.get(Keychain.Key.biometricsEnabled) == nil
        else { return }
        pendingPassword = password
        offersBiometricEnrollment = true
    }

    /// L'utilisateur accepte : le mot de passe part au trousseau, sous garde biométrique.
    func enableBiometrics() {
        defer { pendingPassword = nil; offersBiometricEnrollment = false }
        guard let password = pendingPassword else { return }
        let status = Keychain.setBiometric(password, for: Keychain.Key.masterPassword)
        if status == errSecSuccess {
            Keychain.set("1", for: Keychain.Key.biometricsEnabled)
        } else {
            NSLog("GP-KEYCHAIN setBiometric a échoué : OSStatus %d", status)
            errorMessage = "\(Biometrics.label) n'a pas pu être activé (code \(status))."
        }
    }

    /// L'utilisateur refuse : on oublie le mot de passe, et on ne reposera pas la question
    /// à chaque ouverture — le drapeau distingue « refusé » de « jamais proposé ».
    func declineBiometrics() {
        pendingPassword = nil
        offersBiometricEnrollment = false
        Keychain.set("0", for: Keychain.Key.biometricsEnabled)
    }

    /// Retire le déverrouillage biométrique sans se déconnecter.
    func disableBiometrics() {
        Keychain.remove(Keychain.Key.masterPassword)
        Keychain.set("0", for: Keychain.Key.biometricsEnabled)
    }

    // ─── Coffre ───

    func refresh() async {
        guard let api, let token, let account else { return }
        do {
            let dtos = try await api.listItems(token: token)
            entries = dtos.compactMap { dto in
                guard let item = try? decrypt(dto, with: account) else { return nil }
                // L'item de registre des dossiers est un détail d'implémentation partagé
                // avec la web app : il n'a rien à faire dans la liste.
                guard item.name != VaultConstants.foldersItemName else { return nil }
                return VaultEntry(id: dto.id, item: item, updatedAt: dto.updatedAt)
            }
            .sorted { $0.item.name.localizedCaseInsensitiveCompare($1.item.name) == .orderedAscending }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save(_ item: VaultItem, id: String?) async {
        guard let api, let token, let account else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let (key, data) = try encrypt(item, with: account)
            if let id {
                _ = try await api.updateItem(
                    token: token, id: id, encryptedKey: key, encryptedData: data)
            } else {
                _ = try await api.createItem(token: token, encryptedKey: key, encryptedData: data)
            }
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(_ entry: VaultEntry) async {
        guard let api, let token else { return }
        do {
            try await api.deleteItem(token: token, id: entry.id)
            entries.removeAll { $0.id == entry.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // ─── Passage de frontière ───

    /// Le cœur échange des `EncryptedItem` en JSON (`encrypted_key` / `encrypted_data`),
    /// l'API les expose en camelCase et à plat. La conversion tient ici, en un seul endroit.
    private func decrypt(_ dto: EncryptedItemDTO, with account: Account) throws -> VaultItem {
        let envelope = ["encrypted_key": dto.encryptedKey, "encrypted_data": dto.encryptedData]
        let json = String(data: try JSONEncoder().encode(envelope), encoding: .utf8) ?? "{}"
        let clear = try account.decryptItem(encryptedItemJson: json)
        return try JSONDecoder().decode(VaultItem.self, from: Data(clear.utf8))
    }

    private func encrypt(_ item: VaultItem, with account: Account) throws -> (String, String) {
        let json = String(data: try JSONEncoder().encode(item), encoding: .utf8) ?? "{}"
        let encrypted = try account.encryptItem(itemJson: json)
        let fields = try JSONDecoder().decode(
            [String: String].self, from: Data(encrypted.utf8))
        guard let key = fields["encrypted_key"], let data = fields["encrypted_data"] else {
            throw APIError.malformedResponse
        }
        return (key, data)
    }
}
