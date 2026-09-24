package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le générateur, et les trois façons qu'il a de se tromper **sans que ça se voie**.
 *
 * C'est la raison d'être de ce fichier. Un mot de passe mal engendré a exactement l'allure
 * d'un mot de passe bien engendré : vingt caractères mélangés, rien à signaler. Aucun des
 * défauts ci-dessous ne provoque d'erreur, n'empêche d'enregistrer, ni ne se remarque à
 * l'usage — ils réduisent seulement le coût de le deviner, en silence.
 *
 *  - **la garantie par jeu** : cocher « chiffres » et n'en obtenir aucun. Visible seulement
 *    le jour où un site refuse le mot de passe sans dire lequel de ses critères manque ;
 *  - **le mélange** : sans Fisher-Yates, les caractères garantis restent en tête, dans
 *    l'ordre des cases à cocher. Le mot de passe paraît aléatoire, et sa première lettre est
 *    toujours une minuscule ;
 *  - **la longueur** : un curseur qui affiche 20 et produit 19.
 *
 * Chacun a son témoin, et chacun de ces témoins a été **vu rouge** en retirant la garantie
 * qu'il mesure. Un test dont les deux branches donnent la même sortie ne prouve rien.
 */
class GenerateurDeMotDePasseTest {

    private val tous = ReglagesDuGenerateur()

    @Test
    fun laLongueurDemandeeEstLaLongueurRendue() {
        for (longueur in listOf(8, 12, 20, 33, 64)) {
            val mot = GenerateurDeMotDePasse.generer(tous.copy(longueur = longueur))
            assertEquals(
                "le curseur affiche $longueur caractères et le générateur en rend " +
                    "${mot.length} : l'écran annonce une force qui n'est pas celle du mot " +
                    "de passe produit",
                longueur,
                mot.length,
            )
        }
    }

    @Test
    fun laLongueurEstBorneeParLeHaut() {
        // Rien à l'écran ne permet de demander plus de 64 ; une valeur venue d'ailleurs — un
        // état restauré, un réglage futur — ne doit pas pour autant produire un mot de passe
        // qu'aucun site n'accepte.
        val mot = GenerateurDeMotDePasse.generer(tous.copy(longueur = 500))
        assertEquals(GenerateurDeMotDePasse.LONGUEUR_MAX, mot.length)
    }

    @Test
    fun aucunJeuCocheNeDonneQuandMemeUnMotDePasse() {
        // Tout décocher est un état que l'écran permet d'atteindre. Rendre une chaîne vide
        // se lirait « le générateur est cassé », alors que c'est la consigne qui l'était.
        val mot = GenerateurDeMotDePasse.generer(
            ReglagesDuGenerateur(
                longueur = 20,
                minuscules = false, majuscules = false, chiffres = false, symboles = false,
            ),
        )
        assertEquals(20, mot.length)
        assertTrue(
            "un mot de passe engendré sans aucun jeu coché contient autre chose que des " +
                "minuscules — le repli n'est pas celui qu'on croit",
            mot.all { it in GenerateurDeMotDePasse.MINUSCULES },
        )
    }

    @Test
    fun chaqueJeuDemandeEstRepresente() {
        // Cent tirages : la garantie est une garantie, pas une fréquence. Sur une longueur
        // de 8 et quatre jeux, un tirage naïf omettrait un jeu assez souvent pour que le
        // défaut passe inaperçu sur un seul essai — et assez rarement pour qu'on l'attribue
        // à la malchance.
        repeat(100) {
            val mot = GenerateurDeMotDePasse.generer(tous.copy(longueur = 8))
            for ((nom, jeu) in listOf(
                "minuscules" to GenerateurDeMotDePasse.MINUSCULES,
                "majuscules" to GenerateurDeMotDePasse.MAJUSCULES,
                "chiffres" to GenerateurDeMotDePasse.CHIFFRES,
                "symboles" to GenerateurDeMotDePasse.SYMBOLES,
            )) {
                assertTrue(
                    "« $mot » ne contient aucun caractère du jeu « $nom », pourtant demandé",
                    mot.any { it in jeu },
                )
            }
        }
    }

    @Test
    fun aucunCaractereEtrangerAuxJeuxDemandes() {
        val attendus = (GenerateurDeMotDePasse.MINUSCULES + GenerateurDeMotDePasse.CHIFFRES).toSet()
        repeat(50) {
            val mot = GenerateurDeMotDePasse.generer(
                tous.copy(longueur = 30, majuscules = false, symboles = false),
            )
            val intrus = mot.filterNot { it in attendus }
            assertTrue(
                "« $mot » contient « $intrus », alors que seuls les minuscules et les " +
                    "chiffres étaient demandés",
                intrus.isEmpty(),
            )
        }
    }

