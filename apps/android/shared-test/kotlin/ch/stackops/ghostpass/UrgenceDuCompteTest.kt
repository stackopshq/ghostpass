package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Les mots de l'urgence, et le repli qu'il ne faut **surtout pas** faire.
 */
class UrgenceDuCompteTest {

    @Test
    fun lesRolesEtLesEtatsSontCeuxDuServeur() {
        assertEquals(UrgenceDuCompte.Role.LECTURE, UrgenceDuCompte.Role.parCle("view"))
        assertEquals(UrgenceDuCompte.Role.REPRISE, UrgenceDuCompte.Role.parCle("takeover"))
        for ((cle, etat) in listOf(
            "invited" to UrgenceDuCompte.Etat.INVITE,
            "accepted" to UrgenceDuCompte.Etat.ACCEPTE,
            "requested" to UrgenceDuCompte.Etat.DEMANDE,
            "granted" to UrgenceDuCompte.Etat.OUVERT,
            "rejected" to UrgenceDuCompte.Etat.REFUSE,
        )) {
            assertEquals("l'état « $cle » du serveur n'est pas reconnu", etat, UrgenceDuCompte.Etat.parCle(cle))
        }
    }

    /**
     * **Un rôle inconnu ne retombe pas sur « lecture seule ».**
     *
     * Le repli paraît prudent et ne l'est pas : un rôle qu'une version plus récente du
     * serveur journaliserait pourrait en autoriser davantage, et l'écran afficherait
     * « lecture seule » sur un lien qui permet la reprise du compte. L'utilisateur
     * choisirait alors de le laisser en place en croyant ne rien risquer.
     *
     * `null` force l'écran à dire qu'il ne comprend pas, ce qui est la seule réponse honnête.
     */
    @Test
    fun unRoleInconnuNeRetombePasSurLePlusFaible() {
        assertNull(
            "un rôle inconnu est présenté comme « lecture seule » : un lien qui permettrait " +
                "la reprise s'afficherait comme inoffensif",
            UrgenceDuCompte.Role.parCle("takeover.v2"),
        )
        assertNull(UrgenceDuCompte.Role.parCle(""))
        assertNull(UrgenceDuCompte.Etat.parCle("expired"))
    }

    @Test
    fun lOuverturePrevueNeVautQuePourUneDemandeEnCours() {
        val demandeLe = 1_700_000_000_000L
        assertEquals(
            demandeLe + 7L * 86_400_000L,
            UrgenceDuCompte.ouverturePrevue("requested", demandeLe, 7),
        )
        // Les autres états n'ont pas de date d'ouverture : en afficher une laisserait croire
        // qu'un compte s'ouvrira alors que rien n'a été demandé.
        for (etat in listOf("invited", "accepted", "granted", "rejected")) {
            assertNull(UrgenceDuCompte.ouverturePrevue(etat, demandeLe, 7))
        }
        // Et une demande sans horodatage ne produit pas une date inventée.
        assertNull(UrgenceDuCompte.ouverturePrevue("requested", null, 7))
    }
}
