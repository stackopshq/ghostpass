package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Les vecteurs d'`apps/ios/Tests/ContractTests.swift`, classe `EtiquetteOtpauthTests`,
 * **portés tels quels**.
 *
 * Ils ne sont pas dans `assets/vecteurs/contrat.json` : ce sont des règles de lecture d'un
 * format extérieur, pas des valeurs que trois clients doivent partager. Ils vivent donc où
 * vit leur code, des deux côtés — et à l'identique, ce qui est ce qu'on peut vérifier.
 */
class LienOtpauthTest {

    @Test
    fun serviceEtCompteDepuisLeChemin() {
        val e = LienOtpauth.etiquette("otpauth://totp/GitHub:clara?secret=GEZDGNBVGY3TQOJQ")
        assertEquals("GitHub", e.service)
        assertEquals("clara", e.compte)
    }

    /**
     * Le paramètre `issuer` l'emporte sur le chemin.
     *
     * Les deux sources se contredisent dans la nature — un service renommé met à jour le
     * paramètre et laisse le chemin d'origine. Le paramètre fait foi : il n'a pas à être
     * échappé, donc il ne peut pas être coupé par un deux-points du nom.
     */
    @Test
    fun leParametreIssuerLEmporteSurLeChemin() {
        val e = LienOtpauth.etiquette(
            "otpauth://totp/Ancien:clara?secret=GEZDGNBVGY3TQOJQ&issuer=Nouveau")
        assertEquals("Nouveau", e.service)
        assertEquals("clara", e.compte)
    }

    @Test
    fun unCheminSansDeuxPointsEstUnCompte() {
        val e = LienOtpauth.etiquette("otpauth://totp/clara@example.com?secret=GEZDGNBVGY3TQOJQ")
        assertNull(e.service)
        assertEquals("clara@example.com", e.compte)
    }

    /** « Site%20local » doit s'afficher « Site local » : c'est le nom qu'on verra au coffre. */
    @Test
    fun lesEspacesEchappesSontRendusLisibles() {
        val e = LienOtpauth.etiquette(
            "otpauth://totp/Site%20local:clara?secret=GEZDGNBVGY3TQOJQ&issuer=Site%20local")
        assertEquals("Site local", e.service)
        assertEquals("clara", e.compte)
    }

    /**
     * Le secret est la seule chose qu'un lien garantisse : une étiquette absente ou vide ne
     * doit jamais empêcher d'enregistrer un second facteur valide.
     */
    @Test
    fun uneEtiquetteVideNEmpecheRien() {
        val e = LienOtpauth.etiquette("otpauth://totp/?secret=GEZDGNBVGY3TQOJQ")
        assertNull(e.service)
        assertNull(e.compte)
        assertEquals("GEZDGNBVGY3TQOJQ", LienOtpauth.secret("otpauth://totp/?secret=GEZDGNBVGY3TQOJQ"))
    }

    @Test
    fun ceQuiNEstPasUnLienOtpauthNaPasDEtiquette() {
        for (entree in listOf("GEZDGNBVGY3TQOJQ", "", "https://example.com/totp/x", "otpauth:/")) {
            val e = LienOtpauth.etiquette(entree)
            assertNull(entree, e.service)
            assertNull(entree, e.compte)
        }
    }

    /** Ce que le système a le droit de nous faire ouvrir. */
    @Test
    fun seulUnLienDeSecondFacteurEstRetenu() {
        assertTrue(LienOtpauth.estUnLienDeTotp("otpauth://totp/GitHub:clara?secret=GEZDGNBVGY3TQOJQ"))

        for (refuse in listOf(
            // L'export d'une application d'authentification : plusieurs comptes dans un
            // protobuf compressé, que nous ne savons pas lire.
            "otpauth-migration://offline?data=AAAA",
            // Un lien sans secret ne configure rien.
            "otpauth://totp/GitHub:clara",
            "https://example.com/otpauth",
        )) {
            assertFalse(refuse, LienOtpauth.estUnLienDeTotp(refuse))
        }
    }

    // ─── Ce que les vecteurs d'iOS ne couvrent pas, et qui arrive ───

    /**
     * Le secret se normalise : sans espaces, en capitales.
     *
     * Les applications qui affichent un secret l'espacent par groupes de quatre pour le
     * rendre recopiable. Un secret gardé tel quel échoue au décodage base32 — et l'échec
     * apparaît à la première génération de code, pas à l'enregistrement.
     */
    @Test
    fun leSecretEstNormalise() {
        assertEquals(
            "GEZDGNBVGY3TQOJQ",
            LienOtpauth.secret("otpauth://totp/A:b?secret=gezd%20gnbv%20gy3t%20qojq"),
        )
    }

    /** Un secret vide vaut un secret absent : les deux refusent le lien. */
    @Test
    fun unSecretVideEstUnSecretAbsent() {
        assertNull(LienOtpauth.secret("otpauth://totp/A:b?secret="))
        assertFalse(LienOtpauth.estUnLienDeTotp("otpauth://totp/A:b?secret="))
    }
}