    /**
     * **Le témoin du mélange**, et le seul qui distingue un générateur correct d'un
     * générateur qui a l'air correct.
     *
     * Sans Fisher-Yates, les caractères garantis restent dans l'ordre des jeux : la première
     * position est **toujours** une minuscule, et les suivantes suivent l'ordre des cases à
     * cocher. Le mot de passe reste de la bonne longueur, avec les bons caractères, et
     * personne ne le remarque — mais qui sait quel outil l'a produit sait aussi par quoi il
     * commence.
     *
     * On mesure donc la première position sur deux cents tirages. Avec le mélange, elle est
     * un chiffre environ une fois sur trois ; sans lui, jamais. Le seuil de 20 sur 200 est
     * assez bas pour qu'un générateur correct ne tombe pas par malchance, et assez haut
     * pour qu'un générateur non mélangé n'y arrive jamais.
     */
    @Test
    fun lesCaracteresGarantisNeRestentPasEnTete() {
        val reglages = tous.copy(longueur = 8, majuscules = false, symboles = false)
        val commencentParUnChiffre = (1..200).count { tirage ->
            GenerateurDeMotDePasse.generer(reglages).first() in GenerateurDeMotDePasse.CHIFFRES
        }
        assertTrue(
            "sur 200 tirages, seulement $commencentParUnChiffre commencent par un chiffre. " +
                "Les caractères garantis ne sont pas mélangés : la première position trahit " +
                "l'ordre des cases à cocher, et le mot de passe est plus facile à deviner " +
                "qu'annoncé",
            commencentParUnChiffre >= 20,
        )
    }

    @Test
    fun deuxAppelsNeDonnentPasLeMemeMotDePasse() {
        // Le témoin de l'aléa lui-même. Il tomberait si la source devenait constante — une
        // graine fixée, un `Random` de test oublié en place.
        val tirages = (1..50).map { GenerateurDeMotDePasse.generer(tous) }.toSet()
        assertEquals(
            "cinquante tirages n'ont pas donné cinquante mots de passe distincts : la " +
                "source d'aléa se répète",
            50,
            tirages.size,
        )
    }

    /**
     * Les jeux de caractères sont un **contrat entre les trois clients**, pas un détail
     * local.
     *
     * Si Android ajoutait un symbole que le web n'a pas, rien ne casserait — et on saurait
     * d'où vient un mot de passe rien qu'en le regardant. Les valeurs sont donc écrites ici
     * en toutes lettres : le jour où quelqu'un les modifie, ce test le lui dit.
     */
    @Test
    fun lesJeuxSontCeuxDuWebEtDIOs() {
        assertEquals("abcdefghijklmnopqrstuvwxyz", GenerateurDeMotDePasse.MINUSCULES)
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ", GenerateurDeMotDePasse.MAJUSCULES)
        assertEquals("0123456789", GenerateurDeMotDePasse.CHIFFRES)
        assertEquals("!@#\$%^&*()-_=+[]{};:,.?/", GenerateurDeMotDePasse.SYMBOLES)
    }

    @Test
    fun lesBitsEtLesPaliersSuiventIOs() {
        // 20 caractères sur les 86 du jeu complet : log2(86) ≈ 6,43, soit ≈ 128 bits.
        val complet = GenerateurDeMotDePasse.bits(tous)
        assertEquals(128.6, complet, 0.5)
        assertEquals(GenerateurDeMotDePasse.Force.EXCELLENT, GenerateurDeMotDePasse.force(complet))

        // Les seuils, à la frontière — c'est là qu'un décalage d'un bit se verrait.
        assertEquals(GenerateurDeMotDePasse.Force.SOLIDE, GenerateurDeMotDePasse.force(72.0))
        assertEquals(GenerateurDeMotDePasse.Force.CORRECT, GenerateurDeMotDePasse.force(71.9))
        assertEquals(GenerateurDeMotDePasse.Force.CORRECT, GenerateurDeMotDePasse.force(50.0))
        assertEquals(GenerateurDeMotDePasse.Force.FAIBLE, GenerateurDeMotDePasse.force(49.9))

        // Huit chiffres seulement : ≈ 26,6 bits. Le palier doit le dire faible, sinon
        // l'écran rassure sur un mot de passe qu'on casse en une seconde.
        val faible = GenerateurDeMotDePasse.bits(
            ReglagesDuGenerateur(
                longueur = 8, minuscules = false, majuscules = false,
                chiffres = true, symboles = false,
            ),
        )
        assertEquals(GenerateurDeMotDePasse.Force.FAIBLE, GenerateurDeMotDePasse.force(faible))
    }
}
