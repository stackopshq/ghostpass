package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le SSO mobile côté client : le calcul PKCE et la lecture du retour.
 *
 * Ces deux-là **sont** la sécurité du dispositif côté application. Le reste — l'échange, la
 * liste blanche, l'usage unique du code — est éprouvé côté serveur.
 *
 * ## Sur les témoins creux, et celui qu'on a failli écrire
 *
 * La session iOS signale avoir dû corriger un témoin **creux** : son cas de test portait un
 * code *et* un état étranger, où les deux ordres de vérification — état d'abord, ou code
 * d'abord — produisent le même refus. Le test était vert dans les deux mondes.
 *
 * Les cas ci-dessous sont donc choisis pour que les branches **divergent** :
 *
 *  - [lEtatSeVerifieAvantLeCode] : état étranger **et** pas de code. Vérifier l'état
 *    d'abord rend « état inattendu » ; vérifier le code d'abord rend « sans code ». Deux
 *    sorties différentes, donc un test qui distingue vraiment les deux ordres ;
 *  - [unEtatEtrangerEstRefuseMemeAvecUnCodeValide] : état étranger **avec** un code. Une
 *    implémentation qui aurait oublié la vérification d'état rendrait ici un succès. C'est
 *    la faute grave, distincte de l'ordre ;
 *  - [lEchecEstLAbsenceDeCodePasLaPresenceDErreur] : un retour qui porte **à la fois** un
 *    code et une `error`. Un client qui teste `error` refuse ; un client qui teste
 *    l'absence de code accepte. Là encore les branches divergent.
 */
class SsoMobileTest {

    /**
     * Le vecteur de la RFC 7636, annexe B.
     *
     * Il vient de la norme et non de notre code : il vérifie qu'on calcule ce que le monde
     * calcule, pas qu'on est cohérent avec soi-même.
     */
    @Test
    fun leDefiSuitLeVecteurDeLaNorme() {
        val pkce = SsoMobile.Pkce.avec("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", pkce.defi)
    }

    /**
     * Le défi fait 43 caractères base64url sans remplissage.
     *
     * Le serveur l'exige et refuse au `start`. Un défi avec remplissage en ferait 44 :
     * l'erreur reviendrait avant même l'ouverture du navigateur, ce qui est le bon endroit,
     * mais autant ne pas la provoquer.
     */
    @Test
    fun leDefiFait43CaracteresSansRemplissage() {
        repeat(20) {
            val defi = SsoMobile.Pkce.tirer().defi
            assertEquals(defi, 43, defi.length)
            assertFalse(defi, defi.contains('='))
            assertFalse(defi, defi.contains('+'))
            assertFalse(defi, defi.contains('/'))
        }
    }

    /** Un vérificateur prévisible annulerait tout le dispositif. */
    @Test
    fun deuxTiragesDifferent() {
        assertNotEquals(SsoMobile.Pkce.tirer().verificateur, SsoMobile.Pkce.tirer().verificateur)
        assertNotEquals(SsoMobile.chaineAleatoire(16), SsoMobile.chaineAleatoire(16))
    }

    /** L'adresse d'ouverture porte les quatre paramètres que le serveur attend. */
    @Test
    fun lAdresseDeDepartPorteCeQueLeServeurAttend() {
        val url = SsoMobile.adresseDeDepart(
            "https://ghostpass.example.com/", defi = "LE_DEFI", etat = "LETAT")
        assertTrue(url, url.startsWith("https://ghostpass.example.com/api/auth/sso/mobile/start?"))
        assertTrue(url, url.contains("code_challenge=LE_DEFI"))
        assertTrue(url, url.contains("code_challenge_method=S256"))
        assertTrue(url, url.contains("state=LETAT"))
        assertTrue(
            "le `redirect_uri` doit être celui de la liste blanche du serveur",
            url.contains("redirect_uri=ch.stackops.ghostpass%3A%2F%2Fsso"),
        )
    }

    // ─── La lecture du retour ───

