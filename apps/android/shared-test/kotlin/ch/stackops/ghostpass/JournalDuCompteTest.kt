package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le journal, et les deux façons qu'il a de trahir son objet.
 *
 * Cet écran existe pour qu'on s'aperçoive qu'un accès n'était pas le sien. Il échoue donc
 * de deux manières, et aucune ne ressemble à une panne :
 *
 *  - **il se tait sur ce qu'il ne connaît pas.** Une action journalisée par un serveur plus
 *    récent, masquée faute de traduction, serait exactement la ligne inattendue qu'on
 *    cherchait ;
 *  - **il noie la ligne qui compte.** « Second facteur désactivé » au milieu de trente
 *    connexions ordinaires, sans marque, ne se remarque pas.
 */
class JournalDuCompteTest {

    @Test
    fun lesActionsConnuesSeLisentEnFrancais() {
        assertEquals("Second facteur désactivé", JournalDuCompte.intitule("mfa.disable"))
        assertEquals("Connexion par mot de passe", JournalDuCompte.intitule("login.password"))
        assertEquals("Clé d'équipe renouvelée", JournalDuCompte.intitule("org.key.rotate"))
        assertEquals("Accès d'urgence accordé", JournalDuCompte.intitule("emergency.approve"))
    }

    /**
     * **Une action inconnue s'affiche telle quelle**, et ne disparaît pas.
     *
     * C'est le point de ce fichier. Une version plus récente du serveur journalisera des
     * actions que cette version de l'application ne connaît pas ; les masquer reviendrait à
     * cacher la nouveauté même que le journal doit révéler. Une ligne brute est laide et
     * utile ; une ligne absente est propre et fausse.
     */
    @Test
    fun uneActionInconnueEstRendueTelleQuelle() {
        assertEquals(
            "une action que cette version ne connaît pas a disparu du journal : c'est " +
                "précisément la ligne inattendue qu'on y cherchait",
            "account.exported.v2",
            JournalDuCompte.intitule("account.exported.v2"),
        )
        assertEquals("", JournalDuCompte.intitule(""))
    }

    @Test
    fun lesActionsQuiRetirentUneProtectionSontSignalees() {
        for (action in listOf(
            "mfa.disable", "recovery.reset", "passkey.remove", "webauthn.remove",
            "emergency.approve", "org.member.add", "org.key.rotate", "org.group.access.grant",
        )) {
            assertTrue(
                "« $action » retire une protection ou ouvre le coffre à quelqu'un d'autre, " +
                    "et n'est pas signalée : elle se perdra au milieu des connexions",
                JournalDuCompte.estSensible(action),
            )
        }
    }

    @Test
    fun lesActionsOrdinairesNeSontPasSignalees() {
        // Le contrôle du contrôle : tout signaler reviendrait à ne rien signaler. Sans
        // cette moitié, le témoin d'au-dessus passerait aussi avec un `estSensible` qui
        // rendrait toujours `true`.
        for (action in listOf(
            "login.password", "login.sso", "logout", "mfa.enable", "passkey.add",
            "org.group.create", "action.inconnue",
        )) {
            assertFalse(
                "« $action » est signalée comme sensible alors qu'elle n'ôte aucune " +
                    "protection : tout surligner revient à ne rien surligner",
                JournalDuCompte.estSensible(action),
            )
        }
    }

    /**
     * Les deux moitiés de chaque paire ne se valent pas.
     *
     * Ajouter une passkey est ordinaire ; en retirer une ôte un moyen d'entrer. Activer un
     * second facteur protège ; le désactiver découvre. Le témoin les met côte à côte parce
     * que c'est l'endroit où une inversion passerait inaperçue — et une inversion rendrait
     * le journal exactement inutile.
     */
    @Test
    fun lAjoutEtLeRetraitNeSeValentPas() {
        assertFalse(JournalDuCompte.estSensible("mfa.enable"))
        assertTrue(JournalDuCompte.estSensible("mfa.disable"))
        assertFalse(JournalDuCompte.estSensible("passkey.add"))
        assertTrue(JournalDuCompte.estSensible("passkey.remove"))
        assertFalse(JournalDuCompte.estSensible("webauthn.add"))
        assertTrue(JournalDuCompte.estSensible("webauthn.remove"))
        // Et l'asymétrie inverse, qui surprend : **accorder** un accès à une collection est
        // sensible, le retirer ne l'est pas. Ce qui ouvre le coffre à quelqu'un d'autre
        // mérite un regard ; ce qui le referme non.
        assertTrue(JournalDuCompte.estSensible("org.group.access.grant"))
        assertFalse(JournalDuCompte.estSensible("org.group.access.revoke"))
    }

    @Test
    fun laListeDesSensiblesEstCelleDIOs() {
        // Écrite en toutes lettres : si les deux plateformes divergeaient, le même compte
        // signalerait des lignes différentes selon l'écran d'où on le regarde, et rien ne
        // dirait laquelle des deux a raison.
        assertEquals(8, JournalDuCompte.SENSIBLES.size)
    }
}
