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

    /// Fournir l'identifiant désigné sans demander ? **Non**, tant que ce chemin n'aura
    /// pas été compris — voir le commentaire de `load`. Un drapeau nommé plutôt qu'un code
    /// retiré : l'effacer ferait disparaître avec lui ce qu'on a appris en essayant.
    private static let fournitureAutomatique = false

    /// L'hôte a-t-il rendu l'extension active ?
    ///
    /// `completeRequest` pendant la transition qui suit la demande Face ID part sans
    /// remplir : la feuille se ferme, et les champs restent vides. Un choix **manuel**
    /// n'a jamais ce problème — il arrive forcément après l'activation. C'est le choix
    /// **automatique**, quand iOS désigne déjà l'identifiant attendu, qui tombe au mauvais
    /// moment, et ce chemin n'a pu s'exécuter qu'à partir du jour où des identifiants ont
    /// enfin été proposés.
    ///
    /// Vrai par défaut : sans demande biométrique, aucune notification ne viendra, et il
    /// ne faut pas retenir une fourniture qui n'a aucune raison d'attendre.
    var hoteActif = true

    /// L'entrée à fournir dès que l'hôte sera actif.
    private var enAttenteDeFourniture: VaultEntry?

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
    var biometryIcon: String { Biometrics.icon }

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

    /// Rend `false` quand la question **n'a pas pu être posée** — voir la même règle dans
    /// `VaultStore`. Le trousseau refuse tant que l'hôte n'a pas rendu l'extension active,
    /// et c'est l'état de son premier `onAppear` : sans cette distinction, le
    /// déclenchement automatique se consomme dans le vide et il faut toucher l'icône.
    @discardableResult
    func unlockWithBiometrics() async -> Bool {
        guard canUseBiometrics else { return false }
        isBusy = true
        let prompt = tr("Remplir depuis votre coffre GhostPass")
        let lecture = await Task.detached {
            Keychain.getBiometric(Keychain.Key.masterPassword, prompt: prompt)
        }.value
        isBusy = false
        switch lecture {
        case .succes(let password):
            await unlock(password: password)
            return true
        case .interrompue:
            // Un refus explicite : on ne redemande pas. Le champ du mot de passe maître
            // reste là, et on ne reproche rien à une protection qui n'a pas échoué.
            return true
        case .indisponible:
            // La question n'a pas été posée. L'appelant doit pouvoir la reprendre quand
            // l'hôte rend l'extension active.
            return false
        case .echec:
            errorMessage = tr("\(Biometrics.label) n'a pas permis d'ouvrir le coffre.")
            return true
        }
    }

    /// Les identifiants rangés en organisation.
    ///
    /// Ils manquaient entièrement : `VaultCache` ne dépose que le coffre personnel, si
    /// bien qu'un compte dont tous les mots de passe vivent en équipe donnait une copie
    /// locale vide — et « Aucun identifiant » sur tous les sites. Voir `TeamCache`.
    ///
    /// L'Org Key se déballe ici comme dans l'application, avec la clé privée du compte et
    /// les deux blobs déposés. Aucun réseau : c'est la règle de l'extension.
    ///
    /// Une organisation qui ne s'ouvre pas est **ignorée sans un mot**, contrairement à
    /// l'application qui montre le trou. Le remplissage n'est pas un endroit où lire un
    /// diagnostic : il doit aboutir en quelques secondes, et une ligne « illisible » n'y
    /// serait jamais remplissable. Le coffre personnel, lui, reste proposé.
    private func coffresDEquipe(with account: Account) -> [VaultEntry] {
        guard let coffres = TeamCache.load() else { return [] }
        var trouvees: [VaultEntry] = []
        for coffre in coffres {
            guard
                let org = try? account.openOrg(
                    adminPublicKey: coffre.adminPublicKey, sealed: coffre.encryptedOrgKey)
            else { continue }
            for dto in coffre.items {
                guard let item = try? org.ouvrir(dto),
                    !VaultStore.isRegistry(item), item.data.isLogin
                else { continue }
                trouvees.append(VaultEntry(id: dto.id, item: item, updatedAt: dto.updatedAt))
            }
        }
        return trouvees
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
        entries += coffresDEquipe(with: account)
        entries.sort {
            $0.item.name.localizedCaseInsensitiveCompare($1.item.name) == .orderedAscending
        }
        isUnlocked = true
        if !entries.isEmpty && proposables.isEmpty && demande == .codeAUsageUnique {
            // Le coffre n'est pas vide : il ne contient simplement aucun code. Le dire,
            // plutôt que de laisser croire que le déchiffrement a échoué.
            errorMessage = tr("Aucun compte du coffre n'a de code à usage unique.")
        } else {
            errorMessage =
                entries.isEmpty ? tr("Aucun identifiant dans la copie locale du coffre.") : nil
        }

        // iOS peut désigner l'entrée attendue. On ne la fournit **plus** sans rien
        // demander, et ce retrait est une reddition documentée, pas une préférence.
        //
        // Ce qui est établi : un choix **manuel** remplit les champs, un choix
        // **automatique** ferme la feuille sans rien remplir. Le chemin automatique n'a pu
        // s'exécuter qu'à partir du moment où des identifiants ont enfin été proposés — il
        // n'avait donc jamais été éprouvé.
        //
        // Ce qui a été essayé, sans succès : différer la fourniture jusqu'à
        // `NSExtensionHostDidBecomeActive`, sur l'hypothèse que `completeRequest` pendant
        // la transition qui suit Face ID partait dans le vide. La feuille reste
        // effectivement visible deux secondes de plus — donc l'appel a bien lieu après
        // l'activation — et le remplissage n'a toujours pas lieu. L'hypothèse est écartée.
        //
        // Ce qui reste à vérifier, et qui demande un moyen de lire ce que l'extension
        // fournit réellement : que `login.username` et `login.password` ne soient pas
        // vides pour cette entrée-là, et que l'identité enregistrée porte le même
        // `user` que ce qu'on renvoie — Safari peut écarter une réponse qui ne
        // correspond pas à l'identité qu'il a désignée.
        //
        // En attendant, la liste s'affiche avec l'entrée attendue en tête : un geste au
        // lieu de zéro, sur un chemin qui fonctionne.
        if Self.fournitureAutomatique, let requested,
            let entry = entries.first(where: { $0.id == requested })
        {
            fournir(entry)
        }
    }

    /// Fournit maintenant, ou retient jusqu'à l'activation de l'hôte.
    private func fournir(_ entry: VaultEntry) {
        if hoteActif {
            pick(entry)
        } else {
            enAttenteDeFourniture = entry
        }
    }

    /// Appelé quand l'hôte redevient actif. Vide la fourniture retenue, s'il y en a une.
    func hoteEstActif() {
        hoteActif = true
        guard let entry = enAttenteDeFourniture else { return }
        enAttenteDeFourniture = nil
        pick(entry)
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