    @Test
    fun unRetourNormalRendLeCode() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?code=ABC123&state=LETAT", etatAttendu = "LETAT")
        assertEquals("ABC123", resultat.getOrNull())
    }

    /**
     * **L'échec est l'absence de `code`, pas la présence d'`error`.**
     *
     * Ce retour porte les deux. Un client qui teste `error` et abandonne refuserait un
     * retour parfaitement bon ; un client qui teste l'absence de code l'accepte. Les deux
     * branches divergent ici, ce qui est le but.
     *
     * L'inverse — tester `error` et poursuivre — appellerait l'échange avec un code vide et
     * lirait le refus du serveur comme une panne réseau plutôt que comme un rejet
     * d'authentification.
     */
    @Test
    fun lEchecEstLAbsenceDeCodePasLaPresenceDErreur() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?code=ABC123&error=quelque_chose&state=LETAT",
            etatAttendu = "LETAT",
        )
        assertEquals(
            "un retour qui porte un code **et** une erreur reste un succès : c'est le code " +
                "qui décide",
            "ABC123",
            resultat.getOrNull(),
        )
    }

    /**
     * L'état étranger est refusé **même quand un code est présent**.
     *
     * C'est la faute grave que ce test attrape : une implémentation qui aurait oublié la
     * vérification d'état rendrait ici un succès, et ouvrirait une session qu'un tiers a
     * lancée.
     */
    @Test
    fun unEtatEtrangerEstRefuseMemeAvecUnCodeValide() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?code=ABC123&state=ETRANGER", etatAttendu = "LETAT")
        assertTrue("un état étranger doit être refusé", resultat.isFailure)
        assertEquals(
            SsoMobile.EchecDeRetour.EtatInattendu,
            (resultat.exceptionOrNull() as SsoMobile.ErreurDeRetour).echec,
        )
    }

    /**
     * **L'état se vérifie avant le code**, et ce test distingue vraiment les deux ordres.
     *
     * Le retour n'a pas de code et porte un état étranger. Vérifier l'état d'abord rend
     * « état inattendu » ; vérifier le code d'abord rendrait « sans code, motif
     * not_provisioned » — et l'application afficherait « cette adresse n'a pas de compte »
     * sur la foi d'un motif fourni par un retour qui n'est pas le sien.
     *
     * C'est exactement le cas que le témoin iOS ne couvrait pas : le sien portait un code,
     * où les deux ordres se rejoignent sur le même refus.
     */
    @Test
    fun lEtatSeVerifieAvantLeCode() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?error=not_provisioned&state=ETRANGER",
            etatAttendu = "LETAT",
        )
        assertEquals(
            "un retour qui n'est pas le nôtre ne mérite pas qu'on lise ce qu'il transporte : " +
                "son motif d'erreur ne doit pas atteindre l'utilisateur",
            SsoMobile.EchecDeRetour.EtatInattendu,
            (resultat.exceptionOrNull() as SsoMobile.ErreurDeRetour).echec,
        )
    }

    /** Un retour sans code, mais bien le nôtre, dit pourquoi. */
    @Test
    fun unRetourSansCodeDitPourquoi() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?error=not_provisioned&state=LETAT",
            etatAttendu = "LETAT",
        )
        val echec = (resultat.exceptionOrNull() as SsoMobile.ErreurDeRetour).echec
        assertEquals(SsoMobile.EchecDeRetour.SansCode("not_provisioned"), echec)
        assertTrue(
            "le motif « compte non provisionné » a son propre message : le SSO ne crée " +
                "jamais de compte, et « échec de l'authentification » enverrait chercher " +
                "un mot de passe",
            SsoMobile.ErreurDeRetour.message(echec).contains("n'a pas de compte"),
        )
    }

    /** Un code vide vaut un code absent : les deux refusent. */
    @Test
    fun unCodeVideEstUnCodeAbsent() {
        val resultat = SsoMobile.codeDuRetour(
            "ch.stackops.ghostpass://sso?code=&state=LETAT", etatAttendu = "LETAT")
        assertTrue(resultat.isFailure)
        assertTrue(
            (resultat.exceptionOrNull() as SsoMobile.ErreurDeRetour).echec
                is SsoMobile.EchecDeRetour.SansCode,
        )
    }

    /** Un retour sans aucun paramètre n'est pas le nôtre non plus. */
    @Test
    fun unRetourSansParametreEstRefuse() {
        val resultat = SsoMobile.codeDuRetour("ch.stackops.ghostpass://sso", etatAttendu = "LETAT")
        assertEquals(
            SsoMobile.EchecDeRetour.EtatInattendu,
            (resultat.exceptionOrNull() as SsoMobile.ErreurDeRetour).echec,
        )
    }
}
