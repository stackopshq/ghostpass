package ch.stackops.ghostpass

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * La clé d'`AndroidKeyStore` qui garde le secret d'enveloppe (`docs/adr/0002`).
 *
 * Elle ne chiffre **que** trente-deux octets : le secret sous lequel le cœur Rust a
 * enveloppé la clé du coffre. C'est un maillon de la chaîne, pas une seconde implémentation
 * de quoi que ce soit — la cryptographie du coffre reste entièrement dans le cœur (§1), et
 * ce qui se passe ici est du matériel de clé confié au matériel de l'appareil.
 *
 * ## Les trois réglages, et pourquoi ils sont ensemble
 *
 * L'ADR en exige trois et dit qu'aucun n'est décoratif. Ils le sont d'autant moins qu'ils se
 * tiennent : pris séparément, deux d'entre eux ne font presque rien.
 *
 *  - `setUserAuthenticationRequired(true)` — la clé ne sort qu'après authentification. Seul,
 *    il ne dit pas *quelle* authentification, ni combien de temps elle vaut ;
 *  - `setInvalidatedByBiometricEnrollment(true)` — l'équivalent de `.biometryCurrentSet`.
 *    Son défaut est `false` et son oubli ne produit aucune erreur : c'est le réglage que
 *    l'ADR nomme comme le plus important, et le magasin le porte bien — une clé construite
 *    sans lui rapporte `false`. Ce fichier a un temps affirmé le contraire, sur une mesure
 *    prise une seule fois ; `CleDEnveloppeTest` raconte comment elle s'est démentie ;
 *  - `setUnlockedDeviceRequired(true)` — rien ne se déchiffre écran verrouillé.
 *
 * ## Biométrie **seule**, et pas « biométrie ou code de l'appareil »
 *
 * L'ADR écrit « biométrie ou code de l'appareil ». Cette classe n'autorise que
 * `AUTH_BIOMETRIC_STRONG`, et c'est un écart assumé qu'il faut lire :
 *
 * ajouter `AUTH_DEVICE_CREDENTIAL` aux types acceptés **désarme en pratique le réglage que
 * l'ADR juge le plus important**. Une clé invalidée par un nouvel enrôlement reste alors
 * ouvrable au code de l'appareil — or l'attaque décrite par l'ADR (« quelqu'un ajoute son
 * empreinte au téléphone déverrouillé de sa victime ») suppose déjà de connaître ce code,
 * puisque Android l'exige pour enrôler. Le réglage serait posé, et n'empêcherait rien.
 *
 * Conséquence à assumer, et elle est réelle : sur un appareil sans biométrie enrôlée, le
 * raccourci n'existe pas et le mot de passe maître reste le seul chemin. C'est ce que l'ADR
 * appelle déjà le premier déverrouillage, simplement à chaque fois.
 *
 * ## Le plancher d'API
 *
 * `minSdk` est 24 ; cette clé demande **28**. `setUnlockedDeviceRequired` n'existe pas
 * avant, et l'ADR ne permet pas de s'en passer. Sous 28, [disponible] est `false` et
 * l'application ne propose rien — plutôt que de poser deux réglages sur trois et de le
 * taire, ce qui est précisément la faute que l'ADR combat.
 */
object CleDEnveloppe {

    /** Le magasin de clés matériel d'Android. Ce nom est celui du fournisseur, pas un choix. */
    private const val MAGASIN = "AndroidKeyStore"

    /**
     * L'alias de la clé.
     *
     * Il porte une version : le jour où l'un des trois réglages change, la clé existante
     * n'est **pas** reconfigurée — un `KeyGenParameterSpec` ne s'applique qu'à la
     * génération. Changer l'alias est ce qui force une nouvelle clé, donc une nouvelle
     * activation. Réutiliser l'alias laisserait les appareils déjà installés sur l'ancienne
     * politique, sans que rien ne le signale.
     */
    const val ALIAS = "ch.stackops.ghostpass.enveloppe.v1"

    /** `AES/GCM/NoPadding` : le seul mode authentifié que le KeyStore offre pour l'AES. */
    private const val TRANSFORMATION =
        "${KeyProperties.KEY_ALGORITHM_AES}/${KeyProperties.BLOCK_MODE_GCM}/" +
            KeyProperties.ENCRYPTION_PADDING_NONE

    /** 128 bits d'étiquette d'authentification — le maximum de GCM. */
    private const val TAILLE_ETIQUETTE = 128

