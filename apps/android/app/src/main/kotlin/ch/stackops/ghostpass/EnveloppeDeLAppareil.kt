package ch.stackops.ghostpass

import android.content.Context
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import androidx.annotation.RequiresApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.SecureRandom
import javax.crypto.Cipher

/**
 * Ce que l'appareil persiste pour qu'un déverrouillage sans interface soit possible.
 *
 * C'est la mise en œuvre d'`docs/adr/0002`, et sa question centrale n'est pas « comment
 * partager » — sur Android, le service de remplissage tourne dans le processus de
 * l'application, il n'y a rien à partager. C'est **« que persiste-t-on »**.
 *
 * Réponse : la clé du coffre, enveloppée par le cœur Rust sous un secret aléatoire, et ce
 * secret scellé par une clé de l'`AndroidKeyStore` liée à l'authentification ([CleDEnveloppe]).
 * Deux enveloppes emboîtées, chacune posée par qui sait la poser :
 *
 * ```
 *   clé du coffre (USK)  ──wrap_user_key_for_passkey──▶  enveloppe   ┐
 *   secret aléatoire     ──AES-GCM du KeyStore────────▶  scellé      ├──▶ filesDir
 *                                                        + IV        ┘
 * ```
 *
 * **Le fichier ne contient aucun secret en clair.** L'enveloppe ne s'ouvre que sous le
 * secret, et le secret ne sort du KeyStore qu'après biométrie. Le lire ne donne rien ; le
 * copier sur un autre appareil ne donne rien non plus, la clé du KeyStore n'étant pas
 * exportable.
 *
 * Il vit dans `filesDir`, privé à l'application, et `android:allowBackup="false"` l'empêche
 * de partir chez un sauvegardeur qui n'est pas le nôtre — sans quoi le coffre voyagerait
 * avec, ce qu'un coffre à connaissance nulle promet de ne pas faire.
 */
class EnveloppeDeLAppareil(private val contexte: Context) {

    /**
     * Ce qui s'écrit sur le disque.
     *
     * `version` n'est pas décoratif : le jour où la forme change, un fichier d'une version
     * inconnue doit être **jeté**, pas deviné. Un champ ajouté silencieusement se lirait
     * comme absent, et l'absence a ici le même effet qu'une valeur fausse.
     */
    @Serializable
    private data class Materiel(
        val version: Int = VERSION,
        /** L'IV que le KeyStore a tiré pour sceller le secret. Base64. */
        val iv: String,
        /** Le secret d'enveloppe, scellé par la clé du KeyStore. Base64. */
        val secretScelle: String,
        /** La clé du coffre enveloppée par le cœur, au format `EncString`. */
        val uskEnveloppee: String,
    )

    private val fichier: File get() = File(contexte.filesDir, NOM)

    /**
     * `encodeDefaults = true`, et ce n'est pas cosmétique.
     *
     * Constaté sur l'appareil : sans lui, `version` — qui vaut son défaut — **n'est pas
     * écrit**. Le fichier posé ne portait aucun numéro de version, et un lecteur d'une
     * version 2 l'aurait relu comme étant de la sienne, puisque l'absence se lit comme le
     * défaut. Le champ existait, la garde était écrite, et elle n'aurait rien gardé.
     *
     * C'est le même piège que partout ailleurs dans ce produit : rien n'échoue, rien ne
     * s'affiche, et l'écart ne se voit que chez le lecteur suivant.
     */
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /**
     * Le raccourci est-il utilisable sur cet appareil ?
     *
     * Trois conditions, et la première est celle qu'on oublie : le KeyStore doit savoir
     * tenir la politique de l'ADR, ce qui demande l'API 28. Sous ce plancher, on ne propose
     * rien plutôt que de poser deux réglages sur trois sans le dire.
     */
    val possible: Boolean get() = CleDEnveloppe.disponible

    /** Une enveloppe est-elle posée ? */
    val activee: Boolean get() = possible && lire() != null

