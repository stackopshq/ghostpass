package ch.stackops.ghostpass.ui

import android.content.Context
import android.text.format.DateFormat
import androidx.core.os.ConfigurationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Une date, **dans l'ordre de la langue affichée** — et non dans celui du français.
 *
 * Ce qu'il y avait avant, à deux endroits (`UrgenceDuCompte.dateLisible` et le formateur
 * privé d'`EcranDuJournal`) :
 *
 *     SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault())
 *
 * `Locale.getDefault()` traduisait déjà le nom du mois, ce qui suffisait à faire croire que
 * la date était localisée. **Elle ne l'était pas** : « d MMM yyyy, HH:mm » est un ordre
 * français, écrit une fois pour toutes. Un anglophone y lisait « 4 Mar 2026, 14:30 » là où
 * il attend « Mar 4, 2026, 2:30 PM » — le mois traduit rendait le défaut d'autant plus
 * difficile à voir, puisque la moitié visible avait l'air juste.
 *
 * `getBestDateTimePattern` demande au système le motif de *cette* langue pour les champs
 * demandés. Il décide de l'ordre, du séparateur, et de la présence d'un AM/PM.
 *
 * ## La langue vient des ressources, pas du système
 *
 * `Locale.getDefault()` rend la langue de **l'appareil**. Depuis que l'application a son
 * propre réglage de langue, les deux peuvent différer : quelqu'un dont le téléphone est en
 * anglais et qui choisit le français dans GhostPass verrait ses dates en anglais au milieu
 * d'un écran français. On lit donc la locale de la configuration du contexte, qui est celle
 * qu'AppCompat vient d'appliquer.
 */
object DateLisible {

    /** Le jour et l'heure, tels que cette langue les écrit. */
    fun jourEtHeure(contexte: Context, millisecondes: Long): String {
        val langue = locale(contexte)
        // Le squelette dit **quels champs** on veut, pas leur forme : c'est le système qui
        // décide de l'ordre, des séparateurs et de l'heure. Il existe depuis l'API 18, bien
        // en deçà du `minSdk` du produit.
        //
        // `j` et non `HH` : `HH` **impose** le format vingt-quatre heures, et rendait
        // « Sep 24, 2026, 22:21 » à un anglophone qui attend « 10:21 PM ». Le défaut est
        // plus discret que celui de l'ordre des champs — la date était juste, l'heure
        // lisible — et c'est exactement pour cela qu'il aurait survécu. `j` demande
        // « l'heure », et laisse la langue choisir entre les deux.
        val motif = DateFormat.getBestDateTimePattern(langue, "d MMM yyyy jm")
        return SimpleDateFormat(motif, langue).format(Date(millisecondes))
    }

    /**
     * La locale effective de cet écran.
     *
     * `ConfigurationCompat` plutôt que `configuration.locale` : ce dernier est déprécié
     * depuis l'API 24 et ne rend que la première d'une liste qui peut en porter plusieurs.
     */
    fun locale(contexte: Context): Locale =
        ConfigurationCompat.getLocales(contexte.resources.configuration)[0] ?: Locale.getDefault()
}
