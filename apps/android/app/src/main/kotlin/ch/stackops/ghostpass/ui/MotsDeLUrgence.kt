package ch.stackops.ghostpass.ui

import androidx.annotation.StringRes
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.UrgenceDuCompte

/**
 * Les mots de l'accès d'urgence : ce que chaque rôle autorise, et où en est un lien.
 *
 * Ils vivaient dans `UrgenceDuCompte`, à côté des règles — et l'argument était bon : « quel
 * rôle autorise quoi » se raconte mieux à côté de la règle qui le décide. Sauf que
 * `:noyau` est du Kotlin de la JVM, sans accès aux ressources Android. Une phrase écrite
 * là-bas ne peut pas se traduire, et cet écran-ci serait resté en français dans une
 * application en anglais.
 *
 * **C'est l'écran où cela coûterait le plus cher.** L'écart entre « lecture seule » et
 * « reprise du compte » est énorme et ne se lit pas dans les deux mots : d'où l'explication
 * en toutes lettres, montrée avant le choix. Un anglophone à qui cette explication resterait
 * en français choisirait à l'aveugle de confier — ou non — le pouvoir de l'exclure de son
 * propre coffre.
 *
 * Ce qui est resté dans `:noyau` est ce qui ne dépend d'aucune langue : la clé du serveur
 * (`view`, `takeover`, `invited`…) et la règle de lecture qui refuse de retomber sur le
 * rôle le plus faible quand elle ne comprend pas.
 */

/** Le nom du rôle : « Lecture seule », « Reprise du compte ». */
@get:StringRes
val UrgenceDuCompte.Role.libelle: Int
    get() = when (this) {
        UrgenceDuCompte.Role.LECTURE -> R.string.urgence_role_lecture
        UrgenceDuCompte.Role.REPRISE -> R.string.urgence_role_reprise
    }

/** Ce que le rôle autorise, en toutes lettres. C'est cela qu'on lit pour choisir. */
@get:StringRes
val UrgenceDuCompte.Role.explication: Int
    get() = when (this) {
        UrgenceDuCompte.Role.LECTURE -> R.string.urgence_role_lecture_explication
        UrgenceDuCompte.Role.REPRISE -> R.string.urgence_role_reprise_explication
    }

/** Où en est le lien : « Invitation envoyée », « Accès ouvert »… */
@get:StringRes
val UrgenceDuCompte.Etat.libelle: Int
    get() = when (this) {
        UrgenceDuCompte.Etat.INVITE -> R.string.urgence_etat_invite
        UrgenceDuCompte.Etat.ACCEPTE -> R.string.urgence_etat_accepte
        UrgenceDuCompte.Etat.DEMANDE -> R.string.urgence_etat_demande
        UrgenceDuCompte.Etat.OUVERT -> R.string.urgence_etat_ouvert
        UrgenceDuCompte.Etat.REFUSE -> R.string.urgence_etat_refuse
    }
