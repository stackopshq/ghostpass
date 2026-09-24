package ch.stackops.ghostpass.ui

import androidx.annotation.StringRes
import ch.stackops.ghostpass.R

/**
 * Ce qu'une action du journal veut dire, dans la langue affichée.
 *
 * Ce `when` vivait dans `:noyau`, à côté de la règle qui dit quelles actions sont sensibles,
 * et l'argument était bon : « comment une action se nomme » ressemble à une règle. Sauf que
 * `:noyau` est du Kotlin de la JVM, sans accès aux ressources Android — une phrase écrite
 * là-bas ne peut pas se traduire. Le journal serait resté en français dans une application
 * en anglais, et le défaut n'aurait sauté aux yeux de personne : un journal se lit rarement.
 *
 * Ce qui est resté dans `:noyau`, c'est `JournalDuCompte.SENSIBLES` — le classement, qui ne
 * dépend d'aucune langue.
 *
 * **Les identifiants inconnus sont rendus tels quels plutôt que masqués.** Une version plus
 * récente du serveur peut en journaliser de nouveaux, et une ligne brute reste plus utile
 * qu'une ligne absente — surtout dans un journal dont l'objet est de révéler l'inattendu.
 * Masquer ce qu'on ne connaît pas reviendrait à cacher précisément la nouveauté qu'on
 * cherche. C'est ce que dit le `null` rendu ici : l'appelant affiche alors le code.
 */
@StringRes
fun intituleDuJournal(action: String): Int? = when (action) {
        "login.password" -> R.string.journal_login_password
        "login.passkey" -> R.string.journal_login_passkey
        "login.sso" -> R.string.journal_login_sso
        "logout" -> R.string.journal_logout
        "mfa.enable" -> R.string.journal_mfa_enable
        "mfa.disable" -> R.string.journal_mfa_disable
        "recovery.reset" -> R.string.journal_recovery_reset
        "passkey.add" -> R.string.journal_passkey_add
        "passkey.remove" -> R.string.journal_passkey_remove
        "webauthn.add" -> R.string.journal_webauthn_add
        "webauthn.remove" -> R.string.journal_webauthn_remove
        "emergency.grant" -> R.string.journal_emergency_grant
        "emergency.request" -> R.string.journal_emergency_request
        "emergency.approve" -> R.string.journal_emergency_approve
        "org.member.add" -> R.string.journal_org_member_add
        "org.member.role" -> R.string.journal_org_member_role
        "org.key.rotate" -> R.string.journal_org_key_rotate
        "org.group.create" -> R.string.journal_org_group_create
        "org.group.delete" -> R.string.journal_org_group_delete
        "org.group.member.add" -> R.string.journal_org_group_member_add
        "org.group.member.remove" -> R.string.journal_org_group_member_remove
        "org.group.access.grant" -> R.string.journal_org_group_access_grant
        "org.group.access.revoke" -> R.string.journal_org_group_access_revoke
    else -> null
}
