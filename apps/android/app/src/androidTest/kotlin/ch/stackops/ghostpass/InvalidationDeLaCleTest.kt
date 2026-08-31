package ch.stackops.ghostpass

import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator

/**
 * **L'exigence d'`docs/adr/0002`, mesurée sur le comportement et non sur un rapport.**
 *
 * L'ADR demande un test qui vérifie que la clé est bien invalidée par l'enrôlement d'une
 * nouvelle empreinte. [CleDEnveloppeTest] a montré qu'aucune lecture de `KeyInfo` ne peut
 * l'établir — la propriété qu'on croyait lire dérive du type d'authentificateur, pas de la
 * consigne, et rapporte `true` quoi qu'on écrive.
 *
 * Ce qui reste, et qui est en fait la seule preuve qui vaille : **enrôler une empreinte pour
 * de vrai, et regarder si la clé fonctionne encore**.
 *
 * Aucun test ne peut enrôler une empreinte. Cette classe est donc en **deux temps**, et
 * c'est `tools/android/temoin-de-l-invalidation.sh` qui les sépare :
 *
 * ```
 *   1. poserLesCles          — deux clés, et la preuve qu'elles servent
 *   2. [le script enrôle une empreinte de plus]
 *   3. relireLesCles         — la clé de production doit être morte
 * ```
 *
 * Les deux temps sont deux exécutions de processus distinctes ; les clés survivent entre
 * elles parce que l'`AndroidKeyStore` est un magasin du système, pas de l'application.
 *
 * ## Pourquoi `Cipher.init` suffit
 *
 * Une clé à authentification **par usage** ne peut pas être *utilisée* dans un test : il
 * faudrait traverser un `BiometricPrompt`. Mais `Cipher.init` n'a pas besoin
 * d'authentification, et c'est précisément lui qui lève
 * `KeyPermanentlyInvalidatedException` quand la clé a été invalidée. C'est aussi le point
 * exact où le code de production s'en aperçoit ([CleDEnveloppe.pourOuvrir]) : on mesure
 * donc **là où le consommateur lit**.
 *
 * ## La seconde clé, et ce qu'elle sert à distinguer
 *
 * Un témoin qui verrait mourir la clé de production ne saurait pas dire si c'est
 * l'enrôlement qui l'a tuée ou l'exécution du script. [ALIAS_TEMOIN] porte donc la même
 * politique avec une **durée de validité** au lieu d'une authentification par usage. Elle
 * doit **survivre** au même enrôlement. Si les deux meurent, on ne mesure pas l'enrôlement ;
 * si les deux vivent, on ne mesure rien du tout.
 */
@TemoinPilote
class InvalidationDeLaCleTest {

    companion object {
        /** La clé de production : authentification par usage, biométrie forte. */
        const val ALIAS_PRODUCTION = "ch.stackops.ghostpass.temoin.invalidation.production"

        /**
         * Le contrôle : **aucune authentification**, donc rien qui l'attache aux empreintes.
         *
         * Elle doit traverser l'enrôlement intacte. Son rôle est d'écarter le seul autre
         * coupable possible de la mort de l'autre : un magasin vidé, une réinstallation, un
         * `-wipe-data`. Si celle-ci meurt aussi, ce n'est pas l'enrôlement qu'on mesure.
         */
        const val ALIAS_SANS_AUTH = "ch.stackops.ghostpass.temoin.invalidation.sansauth"

        /** Le second contrôle : même biométrie, mais authentification **datée**. */
        const val ALIAS_DATEE = "ch.stackops.ghostpass.temoin.invalidation.datee"
    }

    /**
     * L'état d'une clé, tel que `Cipher.init` le rapporte.
     *
     * Les trois états ne se confondent pas, et le second est celui qu'on aurait pris pour le
     * troisième — mesuré en écrivant ce fichier : une clé à authentification **datée** lève
     * `UserNotAuthenticatedException` dès l'`init`, là où une clé **par usage** s'initialise
     * sans rien demander et n'exige l'authentification qu'au `doFinal`.
     *
     * Confondre « il faut vous authentifier » et « cette clé est morte » ferait effacer
     * l'enveloppe du coffre de quelqu'un qui n'avait qu'à poser son doigt.
     */
    private enum class Etat {
        /** `init` a réussi. */
        VIVANTE,

        /** La clé existe et fonctionne, mais réclame une authentification fraîche. */
        AUTHENTIFICATION_MANQUANTE,

        /** La clé est définitivement invalidée : un nouvel enrôlement l'a tuée. */
        INVALIDEE,

        /** Aucune clé sous cet alias. */
        ABSENTE,
    }

