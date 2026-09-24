package ch.stackops.ghostpass

import android.content.Context
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
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

    /**
     * Afficher l'icône des sites plutôt que leur initiale.
     *
     * Allumé par défaut, comme sur iOS et sur le web : une liste de pastilles grises se
     * reconnaît moins vite qu'une liste de logos, et le relais est celui du serveur de
     * l'utilisateur, pas celui d'un tiers.
     *
     * Le réglage est réel et n'a rien de cosmétique : le coffre est chiffré de bout en
     * bout, le serveur n'en connaît pas le contenu ; réclamer une icône, en revanche, lui
     * nomme un domaine. C'est le seul endroit de l'application où l'utilisateur échange
     * une information contre du confort, et il doit pouvoir refuser.
     */
    var afficheLesIcones by mutableStateOf(prefs.getBoolean(CLE_ICONES, true))
        private set

    fun choisirLApparence(valeur: Apparence) {
        apparence = valeur
        prefs.edit().putString(CLE_APPARENCE, valeur.cle).apply()
    }

    fun choisirLeVerrouillage(valeur: Verrouillage) {
        verrouillage = valeur
        prefs.edit().putString(CLE_VERROUILLAGE, valeur.cle).apply()
    }

    /**
     * La langue de l'application. **Elle ne vit pas dans ce fichier**, et c'est délibéré.
     *
     * Les trois autres réglages sont rangés dans nos `SharedPreferences`. Celui-ci est rangé
     * par AppCompat, parce qu'Android 13 a ajouté un réglage de langue *par application*
     * dans les paramètres du système, et que `setApplicationLocales` est ce qui l'alimente.
     * Le garder aussi de notre côté ferait deux sources de vérité pour la même question :
     * l'écran des réglages dirait « Français » pendant que l'écran du système dirait
     * « English », et rien ne dirait lequel des deux a raison.
     *
     * Relu à chaque construction plutôt que tenu en `mutableStateOf` : changer la langue
     * **recrée l'activité** — c'est ce qui repeint les écrans dans la nouvelle langue —, et
     * l'activité construit alors un nouveau [Preferences]. La valeur ne peut donc pas être
     * périmée.
     */
    val langue: Langue get() = Langue.deLocales(AppCompatDelegate.getApplicationLocales())

    fun choisirLaLangue(valeur: Langue) {
        AppCompatDelegate.setApplicationLocales(
            // Une liste vide rend la main au système, ce qui est exactement « Système ».
            if (valeur.etiquette == null) {
                LocaleListCompat.getEmptyLocaleList()
            } else {
                LocaleListCompat.forLanguageTags(valeur.etiquette)
            },
        )
    }

    fun afficherLesIcones(valeur: Boolean) {
        afficheLesIcones = valeur
        prefs.edit().putBoolean(CLE_ICONES, valeur).apply()
    }

    private companion object {
        const val CLE_APPARENCE = "gp.apparence"
        const val CLE_VERROUILLAGE = "gp.verrouillage"
        // La même clé que sur iOS (`gp.icones`), pour que les deux applications se lisent
        // de la même façon dans un rapport de bogue.
        const val CLE_ICONES = "gp.icones"
    }
}

/**
 * Système, français, anglais — les trois entrées, comme sur iOS.
 *
 * **Le nom d'une langue s'écrit dans cette langue.** Quelqu'un qui cherche l'anglais cherche
 * « English », pas « Anglais » : c'est la seule façon pour lui de reconnaître sa ligne dans
 * une liste écrite dans une langue qu'il ne lit pas. Seul « Système » se traduit — il ne
 * nomme pas une langue, il dit qu'on n'en choisit aucune.
 */
enum class Langue(val etiquette: String?, @StringRes val libelle: Int) {
    SYSTEME(null, R.string.reglages_langue_systeme),
    FRANCAIS("fr", R.string.reglages_langue_francais),
    ANGLAIS("en", R.string.reglages_langue_anglais),
    ;

    companion object {
        /**
         * Ce qu'AppCompat garde, ramené à l'une des trois entrées.
         *
         * La liste peut porter une langue que l'application ne propose pas — le système la
         * laisse choisir, et une mise à jour peut en retirer une. On retombe alors sur
         * « Système », qui est vrai : aucune des entrées proposées n'est en vigueur.
         */
        fun deLocales(locales: LocaleListCompat): Langue {
            val etiquette = locales.takeIf { !it.isEmpty }?.get(0)?.language ?: return SYSTEME
            return entries.firstOrNull { it.etiquette == etiquette } ?: SYSTEME
        }
    }
}

/** Système, clair, sombre — les trois états, comme sur iOS et sur le web. */
enum class Apparence(val cle: String, @StringRes val libelle: Int, val symbole: String) {
    SYSTEME("systeme", R.string.reglages_apparence_systeme, "◑"),
    CLAIR("clair", R.string.reglages_apparence_clair, "☀"),
    SOMBRE("sombre", R.string.reglages_apparence_sombre, "☾"),
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
enum class Verrouillage(val cle: String, @StringRes val libelle: Int, val delaiMs: Long?) {
    IMMEDIAT("immediat", R.string.reglages_verrou_immediat, null),
    UNE_MINUTE("uneMinute", R.string.reglages_verrou_une_minute, 60_000),
    CINQ_MINUTES("cinqMinutes", R.string.reglages_verrou_cinq_minutes, 300_000),
    QUINZE_MINUTES("quinzeMinutes", R.string.reglages_verrou_quinze_minutes, 900_000),
    ;

    companion object {
        fun parCle(cle: String?): Verrouillage = entries.firstOrNull { it.cle == cle } ?: IMMEDIAT
    }
}
