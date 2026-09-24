package ch.stackops.ghostpass

import android.content.pm.ApplicationInfo
import android.os.Build
import android.security.keystore.KeyInfo
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * **Le témoin qu'exige `docs/adr/0002`.**
 *
 * L'ADR nomme trois réglages et dit que l'un d'eux compte plus que les autres :
 * `setInvalidatedByBiometricEnrollment(true)`. Sa particularité n'est pas d'être plus
 * important en théorie — c'est que **son oubli ne se voit jamais**. Son défaut est `false` ;
 * l'application se lance, la clé se crée, la biométrie fonctionne, le coffre s'ouvre. Tout
 * marche, simplement pour quelqu'un de plus : celui qui a ajouté son empreinte au téléphone
 * de la victime.
 *
 * ## Pourquoi ce témoin lit le KeyStore et non notre propre code
 *
 * Un test qui vérifierait `politique(...).isInvalidatedByBiometricEnrollment` relirait la
 * consigne qu'on vient d'écrire. Il tomberait sur la mutation, ce qui est déjà quelque
 * chose — mais il ne dirait rien du seul fait qui compte : que **le magasin de clés a
 * retenu la consigne**. Celui-ci génère donc la vraie clé et relit ce que le magasin en
 * rapporte, par `KeyInfo`.
 *
 * ## Le contrôle, et pourquoi il est là
 *
 * Un témoin dont les deux branches de la mutation produisent la même sortie est vert des
 * deux côtés. Le contrôle a servi deux fois, et dans les deux sens : il a d'abord démoli le
 * témoin naïf de ce fichier — les deux clés rapportaient alors la même chose — puis, sur un
 * émulateur démarré à froid, il a montré qu'elles ne la rapportaient plus. La conclusion que
 * j'en avais tirée était donc fausse, et c'est le test figeant cette conclusion qui l'a dit.
 *
 * **Le comportement lui-même** — la clé cesse-t-elle de servir après un enrôlement ? —
 * demande d'enrôler une empreinte au milieu, ce qu'aucun test ne peut faire seul : il est
 * mesuré par [InvalidationDeLaCleTest], que pilote
 * `tools/android/temoin-de-l-invalidation.sh`. C'est lui qui fait autorité ; celui-ci
 * complète.
 *
 * ## Ce que ce témoin ne prouve pas
 *
 * Il ne rejoue pas un enrôlement d'empreinte — aucune API ne le permet à un test. Ce qu'il
 * établit est que la clé porte le drapeau qui provoque l'invalidation, et que le magasin le
 * distingue de son absence. L'effet de l'invalidation lui-même est le contrat d'Android,
 * pas le nôtre.
 */
class CleDEnveloppeTest {

    private val alias = "ch.stackops.ghostpass.test.enveloppe"
    private val aliasTemoin = "ch.stackops.ghostpass.test.enveloppe.sans"

    @Before
    fun table_rase() {
        CleDEnveloppe.oublier(alias)
        CleDEnveloppe.oublier(aliasTemoin)
    }

    @After
    fun ranger() {
        CleDEnveloppe.oublier(alias)
        CleDEnveloppe.oublier(aliasTemoin)
    }

    /**
     * Le plancher d'API, dit à voix haute.
     *
     * `minSdk` est 24 et la politique de l'ADR demande 28 (`setUnlockedDeviceRequired`).
     * Si ce test tombe sur un appareil plus ancien, c'est que le code a cessé de gater la
     * fonction : deux réglages sur trois seraient alors posés en silence.
     */
    @Test
    fun leRaccourciNEstProposeQueLaOuLaPolitiqueTientEntiere() {
        assertEquals(
            "la disponibilité doit suivre exactement le plancher de setUnlockedDeviceRequired",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P,
            CleDEnveloppe.disponible,
        )
    }

