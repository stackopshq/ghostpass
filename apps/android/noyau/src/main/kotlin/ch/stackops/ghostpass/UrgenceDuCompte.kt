package ch.stackops.ghostpass


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
     *
     * **L'intitulé et l'explication ne sont plus ici.** Ce module est du Kotlin de la JVM,
     * sans accès aux ressources Android : une phrase écrite ici ne pourrait pas se
     * traduire, et l'écran d'urgence resterait en français quelle que soit la langue
     * choisie. Ce qui reste — la clé du serveur et la règle de lecture — est ce qui ne
     * dépend d'aucune langue. `EcranDeLUrgence` associe chaque cas à sa chaîne.
     */
    enum class Role(val cle: String) {
        LECTURE("view"),
        REPRISE("takeover"),
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

    /**
     * Où en est un lien. **Les valeurs viennent du serveur ; on ne les invente pas.**
     *
     * L'intitulé se lit côté écran, pour la raison donnée sur [Role].
     */
    enum class Etat(val cle: String) {
        INVITE("invited"),
        ACCEPTE("accepted"),
        DEMANDE("requested"),
        OUVERT("granted"),
        REFUSE("rejected"),
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
}