    /** Premier temps : poser les trois clés, et relever leur état de départ. */
    @Test
    fun poserLesCles() {
        exigerUnAppareilCapable()
        for (alias in listOf(ALIAS_PRODUCTION, ALIAS_SANS_AUTH, ALIAS_DATEE)) {
            CleDEnveloppe.oublier(alias)
        }

        engendrer(ALIAS_PRODUCTION, secondesDeValidite = 0)
        engendrerSansAuthentification(ALIAS_SANS_AUTH)
        engendrer(ALIAS_DATEE, secondesDeValidite = 300)

        assertEquals(
            "avant tout enrôlement, la clé de production doit s'initialiser sans rien " +
                "demander — sinon le second temps ne mesurerait pas l'enrôlement",
            Etat.VIVANTE,
            etat(ALIAS_PRODUCTION),
        )
        assertEquals("le contrôle sans authentification doit vivre", Etat.VIVANTE, etat(ALIAS_SANS_AUTH))
        assertNotEquals(
            "la clé datée ne doit pas être invalidée au départ",
            Etat.INVALIDEE,
            etat(ALIAS_DATEE),
        )
    }

    /** Second temps, après un enrôlement : la clé de production doit être morte. */
    @Test
    fun relireLesCles() {
        exigerUnAppareilCapable()
        assertNotNull(
            "aucune clé posée : lancez tools/android/temoin-de-l-invalidation.sh, qui " +
                "enchaîne les deux temps. Ce test seul ne prouve rien.",
            CleDEnveloppe.cle(ALIAS_PRODUCTION),
        )

        val production = etat(ALIAS_PRODUCTION)
        val sansAuth = etat(ALIAS_SANS_AUTH)
        val datee = etat(ALIAS_DATEE)

        assertEquals(
            "LA CLÉ DU COFFRE A SURVÉCU À UN NOUVEL ENRÔLEMENT (état : $production).\n" +
                "C'est exactement la porte que l'authentification par usage sur biométrie " +
                "forte doit fermer : quelqu'un qui ajoute son empreinte au téléphone " +
                "déverrouillé de sa victime obtiendrait le coffre.\n" +
                "États relevés — production=$production sansAuth=$sansAuth datée=$datee",
            Etat.INVALIDEE,
            production,
        )
        assertEquals(
            "le contrôle sans authentification devait survivre : s'il est mort lui aussi, " +
                "ce n'est pas l'enrôlement qu'on mesure mais un magasin vidé (état : $sansAuth)",
            Etat.VIVANTE,
            sansAuth,
        )
        assertNotEquals(
            "la clé datée a survécu, elle : c'est ce qui rend une durée de validité " +
                "dangereuse, et ce que le code de production évite en gardant zéro seconde. " +
                "Si elle est invalidée elle aussi, tant mieux — mais alors ce commentaire ment.",
            Etat.INVALIDEE,
            datee,
        )
    }

    // ─── Outillage ───

    private fun engendrer(alias: String, secondesDeValidite: Int) {
        val generateur = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generateur.init(
            CleDEnveloppe.politique(alias, secondesDeValidite = secondesDeValidite))
        generateur.generateKey()
    }

    /** Le contrôle : la même forme de clé, sans aucune exigence d'authentification. */
    private fun engendrerSansAuthentification(alias: String) {
        val generateur = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generateur.init(
            android.security.keystore.KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        generateur.generateKey()
    }

    /**
     * L'état de la clé, mesuré **là où le code de production le lit** : `Cipher.init`.
     *
     * `init` ne demande aucune authentification pour une clé par usage, et c'est lui qui
     * lève `KeyPermanentlyInvalidatedException` quand la clé est morte — le point exact où
     * [CleDEnveloppe.pourOuvrir] s'en aperçoit.
     */
    private fun etat(alias: String): Etat {
        val cle = CleDEnveloppe.cle(alias) ?: return Etat.ABSENTE
        return try {
            Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, cle)
            Etat.VIVANTE
        } catch (_: KeyPermanentlyInvalidatedException) {
            Etat.INVALIDEE
        } catch (_: UserNotAuthenticatedException) {
            Etat.AUTHENTIFICATION_MANQUANTE
        }
    }

    private fun exigerUnAppareilCapable() {
        if (!CleDEnveloppe.disponible) {
            throw AssertionError("Appareil sous l'API 28 : la politique d'ADR-0002 n'y tient pas.")
        }
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        if (!Biometrie.disponible(contexte)) {
            throw AssertionError(
                "Aucune biométrie enrôlée : ce témoin ne peut rien mesurer. " +
                    "tools/android/temoin-de-l-invalidation.sh sait préparer un émulateur.",
            )
        }
        // Une garde de plus, gratuite : si le plancher bougeait sans que la politique suive,
        // les deux temps mesureraient deux formes de clé différentes.
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
    }
}