    /**
     * **`setInvalidatedByBiometricEnrollment(true)` est bien porté par la clé.**
     *
     * Ce test a une histoire, et elle vaut mieux que son assertion.
     *
     * Le premier jet affirmait `isInvalidatedByBiometricEnrollment == true` sur la clé de
     * production et se croyait concluant. Son contrôle l'a démenti : la **même** clé
     * construite avec `false` rapportait `true` elle aussi. J'en ai conclu que `KeyInfo`
     * dérivait la propriété du type d'authentificateur, écrit que le drapeau était
     * redondant, et figé cette observation dans un test.
     *
     * **Ce test-là vient de tomber**, sur un émulateur redémarré à froid : la clé de
     * production rapporte `true`, celle sans le drapeau `false`. Le magasin distingue donc
     * les deux consignes. La première mesure avait été prise sur un émulateur repris d'un
     * instantané, et quelque chose y faussait la lecture.
     *
     * Deux leçons, et la seconde est la plus utile :
     *
     *  - un test qui **fige une observation** attrape le jour où elle cesse d'être vraie.
     *    Sans lui, la documentation aurait continué d'affirmer une redondance fausse ;
     *  - une mesure prise une fois, sur une machine dont on ne contrôle pas l'état, n'est
     *    pas un fait. Celle-ci a tenu une demi-journée.
     *
     * Ce qui n'a pas changé : `tools/android/temoin-de-l-invalidation.sh` reste le témoin
     * **fort**, parce qu'il mesure le comportement — la clé cesse-t-elle de servir après un
     * enrôlement — et non ce que le magasin rapporte de lui-même.
     */
    @Test
    fun laCleDuCoffreEstInvalideeParUnNouvelEnrolement() {
        supposerLaPolitiqueTenable()
        val production = infoDe(CleDEnveloppe.creer(alias))
        assertTrue(
            "setInvalidatedByBiometricEnrollment(true) manque : le coffre resterait " +
                "ouvrable par une empreinte enrôlée après coup, et rien ne le signalerait",
            production.isInvalidatedByBiometricEnrollment,
        )

        // Le contrôle : la même politique **sans** le drapeau doit rapporter l'inverse.
        // Sans lui, on ne saurait pas si l'on mesure Android ou son propre écho — et c'est
        // exactement ce qui s'est produit la première fois.
        val sansLeDrapeau = infoDe(cleAvecPolitique(aliasTemoin, invalideeParEnrolement = false))
        assertFalse(
            "le magasin ne distingue plus les deux consignes : ce témoin est redevenu vert " +
                "quoi qu'on écrive dans le code. Reportez-vous à " +
                "tools/android/temoin-de-l-invalidation.sh, qui mesure le comportement.",
            sansLeDrapeau.isInvalidatedByBiometricEnrollment,
        )
    }

    /**
     * Les trois réglages, **dans la consigne** — et ce témoin est le faible des deux.
     *
     * Il tombe si quelqu'un retire une ligne du code. Il ne dirait rien si Android ignorait
     * la consigne. C'est tout ce qu'un test en processus peut établir pour deux des trois
     * réglages : `KeyInfo` ne rend ni `setUnlockedDeviceRequired` (aucun lecteur, à aucun
     * niveau d'API jusqu'à 36) ni `setInvalidatedByBiometricEnrollment` de façon utile
     * (voir au-dessus).
     *
     * Le dire vaut mieux que trois assertions d'apparence égale dont deux ne mesurent pas
     * la même chose que la troisième.
     */
    @Test
    fun lesTroisReglagesSontDansLaConsigne() {
        supposerLaPolitiqueTenable()
        val consigne = CleDEnveloppe.politique(alias)
        assertTrue(
            "setUserAuthenticationRequired(true) manque",
            consigne.isUserAuthenticationRequired,
        )
        assertTrue(
            "setInvalidatedByBiometricEnrollment(true) manque",
            consigne.isInvalidatedByBiometricEnrollment,
        )
        assertTrue(
            "setUnlockedDeviceRequired(true) manque : le coffre se déchiffrerait écran " +
                "verrouillé",
            consigne.isUnlockedDeviceRequired,
        )
    }

