package ch.stackops.ghostpass

/**
 * Le journal du compte : qui s'est connecté, et ce qui a été fait de sensible.
 *
 * **C'est le seul endroit où l'on peut s'apercevoir qu'un accès n'était pas le sien.** Un
 * journal illisible ne sert donc à rien : « mfa.disable » ne dit rien à personne, et c'est
 * justement la ligne qu'il faut remarquer.
 *
 * La traduction et le classement vivent ici, dans `:noyau`, et non dans l'écran : ce sont
 * des règles — quelle action est sensible, comment elle se nomme en français — et une règle
 * enfouie dans un `when` de composable ne s'éprouve qu'à l'œil.
 */
object JournalDuCompte {

    /**
     * Ce qu'une action veut dire, en français.
     *
     * **Les identifiants inconnus sont rendus tels quels plutôt que masqués.** Une version
     * plus récente du serveur peut en journaliser de nouveaux, et une ligne brute reste plus
     * utile qu'une ligne absente — surtout dans un journal dont l'objet est de révéler
     * l'inattendu. Masquer ce qu'on ne connaît pas reviendrait à cacher précisément la
     * nouveauté qu'on cherche.
     */
    fun intitule(action: String): String = when (action) {
        "login.password" -> "Connexion par mot de passe"
        "login.passkey" -> "Connexion par passkey"
        "login.sso" -> "Connexion par SSO"
        "logout" -> "Déconnexion"
        "mfa.enable" -> "Second facteur activé"
        "mfa.disable" -> "Second facteur désactivé"
        "recovery.reset" -> "Mot de passe réinitialisé par clé de récupération"
        "passkey.add" -> "Passkey ajoutée"
        "passkey.remove" -> "Passkey retirée"
        "webauthn.add" -> "Clé de sécurité ajoutée"
        "webauthn.remove" -> "Clé de sécurité retirée"
        "emergency.grant" -> "Accès d'urgence confié"
        "emergency.request" -> "Accès d'urgence demandé"
        "emergency.approve" -> "Accès d'urgence accordé"
        "org.member.add" -> "Membre ajouté à une équipe"
        "org.member.role" -> "Rôle d'un membre modifié"
        "org.key.rotate" -> "Clé d'équipe renouvelée"
        "org.group.create" -> "Groupe créé"
        "org.group.delete" -> "Groupe supprimé"
        "org.group.member.add" -> "Membre ajouté à un groupe"
        "org.group.member.remove" -> "Membre retiré d'un groupe"
        "org.group.access.grant" -> "Accès accordé à une collection"
        "org.group.access.revoke" -> "Accès retiré à une collection"
        else -> action
    }

    /**
     * Les actions qui méritent d'être remarquées.
     *
     * Elles **retirent une protection** ou **ouvrent le coffre à quelqu'un d'autre**. Les
     * voir surlignées évite de les manquer au milieu de connexions ordinaires — et dans un
     * journal, manquer une ligne revient à ne pas l'avoir.
     */
    val SENSIBLES = setOf(
        "mfa.disable",
        "recovery.reset",
        "passkey.remove",
        "webauthn.remove",
        "emergency.approve",
        "org.member.add",
        "org.key.rotate",
        "org.group.access.grant",
    )

    fun estSensible(action: String): Boolean = action in SENSIBLES
}
