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
    /// Dossiers **vides**, ceux qu'aucun élément n'habite. Les autres se déduisent des
    /// éléments eux-mêmes ; seuls ceux-ci ont besoin d'être écrits quelque part, faute
    /// de quoi créer un dossier avant d'y ranger quoi que ce soit ne laisserait aucune
    /// trace. C'est le rôle de l'item de registre, partagé avec la web app.
    @Published private(set) var emptyFolders: [String] = []
    /// Les éléments mis en favori, par identifiant. Un favori n'est pas une propriété de
    /// l'élément — le modèle du cœur Rust n'en a pas — mais une liste tenue à part, dans
    /// son propre registre chiffré.
    @Published private(set) var favorites: Set<String> = []
    /// Identité de chaque registre, par nom, pour les mettre à jour plutôt que les
    /// multiplier. Un registre absent de ce dictionnaire n'existe pas encore côté serveur.
    private var registryIDs: [String: String] = [:]
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
            errorMessage = tr("Aucune session enregistrée sur cet appareil.")
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
            errorMessage = tr("Mot de passe maître incorrect.")
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
        emptyFolders = []
        favorites = []
        registryIDs = [:]
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
    var biometryIcon: String { Biometrics.icon }

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
            errorMessage = tr("\(Biometrics.label) n'a pas permis d'ouvrir le coffre.")
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
        NSLog("GP-BIO proposition")
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
            errorMessage = tr("Aucune session enregistrée sur cet appareil.")
            return false
        }
        do {
            _ = try Account.unlock(
                password: password, email: session.email, kdfParamsJson: session.kdfParams,
                encryptedUserKey: session.encryptedUserKey,
                encryptedPrivateKey: session.encryptedPrivateKey)
        } catch {
            errorMessage = tr("Mot de passe maître incorrect.")
            return false
        }
        return store(password)
    }

    @discardableResult
    private func store(_ password: String) -> Bool {
        let status = Keychain.setBiometric(password, for: Keychain.Key.masterPassword)
        guard status == errSecSuccess else {
            errorMessage = tr("\(Biometrics.label) n'a pas pu être activé (code \(status)).")
            return false
        }
        Keychain.set("1", for: Keychain.Key.biometricsEnabled)
        return true
    }

    /// L'utilisateur refuse : on oublie le mot de passe et on ne repose pas la question à
    /// chaque ouverture. Le refus n'est pas définitif : les réglages du coffre permettent
    /// de revenir dessus, sans quoi un « Plus tard » condamnerait la fonction.
    func declineBiometrics() {
        NSLog("GP-BIO refus")
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
            appliquer(Self.lecture(caches, account))
            isOffline = true
        }
        guard let api, let token else { return }
        do {
            let dtos = try await api.listItems(token: token)
            VaultCache.save(dtos)
            appliquer(Self.lecture(dtos, account))
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
        lecture(dtos, account).entries
    }

    /// Ce qu'un tour de déchiffrement rapporte : les éléments, et les registres cueillis
    /// au passage. Ils traversent la liste comme les autres éléments — autant les prendre
    /// là plutôt que de refaire un tour pour eux seuls.
    struct Lecture {
        var entries: [VaultEntry] = []
        var folders: [String] = []
        var favorites: Set<String> = []
        /// Identité serveur de chaque registre, par nom.
        var registryIDs: [String: String] = [:]
    }

    nonisolated static func lecture(_ dtos: [EncryptedItemDTO], _ account: Account) -> Lecture {
        var resultat = Lecture()

        for dto in dtos {
            guard let item = try? decrypt(dto, with: account) else { continue }
            if isRegistry(item) {
                resultat.registryIDs[item.name] = dto.id
                let liste = contenuDeRegistre(item)
                switch item.name {
                case VaultConstants.foldersItemName: resultat.folders = liste
                case VaultConstants.favoritesItemName: resultat.favorites = Set(liste)
                // Un registre d'une version plus récente, ou d'un autre produit de la
                // suite : on ne sait pas le lire, mais on sait ne pas l'afficher.
                default: break
                }
                continue
            }
            resultat.entries.append(VaultEntry(id: dto.id, item: item, updatedAt: dto.updatedAt))
        }

        resultat.entries.sort {
            $0.item.name.localizedCaseInsensitiveCompare($1.item.name) == .orderedAscending
        }
        resultat.folders.sort { $0.localizedCompare($1) == .orderedAscending }
        return resultat
    }

    /// Un registre est un `SecureNote` dont le contenu est un tableau JSON de chaînes.
    /// Illisible, il vaut mieux le tenir pour vide que faire échouer toute la lecture.
    nonisolated private static func contenuDeRegistre(_ item: VaultItem) -> [String] {
        guard case .secureNote(let note) = item.data,
            let data = note.content.data(using: .utf8),
            let liste = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return liste
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
            errorMessage = tr("Serveur injoignable : la modification n'a pas été enregistrée.")
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
            errorMessage = tr("Serveur injoignable : la suppression n'a pas été enregistrée.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func appliquer(_ lecture: Lecture) {
        entries = lecture.entries
        registryIDs = lecture.registryIDs
        emptyFolders = lecture.folders
        favorites = lecture.favorites
    }

    // ─── Dossiers ───

    /// Tous les chemins de dossiers : ceux qu'habitent des éléments, et ceux que le
    /// registre garde en mémoire faute d'occupant.
    var folderPaths: [String] {
        let occupes = entries.compactMap { $0.item.folder }.filter { !$0.isEmpty }
        return Array(Set(occupes).union(emptyFolders))
            .sorted { $0.localizedCompare($1) == .orderedAscending }
    }

    /// Combien d'éléments habitent ce dossier — ses sous-dossiers compris, sans quoi un
    /// dossier parent paraîtrait vide alors qu'il ne l'est pas.
    func itemCount(in path: String) -> Int {
        entries.filter { entry in
            guard let folder = entry.item.folder else { return false }
            return folder == path || folder.hasPrefix(path + "/")
        }
        .count
    }

    /// Crée un dossier vide. Un chemin est normalisé — sans blancs ni barres aux extrémités —
    /// car « Travail/ » et « Travail » désignent le même endroit et ne doivent pas coexister.
    func createFolder(_ chemin: String) async {
        let path = Self.normaliser(chemin)
        guard !path.isEmpty, !folderPaths.contains(path) else { return }
        emptyFolders = (emptyFolders + [path])
            .sorted { $0.localizedCompare($1) == .orderedAscending }
        await saveFolders()
    }

    /// Retire un dossier du registre, ses sous-dossiers avec lui. Les éléments qui s'y
    /// trouvent ne bougent pas : supprimer un rangement n'est pas supprimer ce qu'il range.
    func removeFolder(_ path: String) async {
        emptyFolders.removeAll { $0 == path || $0.hasPrefix(path + "/") }
        await saveFolders()
    }

    nonisolated static func normaliser(_ chemin: String) -> String {
        chemin.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func saveFolders() async {
        await enregistrerRegistre(
            VaultConstants.foldersItemName, emptyFolders,
            echec: tr("Serveur injoignable : les dossiers n'ont pas été enregistrés."))
    }

    // ─── Favoris ───

    /// Les favoris, dans l'ordre du coffre. Un identifiant qui ne correspond plus à rien —
    /// l'élément a été supprimé ailleurs — disparaît de lui-même : le registre garde une
    /// trace inoffensive, que la prochaine écriture nettoie.
    var favoriteEntries: [VaultEntry] {
        entries.filter { favorites.contains($0.id) }
    }

    func isFavorite(_ entry: VaultEntry) -> Bool { favorites.contains(entry.id) }

    func toggleFavorite(_ entry: VaultEntry) async {
        if favorites.contains(entry.id) {
            favorites.remove(entry.id)
        } else {
            favorites.insert(entry.id)
        }
        // On ne réécrit que ce qui existe encore : sans ce filtrage, le registre
        // accumulerait les identifiants d'éléments supprimés depuis longtemps.
        let vivants = Set(entries.map(\.id))
        favorites.formIntersection(vivants)
        await enregistrerRegistre(
            VaultConstants.favoritesItemName, favorites.sorted(),
            echec: tr("Serveur injoignable : les favoris n'ont pas été enregistrés."))
    }

    // ─── Import ───

    /// Dépose une fournée d'items d'un coup. Un seul rechargement à la fin : rafraîchir le
    /// coffre après chaque ligne d'un fichier de deux cents entrées ferait deux cents
    /// allers-retours pour rien, et l'écran clignoterait tout du long.
    ///
    /// Rend le nombre d'items effectivement déposés. En cas de coupure à mi-chemin, ceux
    /// qui sont passés restent : le dire vaut mieux que laisser croire à un échec total.
    @discardableResult
    func importItems(_ items: [VaultItem]) async -> Int {
        guard let api, let token, let account else { return 0 }
        isBusy = true
        defer { isBusy = false }
        var deposes = 0
        do {
            for item in items {
                let (key, data) = try Self.encrypt(item, with: account)
                _ = try await api.createItem(token: token, encryptedKey: key, encryptedData: data)
                deposes += 1
            }
        } catch is URLError {
            errorMessage = tr("Serveur injoignable : l'import s'est arrêté en chemin.")
        } catch {
            errorMessage = error.localizedDescription
        }
        await refresh()
        return deposes
    }

    // ─── Récupération de compte ───

    /// Fabrique un kit de récupération et le dépose au serveur. Rend la clé à afficher —
    /// une seule fois, car personne ne la conserve : ni le serveur, qui n'en reçoit qu'une
    /// preuve re-hachée, ni l'application. C'est tout l'intérêt, et c'est aussi ce qui
    /// rend l'écran qui l'affiche irremplaçable.
    func createRecoveryKit() async -> String? {
        guard let api, let token, let account else { return nil }
        isBusy = true
        defer { isBusy = false }
        do {
            let json = try account.createRecovery()
            let kit = try JSONDecoder().decode(RecoveryKit.self, from: Data(json.utf8))
            try await api.enrollRecovery(
                token: token, recoveryAuthHash: kit.recoveryAuthHash,
                encryptedUserKeyRecovery: kit.encryptedUserKeyRecovery)
            errorMessage = nil
            return kit.recoveryKey
        } catch is URLError {
            errorMessage = tr("Serveur injoignable : la clé de récupération n'a pas été enregistrée.")
        } catch {
            errorMessage = error.localizedDescription
        }
        return nil
    }

    /// Réinitialise le mot de passe maître à partir de la clé de récupération.
    ///
    /// Rien n'est déverrouillé ici : le serveur invalide toutes les sessions, et c'est
    /// voulu — si quelqu'un a réinitialisé le mot de passe, les sessions ouvertes ailleurs
    /// n'ont plus lieu d'être. L'utilisateur se reconnecte ensuite, avec le nouveau.
    func recoverAccount(server: String, email: String, recoveryKey: String, newPassword: String)
        async -> Bool
    {
        guard let url = URL(string: server) else {
            errorMessage = tr("Adresse de serveur invalide.")
            return false
        }
        isBusy = true
        defer { isBusy = false }
        let client = APIClient(baseURL: url)
        do {
            let blob = try await client.recoveryBlob(email: email)
            // `recover` est une fonction libre du binding, pas une méthode d'`Account` :
            // il n'y a pas encore de compte ouvert au moment où on l'appelle.
            let resultat = try recover(
                recoveryKey: recoveryKey.trimmingCharacters(in: .whitespacesAndNewlines),
                email: email, newPassword: newPassword, kdfParamsJson: blob.kdfParams,
                encryptedUserKeyRecovery: blob.encryptedUserKeyRecovery,
                encryptedPrivateKey: blob.encryptedPrivateKey)
            let reset = try JSONDecoder().decode(ResetBlob.self, from: Data(resultat.reset().utf8))
            try await client.recover(
                email: email, recoveryAuthHash: reset.recoveryAuthHash,
                newMasterPasswordHash: reset.masterPasswordHash,
                newEncryptedUserKey: reset.encryptedUserKey)
            errorMessage = nil
            return true
        } catch is URLError {
            errorMessage = tr("Serveur injoignable.")
        } catch is DecodingError {
            errorMessage = tr("Réponse du serveur incompréhensible.")
        } catch {
            // Le serveur répond de la même façon pour une clé fausse et pour un compte
            // sans kit : le dire autrement révélerait lequel des deux.
            errorMessage = tr("Clé de récupération refusée.")
        }
        return false
    }

    /// Le JSON que rend `createRecovery()`. Les noms sont ceux de serde, côté Rust.
    private struct RecoveryKit: Decodable {
        let recoveryKey: String
        let recoveryAuthHash: String
        let encryptedUserKeyRecovery: String

        enum CodingKeys: String, CodingKey {
            case recoveryKey = "recovery_key"
            case recoveryAuthHash = "recovery_auth_hash"
            case encryptedUserKeyRecovery = "encrypted_user_key_recovery"
        }
    }

    /// Le JSON que rend `RecoveryResult.reset()`, à transmettre tel quel au serveur.
    private struct ResetBlob: Decodable {
        let masterPasswordHash: String
        let recoveryAuthHash: String
        let encryptedUserKey: String

        enum CodingKeys: String, CodingKey {
            case masterPasswordHash = "master_password_hash"
            case recoveryAuthHash = "recovery_auth_hash"
            case encryptedUserKey = "encrypted_user_key"
        }
    }

    // ─── Registres ───

    /// Écrit un registre : un `SecureNote` dont le contenu est un tableau JSON, sous un nom
    /// que l'interface masque. Même format que la web app, au caractère près.
    private func enregistrerRegistre(
        _ nom: String, _ valeurs: [String], echec: String
    ) async {
        guard let api, let token, let account else { return }
        let contenu = String(
            decoding: (try? JSONEncoder().encode(valeurs)) ?? Data("[]".utf8), as: UTF8.self)
        let item = VaultItem(
            name: nom, notes: nil, folder: nil,
            data: .secureNote(SecureNote(content: contenu)))
        do {
            let (key, data) = try Self.encrypt(item, with: account)
            if let identifiant = registryIDs[nom] {
                _ = try await api.updateItem(
                    token: token, id: identifiant, encryptedKey: key, encryptedData: data)
            } else {
                let cree = try await api.createItem(
                    token: token, encryptedKey: key, encryptedData: data)
                registryIDs[nom] = cree.id
            }
            await refresh()
        } catch is URLError {
            errorMessage = echec
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // ─── Corbeille ───

    /// Les items supprimés, déchiffrés à la demande. Ils ne sont pas conservés dans
    /// `entries` : la corbeille se consulte, elle n'encombre pas le coffre.
    func loadTrash() async -> [VaultEntry] {
        guard let api, let token, let account else { return [] }
        do {
            let dtos = try await api.listTrash(token: token)
            errorMessage = nil
            return Self.entries(from: dtos, with: account)
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    func restore(_ entry: VaultEntry) async {
        guard let api, let token else { return }
        do {
            try await api.restoreItem(token: token, id: entry.id)
            await refresh()
        } catch is URLError {
            errorMessage = tr("Serveur injoignable : l'item n'a pas été restauré.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Suppression définitive. Rien ne la rattrape : l'appelant doit avoir demandé
    /// confirmation avant d'arriver ici.
    func purge(_ entry: VaultEntry) async {
        guard let api, let token else { return }
        do {
            try await api.purgeItem(token: token, id: entry.id)
        } catch is URLError {
            errorMessage = tr("Serveur injoignable : l'item n'a pas été supprimé.")
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
        item.name.hasPrefix(VaultConstants.registryPrefix)
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
