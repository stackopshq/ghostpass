package ch.stackops.ghostpass

/**
 * Le journal du compte : qui s'est connecté, et ce qui a été fait de sensible.
 *
 * **C'est le seul endroit où l'on peut s'apercevoir qu'un accès n'était pas le sien.** Un
 * journal illisible ne sert donc à rien : « mfa.disable » ne dit rien à personne, et c'est
 * justement la ligne qu'il faut remarquer.
 *
 * Le **classement** vit ici, dans `:noyau` : « quelle action est sensible » est une règle,
 * et une règle enfouie dans un `when` de composable ne s'éprouve qu'à l'œil.
 *
 * La **traduction**, elle, a quitté ce fichier. Elle y était pour la même raison — et c'était
 * l'erreur : ce module est du Kotlin de la JVM, sans accès aux ressources Android. « Second
 * facteur désactivé » écrit ici ne pouvait pas se traduire, et le journal serait resté en
 * français quelle que soit la langue choisie. Le `when` est passé dans
 * `ui/IntituleDuJournal.kt`, où il associe le même code de serveur à une chaîne de
 * ressource. Le code (`mfa.disable`) reste la clé des deux côtés : c'est lui qui est stable,
 * pas sa formulation.
 */
object JournalDuCompte {

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
