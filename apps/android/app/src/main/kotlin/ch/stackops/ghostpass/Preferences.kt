package ch.stackops.ghostpass

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Les réglages que l'utilisateur impose à l'application.
 *
 * Ils suivent le système par défaut — c'est ce qu'attend quelqu'un qui a déjà réglé son
 * téléphone —, mais le défaut n'est pas une fatalité : un coffre s'ouvre aussi bien dans un
 * train de nuit que dans un bureau en plein soleil.
 *
 * ## Pourquoi `SharedPreferences` et non `EncryptedSharedPreferences`
 *
 * [StockageDeSession] chiffre ce qu'il garde parce qu'il garde un jeton de session. Ici il
 * n'y a **aucun secret** : le thème choisi et le délai de verrouillage ne révèlent rien du
 * coffre. Les chiffrer coûterait un accès au KeyStore au tout premier affichage, avant même
 * l'écran d'entrée — et ferait dépendre l'apparence de l'application d'un matériel qui peut
 * refuser. Un thème qui ne s'applique pas parce que le KeyStore a hoqueté serait un défaut
 * incompréhensible.
 *
 * `allowBackup` reste à `false` pour tout le paquet : ce fichier ne part pas chez Google
 * non plus, mais pour une raison de principe et non parce qu'il contiendrait un secret.
 */
class Preferences(contexte: Context) {

    private val prefs = contexte.applicationContext
        .getSharedPreferences("reglages", Context.MODE_PRIVATE)

    /**
     * Les valeurs sont tenues en `mutableStateOf` et non relues du disque à chaque lecture.
     *
     * Compose a besoin d'un état **observable** pour recomposer : un `getString` dans le
     * corps d'un composable rendrait la bonne valeur au premier affichage et ne changerait
     * plus jamais. Le réglage paraîtrait alors n'avoir aucun effet jusqu'au redémarrage,
     * ce qui se lit comme un réglage cassé plutôt que comme un réglage différé.
     */
    var apparence by mutableStateOf(
        Apparence.parCle(prefs.getString(CLE_APPARENCE, null)),
    )
        private set

    var verrouillage by mutableStateOf(
        Verrouillage.parCle(prefs.getString(CLE_VERROUILLAGE, null)),
    )
        private set

    fun choisirLApparence(valeur: Apparence) {
        apparence = valeur
        prefs.edit().putString(CLE_APPARENCE, valeur.cle).apply()
    }

    fun choisirLeVerrouillage(valeur: Verrouillage) {
        verrouillage = valeur
        prefs.edit().putString(CLE_VERROUILLAGE, valeur.cle).apply()
    }

    private companion object {
        const val CLE_APPARENCE = "gp.apparence"
        const val CLE_VERROUILLAGE = "gp.verrouillage"
    }
}

/** Système, clair, sombre — les trois états, comme sur iOS et sur le web. */
enum class Apparence(val cle: String, val libelle: String, val symbole: String) {
    SYSTEME("systeme", "Système", "◑"),
    CLAIR("clair", "Clair", "☀"),
    SOMBRE("sombre", "Sombre", "☾"),
    ;

    companion object {
        fun parCle(cle: String?): Apparence = entries.firstOrNull { it.cle == cle } ?: SYSTEME
    }
}

/**
 * Combien de temps le coffre reste ouvert une fois l'application quittée.
 *
 * **Ce réglage n'existait pas sur Android, et son absence était documentée** : verrouiller
 * systématiquement est le comportement le plus strict, donc celui qu'on peut assumer sans
 * réglage. Le commentaire d'`ActivitePrincipale.onStop` disait pourquoi l'assouplir avait
 * été remis à plus tard — « cela demande de savoir mesurer le temps écoulé y compris quand
 * l'horloge recule ».
 *
 * La réponse à cette objection tient en un nom : `SystemClock.elapsedRealtime()`. Il compte
 * depuis le démarrage de l'appareil, veille comprise, et **ne peut pas reculer** — ni un
 * changement de fuseau, ni une synchronisation NTP, ni un utilisateur qui recule sa montre
 * ne l'affectent. `System.currentTimeMillis()`, lui, aurait exactement le défaut redouté :
 * reculer l'horloge de dix minutes aurait rallongé le délai d'autant, et c'est un coffre
 * qu'on garde ouvert plus longtemps que promis.
 *
 * Pendant ce délai, les clés restent **en mémoire**. Elles ne touchent jamais le disque, et
 * `FLAG_SECURE` masque l'écran dans le sélecteur d'applications ; mais le coffre est ouvert,
 * et c'est bien ce qui a été demandé. Immédiat reste le défaut.
 */
enum class Verrouillage(val cle: String, val libelle: String, val delaiMs: Long?) {
    IMMEDIAT("immediat", "Immédiatement", null),
    UNE_MINUTE("uneMinute", "Après 1 minute", 60_000),
    CINQ_MINUTES("cinqMinutes", "Après 5 minutes", 300_000),
    QUINZE_MINUTES("quinzeMinutes", "Après 15 minutes", 900_000),
    ;

    companion object {
        fun parCle(cle: String?): Verrouillage = entries.firstOrNull { it.cle == cle } ?: IMMEDIAT
    }
}
