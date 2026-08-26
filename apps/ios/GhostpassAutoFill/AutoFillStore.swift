import Foundation

/// État de l'extension de remplissage.
///
/// Elle ne parle pas au serveur : tout vient du conteneur partagé, déposé par
/// l'application. Un remplissage doit aboutir en quelques secondes, dans un contexte où
/// le réseau peut manquer — et l'extension n'a de toute façon pas de session à elle.
@MainActor
final class AutoFillStore: ObservableObject {
    @Published private(set) var entries: [VaultEntry] = []
    @Published private(set) var isUnlocked = false
    @Published private(set) var isBusy = false
    @Published var errorMessage: String?

    /// Domaines du champ qui réclame un identifiant, pour remonter les entrées qui
    /// correspondent.
    var domains: [String] = []
    /// Identifiant précis attendu, quand iOS en désigne un.
    var requested: String?

    var onPick: ((String, String) -> Void)?
    var onCancel: (() -> Void)?

    var account: String { SharedStore.load()?.email ?? "" }
    var hasSession: Bool { SharedStore.load() != nil }
    var canUseBiometrics: Bool {
        Biometrics.isAvailable && Keychain.get(Keychain.Key.biometricsEnabled) == "1"
    }
    var biometryLabel: String { Biometrics.label }

    /// Les entrées dont une adresse correspond au domaine demandé, d'abord ; le reste
    /// ensuite, car un identifiant peut servir sur un domaine que le coffre ignore.
    var suggested: [VaultEntry] { entries.filter { matches($0) } }
    var others: [VaultEntry] { entries.filter { !matches($0) } }

    private func matches(_ entry: VaultEntry) -> Bool {
        SiteMatching.matches(entry.item, domains: domains)
    }

    // ─── Déverrouillage ───

    func unlock(password: String) async {
        guard let session = SharedStore.load() else {
            errorMessage = tr("Ouvrez GhostPass une fois pour activer le remplissage.")
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let account = try Account.unlock(
                password: password, email: session.email, kdfParamsJson: session.kdfParams,
                encryptedUserKey: session.encryptedUserKey,
                encryptedPrivateKey: session.encryptedPrivateKey)
            load(with: account)
        } catch {
            errorMessage = tr("Mot de passe maître incorrect.")
        }
    }

    func unlockWithBiometrics() async {
        guard canUseBiometrics else { return }
        isBusy = true
        let prompt = "Remplir depuis votre coffre GhostPass"
        let password = await Task.detached {
            Keychain.getBiometric(Keychain.Key.masterPassword, prompt: prompt)
        }.value
        isBusy = false
        guard let password else {
            errorMessage = tr("\(Biometrics.label) n'a pas permis d'ouvrir le coffre.")
            return
        }
        await unlock(password: password)
    }

    /// Déchiffre la copie locale. Pas d'appel réseau : le remplissage doit aboutir même
    /// dans un ascenseur, et l'extension n'a pas de session à elle.
    private func load(with account: Account) {
        let dtos = VaultCache.load() ?? []
        entries = dtos.compactMap { dto in
            guard let item = try? VaultStore.decrypt(dto, with: account),
                !VaultStore.isRegistry(item), item.data.isLogin
            else { return nil }
            return VaultEntry(id: dto.id, item: item, updatedAt: dto.updatedAt)
        }
        .sorted { $0.item.name.localizedCaseInsensitiveCompare($1.item.name) == .orderedAscending }
        isUnlocked = true
        errorMessage = entries.isEmpty ? "Aucun identifiant dans la copie locale du coffre." : nil

        // iOS peut désigner l'entrée attendue : la fournir sans rien demander de plus.
        if let requested, let entry = entries.first(where: { $0.id == requested }) {
            pick(entry)
        }
    }

    func pick(_ entry: VaultEntry) {
        guard let login = entry.login else { return }
        onPick?(login.username, login.password)
    }

    func cancel() { onCancel?() }
}

extension ItemData {
    /// Seuls les identifiants ont un nom d'utilisateur et un mot de passe à remplir.
    var isLogin: Bool {
        if case .login = self { return true }
        return false
    }
}
