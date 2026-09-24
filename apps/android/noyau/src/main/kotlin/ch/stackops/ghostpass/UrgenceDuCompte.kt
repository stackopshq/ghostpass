package ch.stackops.ghostpass

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Les mots de l'accès d'urgence — rôles, états, délais.
 *
 * Ils vivent hors de l'écran parce que ce sont des **règles**, pas de la présentation : quel
 * rôle autorise quoi, quel état permet quelle action. Une règle enfouie dans un `when` de
 * composable ne s'éprouve qu'à l'œil, et celle-ci décide de qui peut lire le coffre de qui.
 */
object UrgenceDuCompte {

    /**
     * Rôle confié au contact.
     *
     * `view` laisse lire le coffre ; `takeover` permet **en plus** d'imposer un nouveau mot
     * de passe maître au donneur — ce qui l'exclut de son propre coffre. L'écart entre les
     * deux est énorme et ne se lit pas dans les mots « lecture » et « reprise » : c'est
     * pourquoi chacun porte une explication en toutes lettres, montrée avant le choix.
     */
    enum class Role(val cle: String, val intitule: String, val explication: String) {
        LECTURE(
            "view",
            "Lecture seule",
            "Le contact pourra lire vos identifiants, sans rien y changer ni vous en priver.",
        ),
        REPRISE(
            "takeover",
            "Reprise du compte",
            "Le contact pourra en plus choisir un nouveau mot de passe maître — ce qui vous " +
                "exclura de votre propre coffre.",
        ),
        ;

        companion object {
            /**
             * `null` quand le serveur annonce un rôle inconnu, et **pas un repli sur
             * « lecture »**.
             *
             * Retomber sur le rôle le plus faible paraît prudent et ne l'est pas : un rôle
             * qu'on ne sait pas lire pourrait en autoriser davantage, et l'écran dirait
             * « lecture seule » sur un lien qui permet la reprise. Mieux vaut une ligne qui
             * avoue ne pas comprendre.
             */
            fun parCle(cle: String): Role? = entries.firstOrNull { it.cle == cle }
        }
    }

    /** Où en est un lien. **Les valeurs viennent du serveur ; on ne les invente pas.** */
    enum class Etat(val cle: String, val intitule: String) {
        INVITE("invited", "Invitation envoyée"),
        ACCEPTE("accepted", "Contact accepté"),
        DEMANDE("requested", "Accès demandé"),
        OUVERT("granted", "Accès ouvert"),
        REFUSE("rejected", "Demande refusée"),
        ;

        companion object {
            fun parCle(cle: String): Etat? = entries.firstOrNull { it.cle == cle }
        }
    }

    /**
     * Le moment où l'accès s'ouvrira, si une demande court.
     *
     * **Le serveur tranche pour de bon ; ceci ne sert qu'à l'afficher.** Le client ne décide
     * jamais qu'un accès est disponible : il demande, et le serveur répond 403 tant que le
     * délai n'est pas écoulé. Calculer la date ici pour en déduire un droit ferait d'une
     * horloge de téléphone l'arbitre de l'accès au coffre de quelqu'un d'autre.
     */
    fun ouverturePrevue(etat: String, demandeLe: Long?, joursDAttente: Int): Long? {
        if (Etat.parCle(etat) != Etat.DEMANDE || demandeLe == null) return null
        return demandeLe + joursDAttente.toLong() * 86_400_000L
    }

    fun dateLisible(millisecondes: Long): String =
        SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(Date(millisecondes))
}
