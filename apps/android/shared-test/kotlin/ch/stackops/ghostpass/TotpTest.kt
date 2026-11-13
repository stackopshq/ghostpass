package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Les vecteurs de l'annexe B de la RFC 6238, pour les trois algorithmes, plus les règles de
 * lecture d'`apps/ios/Ghostpass/Services/Totp.swift`.
 *
 * Les vecteurs de la RFC sont la seule référence qui ne dépende d'aucun de nos clients : un
 * code juste ici est juste partout, iOS et web compris.
 */
class TotpTest {

    private val sha1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    private val sha256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA===="
    private val sha512 =
        "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" +
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA="

    private fun code(secret: String, algorithme: Totp.Algorithme, secondes: Long): String =
        Totp.code(Totp.Reglage(secret, 30, 8, algorithme), secondes * 1000)!!.code

    @Test
    fun vecteursDeLaRfcEnSha1() {
        assertEquals("94287082", code(sha1, Totp.Algorithme.SHA1, 59))
        assertEquals("07081804", code(sha1, Totp.Algorithme.SHA1, 1111111109))
        assertEquals("14050471", code(sha1, Totp.Algorithme.SHA1, 1111111111))
        assertEquals("89005924", code(sha1, Totp.Algorithme.SHA1, 1234567890))
        assertEquals("69279037", code(sha1, Totp.Algorithme.SHA1, 2000000000))
        assertEquals("65353130", code(sha1, Totp.Algorithme.SHA1, 20000000000))
    }

    @Test
    fun vecteursDeLaRfcEnSha256() {
        assertEquals("46119246", code(sha256, Totp.Algorithme.SHA256, 59))
        assertEquals("68084774", code(sha256, Totp.Algorithme.SHA256, 1111111109))
        assertEquals("91819424", code(sha256, Totp.Algorithme.SHA256, 1234567890))
        assertEquals("77737706", code(sha256, Totp.Algorithme.SHA256, 20000000000))
    }

    @Test
    fun vecteursDeLaRfcEnSha512() {
        assertEquals("90693936", code(sha512, Totp.Algorithme.SHA512, 59))
        assertEquals("25091201", code(sha512, Totp.Algorithme.SHA512, 1111111109))
        assertEquals("93441116", code(sha512, Totp.Algorithme.SHA512, 1234567890))
        assertEquals("47863826", code(sha512, Totp.Algorithme.SHA512, 20000000000))
    }

    /** Le zéro de tête se garde : « 07081804 » n'est pas « 7081804 ». */
    @Test
    fun leZeroDeTeteSeGarde() {
        assertEquals(8, code(sha1, Totp.Algorithme.SHA1, 1111111109).length)
    }

    @Test
    fun uneUriPorteSesReglages() {
        val r = Totp.lire(
            "otpauth://totp/GitHub:clara?secret=gezd%20gnbv&period=60&digits=8&algorithm=SHA256",
        )!!
        assertEquals("GEZDGNBV", r.secret)
        assertEquals(60, r.periode)
        assertEquals(8, r.chiffres)
        assertEquals(Totp.Algorithme.SHA256, r.algorithme)
    }

    @Test
    fun unSecretBrutPrendLesValeursParDefaut() {
        val r = Totp.lire("  jbsw y3dp ehpk 3pxp ")!!
        assertEquals("JBSWY3DPEHPK3PXP", r.secret)
        assertEquals(30, r.periode)
        assertEquals(6, r.chiffres)
        assertEquals(Totp.Algorithme.SHA1, r.algorithme)
    }

    /** Des réglages absurdes se corrigent plutôt que de faire tomber le calcul. */
    @Test
    fun lesReglagesAbsurdesSeCorrigent() {
        val r = Totp.lire("otpauth://totp/x?secret=JBSWY3DP&period=0&digits=42")!!
        assertEquals(30, r.periode)
        assertEquals(6, r.chiffres)
    }

    @Test
    fun rienNeDonneRien() {
        assertNull(Totp.lire(null))
        assertNull(Totp.lire("   "))
        assertNull(Totp.lire("otpauth://totp/x?issuer=Seul"))
        assertNull(Totp.codeCourant("!!!!"))
    }

    @Test
    fun leTempsRestantSuitLaPeriode() {
        val c = Totp.code(Totp.Reglage(sha1), 59_000)!!
        assertEquals(1, c.restant)
        assertEquals(30, Totp.code(Totp.Reglage(sha1), 60_000)!!.restant)
    }
}