    /**
     * Le premier réglage de l'ADR, relu dans le magasin — et la durée qui le rend effectif.
     *
     * Les deux vont ensemble et le second est le moins évident : une durée de validité
     * **positive** ferait basculer la clé sur l'horloge du système plutôt que sur un
     * `CryptoObject`, et `setInvalidatedByBiometricEnrollment` cesserait alors de porter.
     * Le témoin le plus important d'au-dessus resterait vert, et n'invaliderait plus rien.
     */
    @Test
    fun lAuthentificationEstExigeeEtALUsage() {
        supposerLaPolitiqueTenable()
        val info = infoDe(CleDEnveloppe.creer(alias))

        assertTrue(
            "setUserAuthenticationRequired(true) manque : la clé sortirait sans biométrie",
            info.isUserAuthenticationRequired,
        )
        // Zéro sur l'API 30 et au-delà, `-1` en dessous : les deux veulent dire « à chaque
        // usage », et le lecteur de `KeyInfo` rend ce que la forme employée a écrit. Mesuré
        // sur émulateur — la valeur attendue n'est pas la même selon l'API, et écrire `-1`
        // partout faisait rougir un test parfaitement correct.
        val parUsage = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) 0 else -1
        assertEquals(
            "la clé doit exiger une authentification **par usage**. Une durée positive la " +
                "ferait basculer sur l'horloge du système, et l'invalidation par enrôlement " +
                "cesserait de porter — c'est ce que mesure leTemoinDeLInvalidationNEstPasVide",
            parUsage,
            info.userAuthenticationValidityDurationSeconds,
        )
    }

    /**
     * `android:allowBackup="false"`, mesuré sur l'application installée.
     *
     * L'ADR le range parmi ses exigences, et il a la même propriété désagréable que le
     * reste : l'oublier ne casse rien. Le coffre partirait simplement chez un sauvegardeur
     * qui n'est pas le nôtre, ce qu'un coffre à connaissance nulle promet de ne pas faire.
     *
     * Lu dans `ApplicationInfo` et non dans le manifeste du dépôt : c'est le paquet installé
     * qui décide, et une fusion de manifestes peut réintroduire le défaut d'une
     * bibliothèque.
     */
    @Test
    fun laSauvegardeAutomatiqueEstDesactivee() {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(
            "FLAG_ALLOW_BACKUP est posé sur l'application installée : l'enveloppe du coffre " +
                "partirait en sauvegarde",
            0,
            contexte.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP,
        )
    }

    // ─── Outillage ───

    /**
     * Une clé de contrôle, avec la **même** politique à un réglage près.
     *
     * Elle passe par [CleDEnveloppe.politique] et non par une seconde recette écrite ici :
     * une politique de contrôle qui divergerait ailleurs que sur le réglage mesuré ferait
     * un contrôle qui compare deux choses différentes.
     */
    private fun cleAvecPolitique(
        alias: String,
        invalideeParEnrolement: Boolean = true,
        secondesDeValidite: Int = 0,
    ): SecretKey {
        val generateur = javax.crypto.KeyGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generateur.init(
            CleDEnveloppe.politique(alias, invalideeParEnrolement, secondesDeValidite))
        return generateur.generateKey()
    }

    private fun infoDe(cle: SecretKey): KeyInfo {
        val fabrique = SecretKeyFactory.getInstance(cle.algorithm, "AndroidKeyStore")
        return fabrique.getKeySpec(cle, KeyInfo::class.java) as KeyInfo
    }

    /**
     * La politique ne peut pas se poser sans écran verrouillé **et** sans empreinte enrôlée.
     *
     * On **échoue** plutôt qu'on n'ignore : un test ignoré est un test qui n'a rien dit, et
     * un tableau vert où le témoin le plus important n'a jamais tourné est exactement ce
     * que ce fichier existe pour éviter. Le message explique comment préparer l'appareil.
     */
    private fun supposerLaPolitiqueTenable() {
        if (!CleDEnveloppe.disponible) {
            throw AssertionError(
                "Cet appareil est sous l'API 28 : la politique d'ADR-0002 ne peut pas y " +
                    "être posée, et le raccourci n'y est pas proposé. Faites tourner ce " +
                    "témoin sur un appareil plus récent.",
            )
        }
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        if (!Biometrie.disponible(contexte)) {
            throw AssertionError(
                "Aucune biométrie utilisable sur cet appareil : la clé ne peut pas être " +
                    "générée, et ce témoin ne peut donc rien mesurer. Sur émulateur :\n" +
                    "  adb shell locksettings set-pin 1234\n" +
                    "  adb root && adb shell settings put secure biometric_virtual_enabled 1\n" +
                    "  adb shell setprop persist.vendor.fingerprint.virtual.enrollments 1\n" +
                    "  adb shell cmd fingerprint sync\n" +
                    "« Pas pu regarder » n'est pas « conforme » : ce témoin échoue plutôt " +
                    "que de s'ignorer.",
            )
        }
    }
}
