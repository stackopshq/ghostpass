package ch.stackops.ghostpass

import android.content.Context
import android.content.res.Configuration
import androidx.test.platform.app.InstrumentationRegistry
import ch.stackops.ghostpass.ui.intituleDuJournal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Le journal se lit **dans les deux langues**, et une action inconnue reste visible.
 *
 * Ce témoin remplace la moitié de `JournalDuCompteTest` qui vérifiait les intitulés : ils
 * sont devenus des chaînes de ressource, invisibles depuis la JVM du poste. Il y gagne, car
 * il peut désormais vérifier ce que l'ancien ne pouvait pas — que l'anglais **existe**.
 *
 * ## Pourquoi comparer les deux langues plutôt que lire l'anglais
 *
 * Une clé absente de `values-en/` ne produit **aucune erreur** : Android retombe
 * silencieusement sur `values/`, et l'écran affiche du français au milieu de l'anglais. Un
 * test qui se contenterait de vérifier que la chaîne anglaise n'est pas vide passerait donc
 * au vert sur une traduction entièrement manquante. C'est le repli silencieux dans sa forme
 * la plus pure : le mécanisme de secours produit exactement ce que produirait un succès.
 *
 * On exige donc que les deux **diffèrent**. Ces vingt-trois libellés n'ont aucun mot commun
 * entre les deux langues ; l'exigence est sûre pour eux. Elle ne le serait pas pour toutes
 * les chaînes de l'application — « GhostPass », « Configuration », « Email » se disent de
 * la même façon — et c'est pourquoi la parité générale des deux catalogues se vérifie sur
 * les fichiers eux-mêmes, par `tools/android/temoin-des-traductions.sh`.
 */
class JournalTraduitTest {

    /** Tous les codes d'action que l'application sait nommer. */
    private val codes = listOf(
        "login.password", "login.passkey", "login.sso", "logout",
        "mfa.enable", "mfa.disable", "recovery.reset",
        "passkey.add", "passkey.remove", "webauthn.add", "webauthn.remove",
        "emergency.grant", "emergency.request", "emergency.approve",
        "org.member.add", "org.member.role", "org.key.rotate",
        "org.group.create", "org.group.delete",
        "org.group.member.add", "org.group.member.remove",
        "org.group.access.grant", "org.group.access.revoke",
    )

    private fun dans(langue: String): Context {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val config = Configuration(base.resources.configuration)
        config.setLocale(Locale(langue))
        return base.createConfigurationContext(config)
    }

    @Test
    fun chaqueActionConnueSeLitDansLesDeuxLangues() {
        val fr = dans("fr")
        val en = dans("en")
        for (code in codes) {
            val cle = intituleDuJournal(code)
            assertTrue("« $code » n'a plus d'intitulé du tout", cle != null)
            val enFrancais = fr.getString(cle!!)
            val enAnglais = en.getString(cle)
            assertTrue("« $code » a un intitulé vide", enFrancais.isNotBlank())
            assertNotEquals(
                "« $code » rend le même texte en anglais qu'en français : sa clé manque " +
                    "sans doute de values-en/, et Android retombe sur le français sans rien " +
                    "dire. L'écran serait à moitié traduit, et aucun test ne le verrait.",
                enFrancais,
                enAnglais,
            )
        }
    }

    /**
     * **Une action inconnue reste visible telle quelle**, et ne disparaît pas.
     *
     * C'est le point de ce journal. Une version plus récente du serveur journalisera des
     * actions que cette version ne connaît pas ; les masquer reviendrait à cacher la
     * nouveauté même que le journal doit révéler. Une ligne brute est laide et utile ; une
     * ligne absente est propre et fausse.
     *
     * `null` est ce que rend la fonction dans ce cas, et l'écran affiche alors le code brut.
     */
    @Test
    fun uneActionInconnueNAPasDIntituleEtResteAffichable() {
        assertNull(intituleDuJournal("account.exported.v2"))
        assertNull(intituleDuJournal(""))
    }

    /**
     * **Toutes les actions signalées comme sensibles savent se nommer.**
     *
     * Une action sensible qui s'afficherait en `org.key.rotate` serait surlignée sans être
     * lisible : le journal la désignerait du doigt sans dire ce qu'elle est. C'est le pire
     * des deux mondes, et rien d'autre ne l'attraperait — la règle vit dans `:noyau`, les
     * intitulés dans `:app`, et personne ne les compare.
     */
    @Test
    fun lesActionsSensiblesSaventToutesSeNommer() {
        val sansNom = JournalDuCompte.SENSIBLES.filter { intituleDuJournal(it) == null }
        assertEquals(
            "ces actions sont signalées comme sensibles mais s'afficheraient en code brut : " +
                sansNom.joinToString(", "),
            emptyList<String>(),
            sansNom,
        )
    }
}
