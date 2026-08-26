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
    /// Le coffre affiché vient du disque, faute d'avoir pu joindre le serveur.
    @Published private(set) var isOffline = false
    /// Vrai juste après un déverrouillage réussi, quand la biométrie est disponible mais
    /// pas encore configurée : l'UI peut alors proposer de l'activer.
    @Published var offersBiometricEnrollment = false

    private var account: Account?
    private var token: String?
    private var api: APIClient?
    /// Mot de passe maître retenu le temps de proposer l'enrôlement biométrique, jamais
    /// au-delà : `enableBiometrics` et `declineBiometrics` l'effacent tous les deux.
    private var pendingPassword: String?

    var hasSavedSession: Bool { SharedStore.load() != nil }

    var savedEmail: String { SharedStore.load()?.email ?? "" }
    var savedServer: String { SharedStore.load()?.serverURL ?? "" }

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

            // Le jeton ouvre le compte côté serveur : il reste au trousseau. Les blobs,
            // eux, vont dans le conteneur partagé — l'extension de remplissage en a besoin
            // et le serveur les détient déjà.
            Keychain.set(session.token, for: Keychain.Key.token)
            SharedStore.save(
                SharedStore.Session(
                    serverURL: server, email: email, kdfParams: session.kdfParams,
                    encryptedUserKey: session.encryptedUserKey,
                    encryptedPrivateKey: session.encryptedPrivateKey))

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
        guard let session = SharedStore.load(), let url = URL(string: session.serverURL) else {
            errorMessage = "Aucune session enregistrée sur cet appareil."
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            account = try Account.unlock(
                password: password, email: session.email, kdfParamsJson: session.kdfParams,
                encryptedUserKey: session.encryptedUserKey,
                encryptedPrivateKey: session.encryptedPrivateKey)
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
        isOffline = false
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
        VaultCache.clear()
        for key in [
            Keychain.Key.token, Keychain.Key.masterPassword, Keychain.Key.biometricsEnabled,
        ] {
            Keychain.remove(key)
        }
        SharedStore.clear()
        await CredentialIdentities.clear()
    }

    // ─── Biométrie ───

    /// Le bouton « Déverrouiller avec Face ID » a-t-il un sens ici et maintenant ?
    var canUnlockWithBiometrics: Bool {
        Biometrics.isAvailable
            && Keychain.get(Keychain.Key.biometricsEnabled) == "1"
            && hasSavedSession
    }

    var biometryLabel: String { Biometrics.label }

    /// La biométrie est-elle disponible sur cet appareil, indépendamment du choix fait ?
    var biometryAvailable: Bool { Biometrics.isAvailable }

    /// Le déverrouillage biométrique est-il actif ?
    var isBiometricEnabled: Bool { Keychain.get(Keychain.Key.biometricsEnabled) == "1" }

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
        NSLog("GP-BIO relecture=%@", password == nil ? "échec" : "ok")
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

    /// L'utilisateur accepte la proposition faite juste après un déverrouillage : le mot
    /// de passe est encore en main, inutile de le redemander.
    func acceptOfferedBiometrics() {
        defer { pendingPassword = nil; offersBiometricEnrollment = false }
        guard let password = pendingPassword else { return }
        store(password)
    }

    /// Active la biométrie à froid, depuis les réglages. Le mot de passe maître n'est plus
    /// en mémoire : on le redemande, et surtout **on le vérifie** en rouvrant réellement le
    /// coffre avec — on ne dépose au trousseau qu'un secret dont on sait qu'il ouvre.
    @discardableResult
    func enableBiometrics(password: String) -> Bool {
        guard let session = SharedStore.load() else {
            errorMessage = "Aucune session enregistrée sur cet appareil."
            return false
        }
        do {
            _ = try Account.unlock(
                password: password, email: session.email, kdfParamsJson: session.kdfParams,
                encryptedUserKey: session.encryptedUserKey,
                encryptedPrivateKey: session.encryptedPrivateKey)
        } catch {
            errorMessage = "Mot de passe maître incorrect."
            return false
        }
        return store(password)
    }

    @discardableResult
    private func store(_ password: String) -> Bool {
        let status = Keychain.setBiometric(password, for: Keychain.Key.masterPassword)
        guard status == errSecSuccess else {
            errorMessage = "\(Biometrics.label) n'a pas pu être activé (code \(status))."
            return false
        }
        Keychain.set("1", for: Keychain.Key.biometricsEnabled)
        return true
    }

    /// L'utilisateur refuse : on oublie le mot de passe et on ne repose pas la question à
    /// chaque ouverture. Le refus n'est pas définitif : les réglages du coffre permettent
    /// de revenir dessus, sans quoi un « Plus tard » condamnerait la fonction.
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

    /// Recharge le coffre. La copie locale s'affiche d'abord : un coffre qui reste vide
    /// parce que le réseau manque n'est pas un coffre. Le serveur, lui, fait autorité dès
    /// qu'il répond.
    func refresh() async {
        guard let account else { return }
        if entries.isEmpty, let caches = VaultCache.load() {
            entries = Self.entries(from: caches, with: account)
            isOffline = true
        }
        guard let api, let token else { return }
        do {
            let dtos = try await api.listItems(token: token)
            VaultCache.save(dtos)
            entries = Self.entries(from: dtos, with: account)
            isOffline = false
            errorMessage = nil
            await CredentialIdentities.sync(entries)
        } catch {
            // Avec une copie locale sous la main, l'absence de réseau se signale sans
            // rien interrompre. Sans elle, il n'y a rien à montrer : c'est une erreur.
            isOffline = true
            errorMessage = entries.isEmpty ? error.localizedDescription : nil
        }
    }

    /// Déchiffre, écarte le registre interne, ordonne. Un item illisible est ignoré
    /// plutôt que de faire échouer la liste entière.
    private static func entries(from dtos: [EncryptedItemDTO], with account: Account)
        -> [VaultEntry]
    {
        dtos.compactMap { dto in
            guard let item = try? decrypt(dto, with: account), !isRegistry(item) else { return nil }
            return VaultEntry(id: dto.id, item: item, updatedAt: dto.updatedAt)
        }
        .sorted { $0.item.name.localizedCaseInsensitiveCompare($1.item.name) == .orderedAscending }
    }

    func save(_ item: VaultItem, id: String?) async {
        guard let api, let token, let account else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let (key, data) = try Self.encrypt(item, with: account)
            if let id {
                _ = try await api.updateItem(
                    token: token, id: id, encryptedKey: key, encryptedData: data)
            } else {
                _ = try await api.createItem(token: token, encryptedKey: key, encryptedData: data)
            }
            await refresh()
        } catch is URLError {
            // Écrire suppose le serveur : il n'y a pas de file d'attente hors ligne, et
            // laisser croire à un enregistrement serait pire que de le refuser.
            errorMessage = "Serveur injoignable : la modification n'a pas été enregistrée."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func delete(_ entry: VaultEntry) async {
        guard let api, let token else { return }
        do {
            try await api.deleteItem(token: token, id: entry.id)
            entries.removeAll { $0.id == entry.id }
            if let dtos = VaultCache.load() {
                VaultCache.save(dtos.filter { $0.id != entry.id })
            }
        } catch is URLError {
            errorMessage = "Serveur injoignable : la suppression n'a pas été enregistrée."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // ─── Passage de frontière ───
    //
    // `static` et non `private` : c'est la couture où le JSON du serveur rencontre celui
    // du cœur Rust, donc l'endroit exact où une divergence de contrat se paie. Les tests
    // l'exercent directement, sans monter ni session ni interface.

    /// Un item de registre interne — l'arborescence des dossiers partagée avec la web app —
    /// n'a rien à faire dans la liste. L'afficher serait une régression visible.
    nonisolated static func isRegistry(_ item: VaultItem) -> Bool {
        item.name == VaultConstants.foldersItemName
    }

    /// Le cœur échange des `EncryptedItem` en JSON (`encrypted_key` / `encrypted_data`),
    /// l'API les expose en camelCase et à plat. La conversion tient ici, en un seul endroit.
    nonisolated static func decrypt(_ dto: EncryptedItemDTO, with account: Account) throws
        -> VaultItem
    {
        let envelope = ["encrypted_key": dto.encryptedKey, "encrypted_data": dto.encryptedData]
        let json = String(data: try JSONEncoder().encode(envelope), encoding: .utf8) ?? "{}"
        let clear = try account.decryptItem(encryptedItemJson: json)
        return try JSONDecoder().decode(VaultItem.self, from: Data(clear.utf8))
    }

    nonisolated static func encrypt(_ item: VaultItem, with account: Account) throws
        -> (String, String)
    {
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
