package ch.stackops.ghostpass

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Ce que l'appareil retient d'une session entre deux lancements.
 *
 * Deux natures de secret, et elles ne se rangent pas au même endroit — c'est la
 * distinction que fait `Keychain.swift` côté iOS, et elle se transpose :
 *
 *  - le **jeton de session** ouvre le compte côté serveur. Il est ici, chiffré par une clé
 *    du KeyStore matériel ;
 *  - les **enveloppes chiffrées** (`encryptedUserKey`, `encryptedPrivateKey`) ne sont pas
 *    des secrets : le serveur les détient déjà, et il faut pouvoir les relire pour rouvrir
 *    le coffre hors ligne. Elles vivent au même endroit par commodité, pas par nécessité ;
 *  - le **mot de passe maître** n'est *pas* ici. Il ne s'écrit nulle part tant que
 *    l'utilisateur n'a pas activé la biométrie, et il devra alors aller sous une clé
 *    `setUserAuthenticationRequired` + `setInvalidatedByBiometricEnrollment(true)` —
 *    l'équivalent du `.biometryCurrentSet` d'iOS. Ce n'est pas fait (§11).
 *
 * `allowBackup` est à `false` dans le manifeste : sans cela, une sauvegarde Android
 * emporterait ce fichier chez Google, ce qui est exactement ce qu'un coffre à connaissance
 * nulle promet de ne pas faire.
 */
class StockageDeSession(contexte: Context) {

    private val prefs: SharedPreferences by lazy {
        val cle = MasterKey.Builder(contexte)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            contexte,
            "session",
            cle,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** La session enregistrée, ou `null` si l'appareil n'en connaît aucune. */
    fun session(): Coffre.Session? {
        val serveur = prefs.getString(SERVEUR, null) ?: return null
        val email = prefs.getString(EMAIL, null) ?: return null
        val kdf = prefs.getString(KDF, null) ?: return null
        val cleUtilisateur = prefs.getString(CLE_UTILISATEUR, null) ?: return null
        val clePrivee = prefs.getString(CLE_PRIVEE, null) ?: return null
        return Coffre.Session(serveur, email, kdf, cleUtilisateur, clePrivee)
    }

    fun enregistrer(session: Coffre.Session, jeton: String) {
        prefs.edit()
            .putString(SERVEUR, session.adresseServeur)
            .putString(EMAIL, session.email)
            .putString(KDF, session.kdfParams)
            .putString(CLE_UTILISATEUR, session.encryptedUserKey)
            .putString(CLE_PRIVEE, session.encryptedPrivateKey)
            .putString(JETON, jeton)
            .apply()
    }

    fun jeton(): String? = prefs.getString(JETON, null)

    /**
     * Les domaines que l'utilisateur a approuvés pour un serveur donné (§4).
     *
     * La clé porte l'adresse du serveur : c'est ce qui rend l'approbation **locale à ce
     * serveur**. Une liste globale ferait qu'approuver un domaine pour l'instance de son
     * entreprise l'autoriserait sur celle d'un tiers, où il n'a aucune raison d'être de
     * confiance.
     */
    fun domainesApprouves(serveur: String): Set<String> =
        prefs.getStringSet(DOMAINES + serveur, emptySet()) ?: emptySet()

    fun approuver(serveur: String, domaine: String) {
        prefs.edit()
            .putStringSet(DOMAINES + serveur, domainesApprouves(serveur) + domaine)
            .apply()
    }

    /**
     * Le dernier coffre **chiffré** rapporté par le serveur.
     *
     * Ce ne sont pas des secrets : ce sont exactement les octets que le serveur détient
     * déjà, et qu'il rend à qui présente le jeton. Les garder ici ne révèle rien de plus,
     * et permet d'afficher le coffre quand le réseau manque.
     *
     * Sans ce cache, un déverrouillage hors ligne aboutit à une liste vide — qui se lit
     * « vous n'avez rien enregistré ». C'est la règle §5 à l'échelle du coffre entier :
     * l'absence de réponse n'est pas une réponse vide, et les confondre ferait recréer des
     * identifiants qui existent déjà.
     */
    fun elementsEnCache(): List<ElementChiffre>? {
        val texte = prefs.getString(CACHE, null) ?: return null
        return try {
            Json { ignoreUnknownKeys = true }
                .decodeFromString(ListSerializer(ElementChiffre.serializer()), texte)
        } catch (_: Exception) {
            null
        }
    }

    fun mettreEnCache(elements: List<ElementChiffre>) {
        val texte = Json.encodeToString(ListSerializer(ElementChiffre.serializer()), elements)
        prefs.edit().putString(CACHE, texte).apply()
    }

    /** Oublie tout. Une déconnexion ne laisse rien derrière elle. */
    fun oublier() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val SERVEUR = "serveur"
        const val EMAIL = "email"
        const val KDF = "kdfParams"
        const val CLE_UTILISATEUR = "encryptedUserKey"
        const val CLE_PRIVEE = "encryptedPrivateKey"
        const val JETON = "jeton"
        const val DOMAINES = "domainesApprouves:"
        const val CACHE = "elementsChiffres"
    }
}