    /** Le KeyStore sait-il tenir la politique que l'ADR exige sur cet appareil ? */
    val disponible: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    /**
     * La politique de la clé, **isolée dans une fonction pour être lisible par un test**.
     *
     * Les deux paramètres n'existent que pour les témoins, qui ont besoin de fabriquer des
     * clés **volontairement fausses** pour montrer que les bonnes ne le sont pas :
     *
     *  - `invalideeParEnrolement = false` produit une clé que le magasin rapporte comme
     *    non invalidée. C'est ce qui rend l'assertion de production non vide ;
     *  - `secondesDeValidite > 0` attache la clé à l'horloge du système plutôt qu'aux
     *    empreintes. Une telle clé **survit** à un nouvel enrôlement — mesuré par
     *    `tools/android/temoin-de-l-invalidation.sh` — et c'est la régression la plus
     *    plausible : quelqu'un trouve la biométrie insistante et pose « valable cinq
     *    minutes ».
     *
     * Le code de production n'appelle jamais cette fonction avec autre chose que ses défauts.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    fun politique(
        alias: String,
        invalideeParEnrolement: Boolean = true,
        secondesDeValidite: Int = 0,
    ): KeyGenParameterSpec {
        val constructeur = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // GCM ne pardonne pas la réutilisation d'un IV : le laisser au KeyStore plutôt
            // que de le tirer nous-mêmes retire l'occasion de se tromper. Le chiffrement
            // refuse alors un IV imposé, ce qui est exactement la garantie voulue.
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(true)
            // Rien ne se déchiffre écran verrouillé (ADR-0002). API 28, d'où le plancher.
            .setUnlockedDeviceRequired(true)
            .setInvalidatedByBiometricEnrollment(invalideeParEnrolement)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Zéro seconde de validité : **une authentification par usage**. C'est ce zéro,
            // et non le drapeau, qui attache la clé aux empreintes actuellement enrôlées.
            constructeur.setUserAuthenticationParameters(
                secondesDeValidite, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            // Le même sens, dans la forme d'avant l'API 30 : `-1` vaut « à chaque usage,
            // par empreinte ». La méthode est dépréciée et reste la seule sous 30.
            @Suppress("DEPRECATION")
            constructeur.setUserAuthenticationValidityDurationSeconds(
                if (secondesDeValidite == 0) -1 else secondesDeValidite)
        }
        return constructeur.build()
    }

    /** Crée la clé, en écrasant celle qui portait déjà cet alias. */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    fun creer(alias: String = ALIAS): SecretKey {
        val generateur = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, MAGASIN)
        generateur.init(politique(alias))
        return generateur.generateKey()
    }

    /** La clé existante, ou `null` si l'appareil n'en porte aucune sous cet alias. */
    fun cle(alias: String = ALIAS): SecretKey? {
        val magasin = KeyStore.getInstance(MAGASIN).apply { load(null) }
        return magasin.getKey(alias, null) as? SecretKey
    }

    /** Efface la clé. Ce qu'elle scellait devient définitivement illisible. */
    fun oublier(alias: String = ALIAS) {
        val magasin = KeyStore.getInstance(MAGASIN).apply { load(null) }
        if (magasin.containsAlias(alias)) magasin.deleteEntry(alias)
    }

    /**
     * Un chiffreur prêt à sceller, à confier à `BiometricPrompt`.
     *
     * L'initialisation réussit ; c'est le `doFinal` qui exigera l'authentification. C'est
     * ce décalage qui permet de passer le `Cipher` dans un `CryptoObject` et de n'obtenir
     * un chiffré qu'après le geste de l'utilisateur.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    fun pourSceller(alias: String = ALIAS): Cipher {
        val cle = cle(alias) ?: creer(alias)
        return Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, cle) }
    }

    /**
     * Un déchiffreur prêt à ouvrir, à confier à `BiometricPrompt`.
     *
     * **Lève `KeyPermanentlyInvalidatedException`** si une empreinte a été enrôlée depuis.
     * C'est le comportement voulu, et le seul endroit où l'invalidation se manifeste :
     * l'appelant doit alors effacer l'enveloppe et redemander le mot de passe maître.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.P)
    fun pourOuvrir(iv: ByteArray, alias: String = ALIAS): Cipher? {
        val cle = cle(alias) ?: return null
        return Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, cle, GCMParameterSpec(TAILLE_ETIQUETTE, iv))
        }
    }
}
