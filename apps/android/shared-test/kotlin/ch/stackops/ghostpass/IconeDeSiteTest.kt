package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L'URL du relais d'icônes — et surtout les cas où il ne faut **pas** en fabriquer une.
 *
 * Le témoin qui compte est le premier : sans jeton, pas d'URL. Il garde la leçon qui a
 * coûté une heure sur iOS — une requête vouée au `401` retombe sur la pastille d'initiale,
 * c'est-à-dire sur le repli prévu quand un site n'a pas d'icône. Le contrat rompu prend
 * alors l'apparence d'un cas nominal, sur toute la liste à la fois, et rien à l'écran ne
 * distingue « ce site n'a pas de logo » de « le client ne s'authentifie plus ».
 */
class IconeDeSiteTest {

    @Test
    fun sansJetonAucuneUrlNEstFabriquee() {
        assertNull(IconeDeSite.url("https://github.com", "https://gp.example.com", null))
        assertNull(IconeDeSite.url("https://github.com", "https://gp.example.com", ""))
    }

    @Test
    fun avecJetonLUrlPorteLeDomaineEtLeJeton() {
        val url = IconeDeSite.url("https://www.github.com/login", "https://gp.example.com", "j-3")
        assertEquals("https://gp.example.com/api/icons?domain=github.com&t=j-3", url)
    }

    /**
     * Un serveur monté sous un sous-chemin garde son préfixe : c'est la règle de
     * [ClientApi], et la seule qui marche pour un déploiement derrière un mandataire.
     */
    @Test
    fun unServeurSousSousCheminGardeSonPrefixe() {
        val url = IconeDeSite.url("github.com", "https://exemple.org/gp", "j")
        assertEquals("https://exemple.org/gp/api/icons?domain=github.com&t=j", url)
    }

    @Test
    fun uneAdresseDeServeurVideNeDonnePasDUrlRelative() {
        assertNull(IconeDeSite.url("github.com", "", "j"))
        assertNull(IconeDeSite.url("github.com", "   ", "j"))
    }

    /**
     * Ce que le serveur refuserait, on ne le lui demande pas : lui envoyer une IP privée
     * lui apprendrait l'adressage du réseau de l'utilisateur pour rien.
     */
    @Test
    fun niIpNiMachineLocaleNeSontDemandees() {
        for (hote in listOf(
            "http://localhost:8080",
            "http://192.168.1.4",
            "http://[fe80::1]/",
            "http://nas/",
            "",
        )) {
            assertNull(hote, IconeDeSite.url(hote, "https://gp.example.com", "j"))
        }
    }

    @Test
    fun laRegleDuDomainePublicEstCelleDuServeur() {
        assertTrue(IconeDeSite.estUnDomainePublic("github.com"))
        assertTrue(IconeDeSite.estUnDomainePublic("a.b.co"))
        assertFalse(IconeDeSite.estUnDomainePublic("exemple.c"))
        assertFalse(IconeDeSite.estUnDomainePublic("exemple.123"))
        assertFalse(IconeDeSite.estUnDomainePublic("10.0.0.1"))
    }

    /**
     * La clé de cache est le **domaine**, pas l'URL : le jeton change à chaque
     * rafraîchissement du coffre, et une mémoire indexée dessus se viderait à chaque fois.
     * Deux jetons différents doivent donc donner la même clé.
     */
    @Test
    fun laCleDeCacheNeDependPasDuJeton() {
        assertEquals("github.com", IconeDeSite.cle("https://www.github.com/login"))
        assertEquals(IconeDeSite.cle("github.com"), IconeDeSite.cle("https://github.com/x?y=1"))
        assertNull(IconeDeSite.cle("http://localhost:3111"))
    }

    /** Une pastille muette ne dit rien ; un « ? » dit qu'il n'y avait pas de nom. */
    @Test
    fun unNomVideDonneUnPointDInterrogation() {
        assertEquals("?", IconeDeSite.initiale("   "))
        assertEquals("G", IconeDeSite.initiale("github"))
    }
}