    /**
     * Prépare l'activation : rend le chiffreur à passer à `BiometricPrompt`.
     *
     * On **régénère la clé** à chaque activation. C'est délibéré : une activation est le
     * seul moment où l'utilisateur consent explicitement, et repartir d'une clé neuve
     * garantit que la politique en vigueur est celle du code d'aujourd'hui, pas celle du
     * jour où la clé a été créée. Un `KeyGenParameterSpec` ne se réapplique pas à une clé
     * existante — c'est le piège qui laisserait un appareil sur une politique périmée sans
     * qu'aucune erreur ne le signale.
     */
    @RequiresApi(Build.VERSION_CODES.P)
    fun preparerLActivation(): Cipher {
        CleDEnveloppe.oublier()
        return CleDEnveloppe.pourSceller()
    }

    /**
     * Pose l'enveloppe, une fois l'utilisateur authentifié.
     *
     * @param chiffreur celui que `BiometricPrompt` a rendu après le geste — **pas** celui
     *   qu'on lui avait donné. Le distinguer n'est pas de la superstition : c'est le
     *   `CryptoObject` rendu qui porte la preuve d'authentification, et repasser par le
     *   nôtre marcherait ici tout en n'étant plus la même chose ailleurs.
     */
    fun activer(chiffreur: Cipher, coffre: Coffre) {
        val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val secretB64 = Base64.encodeToString(secret, Base64.NO_WRAP)
        // L'enveloppe est posée par le cœur, jamais ici (§1).
        val uskEnveloppee = coffre.envelopperLaCle(secretB64)
        val scelle = chiffreur.doFinal(secret)
        secret.fill(0)

        ecrire(
            Materiel(
                iv = Base64.encodeToString(chiffreur.iv, Base64.NO_WRAP),
                secretScelle = Base64.encodeToString(scelle, Base64.NO_WRAP),
                uskEnveloppee = uskEnveloppee,
            ),
        )
    }

    /**
     * Prépare l'ouverture : rend le déchiffreur à passer à `BiometricPrompt`.
     *
     * Rend `null` si rien n'est posé **ou si la clé a été invalidée** — c'est-à-dire si une
     * empreinte a été enrôlée depuis. Dans ce second cas le matériel est effacé au passage :
     * il ne s'ouvrira plus jamais, et le garder ferait rejouer l'échec à chaque tentative.
     * L'utilisateur retombe alors sur son mot de passe maître, ce que l'ADR appelle
     * « après toute invalidation de la clé ».
     */
    @RequiresApi(Build.VERSION_CODES.P)
    fun preparerLOuverture(): Cipher? {
        val materiel = lire() ?: return null
        return try {
            CleDEnveloppe.pourOuvrir(Base64.decode(materiel.iv, Base64.NO_WRAP))
        } catch (_: KeyPermanentlyInvalidatedException) {
            oublier()
            null
        }
    }

    /**
     * Ouvre le coffre à partir du déchiffreur authentifié.
     *
     * Le secret ne fait que passer : il sort du KeyStore, traverse la frontière vers le
     * cœur, et n'est écrit nulle part.
     */
    fun ouvrir(dechiffreur: Cipher, coffre: Coffre, session: Coffre.Session, jeton: String?) {
        val materiel = lire() ?: throw IllegalStateException("aucune enveloppe posée")
        val secret = dechiffreur.doFinal(
            Base64.decode(materiel.secretScelle, Base64.NO_WRAP))
        val secretB64 = Base64.encodeToString(secret, Base64.NO_WRAP)
        secret.fill(0)
        coffre.rouvrirParEnveloppe(session, secretB64, materiel.uskEnveloppee, jeton)
    }

    /** Retire l'enveloppe et la clé. Le mot de passe maître redevient le seul chemin. */
    fun oublier() {
        fichier.delete()
        runCatching { CleDEnveloppe.oublier() }
    }

    private fun lire(): Materiel? {
        if (!fichier.exists()) return null
        return try {
            val materiel = json.decodeFromString(Materiel.serializer(), fichier.readText())
            // Une version inconnue se jette. Elle ne se devine pas : un champ qu'on lirait
            // comme absent aurait ici le même effet qu'une valeur fausse.
            if (materiel.version != VERSION) null else materiel
        } catch (_: Exception) {
            null
        }
    }

    private fun ecrire(materiel: Materiel) {
        fichier.writeText(json.encodeToString(Materiel.serializer(), materiel))
    }

    private companion object {
        const val NOM = "enveloppe-du-coffre.json"
        const val VERSION = 1
    }
}
