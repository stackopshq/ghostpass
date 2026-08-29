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

    /// Ce qu'iOS est venu chercher. Le même écran sert les deux, mais pas avec le même
    /// contenu : en mode code, une entrée sans secret TOTP n'a rien à offrir et ne doit
    /// pas figurer dans la liste.
    enum Demande {
        case motDePasse
        case codeAUsageUnique
    }
    var demande: Demande = .motDePasse

    var onPick: ((String, String) -> Void)?
    /// Rendre un code calculé. Distinct de `onPick` : iOS attend un autre type de réponse,
    /// et se tromper de méthode de complétion laisse la requête sans réponse.
    var onPickCode: ((String) -> Void)?
    var onCancel: (() -> Void)?

    var account: String { SharedStore.load()?.email ?? "" }
    var hasSession: Bool { SharedStore.load() != nil }

    /// Le conteneur partagé est-il réellement accessible ?
    ///
    /// Sans lui, l'extension lit son propre conteneur privé — vide — et conclut qu'aucune
    /// session n'existe. Le message « ouvrez GhostPass une fois » serait alors un
    /// contresens : l'application a été ouverte, c'est le groupe qui manque.
    ///
    /// Le cas se produit sur une compilation signée avec un profil qui n'accorde pas le
    /// groupe d'applications — un compte de développement personnel, typiquement, avant
    /// qu'un compte payant ne permette de l'enregistrer. L'application, elle, continue de
    /// fonctionner : `SharedStore` retombe sur son conteneur privé.
    var partageActif: Bool { SharedStore.isShared }
    var canUseBiometrics: Bool {
        Biometrics.isAvailable && Keychain.get(Keychain.Key.biometricsEnabled) == "1"
    }
    var biometryLabel: String { Biometrics.label }

    /// Les entrées dont une adresse correspond au domaine demandé, d'abord ; le reste
    /// ensuite, car un identifiant peut servir sur un domaine que le coffre ignore.
    var suggested: [VaultEntry] { proposables.filter { matches($0) } }
    var others: [VaultEntry] { proposables.filter { !matches($0) } }

    /// Les entrées qui peuvent répondre à la demande en cours.
    private var proposables: [VaultEntry] {
        switch demande {
        case .motDePasse: return entries
        case .codeAUsageUnique: return entries.filter { code(pour: $0) != nil }
        }
    }

    /// Le code de cette entrée, s'il est calculable. Sert deux fois : à filtrer la liste,
    /// et à l'afficher — un code visible se recopie à la main si le remplissage échoue.
    func code(pour entry: VaultEntry) -> String? {
        guard let secret = entry.login?.totp, let config = Totp.parse(secret) else {
            return nil
        }
        return Totp.code(for: config)?.code
    }

    private func matches(_ entry: VaultEntry) -> Bool {
        SiteMatching.matches(entry.item, domains: domains)
    }

    // ─── Déverrouillage ───

    func unlock(password: String) async {
        guard let session = SharedStore.load() else {
            errorMessage =
                partageActif
                ? tr("Ouvrez GhostPass une fois pour activer le remplissage.")
                : tr(
                    "Le conteneur partagé n'est pas accessible : cette version de l'application n'a pas le groupe d'applications. Le remplissage ne peut pas lire le coffre."
                )
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
        let prompt = tr("Remplir depuis votre coffre GhostPass")
        let lecture = await Task.detached {
            Keychain.getBiometric(Keychain.Key.masterPassword, prompt: prompt)
        }.value
        isBusy = false
        switch lecture {
        case .succes(let password):
            await unlock(password: password)
        case .interrompue, .indisponible:
            // Même règle que dans l'application : ne rien reprocher à une protection qui
            // ne s'est pas présentée. Le champ du mot de passe maître reste là.
            break
        case .echec:
            errorMessage = tr("\(Biometrics.label) n'a pas permis d'ouvrir le coffre.")
        }
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
        if !entries.isEmpty && proposables.isEmpty && demande == .codeAUsageUnique {
            // Le coffre n'est pas vide : il ne contient simplement aucun code. Le dire,
            // plutôt que de laisser croire que le déchiffrement a échoué.
            errorMessage = tr("Aucun compte du coffre n'a de code à usage unique.")
        } else {
            errorMessage =
                entries.isEmpty ? tr("Aucun identifiant dans la copie locale du coffre.") : nil
        }

        // iOS peut désigner l'entrée attendue : la fournir sans rien demander de plus.
        if let requested, let entry = entries.first(where: { $0.id == requested }) {
            pick(entry)
        }
    }

    func pick(_ entry: VaultEntry) {
        switch demande {
        case .motDePasse:
            guard let login = entry.login else { return }
            onPick?(login.username, login.password)
        case .codeAUsageUnique:
            // Recalculé au moment du choix, jamais réutilisé depuis l'affichage : entre les
            // deux, la fenêtre de trente secondes a pu tourner et le code livré serait périmé.
            guard let code = code(pour: entry) else {
                errorMessage = tr("Ce compte n'a pas de code à usage unique exploitable.")
                return
            }
            onPickCode?(code)
        }
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
