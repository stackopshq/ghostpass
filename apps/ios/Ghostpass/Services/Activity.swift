import Foundation

/// Le journal du compte : qui s'est connecté, et ce qui a été fait de sensible.
///
/// C'est le seul endroit où l'on peut s'apercevoir qu'un accès n'était pas le sien. Un
/// journal illisible ne sert donc à rien : « mfa.disable » ne dit rien à personne, et c'est
/// justement la ligne qu'il faut remarquer.

/// Une connexion, telle que le serveur l'a enregistrée.
struct Connexion: Identifiable {
    let id: String
    let ip: String?
    let appareil: String?
    /// Un appareil jamais vu jusque-là. C'est ce qui mérite un regard.
    let nouvelAppareil: Bool
    let quand: Date

    init(_ dto: LoginEventDTO, rang: Int) {
        self.id = "\(rang)"
        self.ip = dto.ip
        self.appareil = dto.userAgent
        self.nouvelAppareil = dto.newDevice
        self.quand = Date(timeIntervalSince1970: TimeInterval(dto.createdAt) / 1000)
    }
}

/// Une action sensible sur le compte.
struct ActionDuJournal: Identifiable {
    let id: String
    let action: String
    let cible: String?
    let ip: String?
    let quand: Date

    init(_ dto: AuditEventDTO, rang: Int) {
        self.id = "\(rang)"
        self.action = dto.action
        self.cible = dto.target
        self.ip = dto.ip
        self.quand = Date(timeIntervalSince1970: TimeInterval(dto.createdAt) / 1000)
    }

    /// Ce que l'action veut dire, en français.
    ///
    /// Les identifiants inconnus sont rendus tels quels plutôt que masqués : une version
    /// plus récente du serveur peut en journaliser de nouveaux, et une ligne brute reste
    /// plus utile qu'une ligne absente — surtout dans un journal dont l'objet est de
    /// révéler l'inattendu.
    @MainActor
    var intitule: String {
        switch action {
        case "login.password": return tr("Connexion par mot de passe")
        case "login.passkey": return tr("Connexion par passkey")
        case "login.sso": return tr("Connexion par SSO")
        case "logout": return tr("Déconnexion")
        case "mfa.enable": return tr("Second facteur activé")
        case "mfa.disable": return tr("Second facteur désactivé")
        case "recovery.reset": return tr("Mot de passe réinitialisé par clé de récupération")
        case "passkey.add": return tr("Passkey ajoutée")
        case "passkey.remove": return tr("Passkey retirée")
        case "webauthn.add": return tr("Clé de sécurité ajoutée")
        case "webauthn.remove": return tr("Clé de sécurité retirée")
        case "emergency.grant": return tr("Accès d'urgence confié")
        case "emergency.request": return tr("Accès d'urgence demandé")
        case "emergency.approve": return tr("Accès d'urgence accordé")
        case "org.member.add": return tr("Membre ajouté à une équipe")
        case "org.member.role": return tr("Rôle d'un membre modifié")
        case "org.key.rotate": return tr("Clé d'équipe renouvelée")
        case "org.group.create": return tr("Groupe créé")
        case "org.group.delete": return tr("Groupe supprimé")
        case "org.group.member.add": return tr("Membre ajouté à un groupe")
        case "org.group.member.remove": return tr("Membre retiré d'un groupe")
        case "org.group.access.grant": return tr("Accès accordé à une collection")
        case "org.group.access.revoke": return tr("Accès retiré à une collection")
        default: return action
        }
    }

    /// Les actions qui méritent d'être remarquées : elles retirent une protection ou
    /// ouvrent le coffre à quelqu'un d'autre. Les voir surlignées évite de les manquer au
    /// milieu de connexions ordinaires.
    var estSensible: Bool {
        [
            "mfa.disable", "recovery.reset", "passkey.remove", "webauthn.remove",
            "emergency.approve", "org.member.add", "org.key.rotate",
            "org.group.access.grant",
        ].contains(action)
    }
}
