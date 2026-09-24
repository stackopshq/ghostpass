package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La santé du coffre, et la promesse de k-anonymat qui l'accompagne.
 *
 * Deux choses très différentes sont éprouvées ici, et la seconde est la plus importante :
 *
 *  - le **barème** est celui du web et d'iOS. S'il divergeait, les deux écrans se
 *    contrediraient sur le même coffre, et rien ne dirait lequel croire ;
 *  - la **vérification des fuites** ne laisse sortir que cinq caractères. C'est la phrase
 *    que l'écran affiche à l'utilisateur ; tant qu'aucun témoin ne la tient, ce n'est qu'une
 *    phrase.
 */
class SanteDuCoffreTest {

    private fun connexion(
        id: String,
        nom: String,
        motDePasse: String,
        totp: String? = null,
    ) = EntreeDuCoffre.Lisible(
        id = id,
        element = ElementDuCoffre(
            name = nom,
            data = ContenuDElement.Connexion(
                Identifiants(username = "clara", password = motDePasse, totp = totp),
            ),
        ),
    )

    // ─── Le barème ───

    @Test
    fun leBaremeEstCeluiDuWebEtDIOs() {
        // Palier par palier, avec les valeurs qui produisent chaque score. L'arrondi de
        // 5 points vers 4 paliers est l'endroit où Kotlin et Swift pourraient diverger ;
        // les écrire tous les six le montre.
        assertEquals(0, SanteDuCoffre.force("").niveau)
        assertEquals(0, SanteDuCoffre.force("abc").niveau) // 0 point
        assertEquals(1, SanteDuCoffre.force("abcdefgh").niveau) // ≥8 seul → score 1
        assertEquals(2, SanteDuCoffre.force("abcdEFGH").niveau) // ≥8 + 2 variétés → score 2
        assertEquals(2, SanteDuCoffre.force("abcdEFGH1234").niveau) // 3 variétés → score 3
        assertEquals(3, SanteDuCoffre.force("abcdEFGH123456").niveau) // ≥14 → score 4
        assertEquals(4, SanteDuCoffre.force("abcdEFGH123456789012").niveau) // ≥20 → score 5
    }

    @Test
    fun leSeuilDeFaiblesseEstADeux() {
        // C'est ce seuil qui décide du contenu de la liste « mots de passe faibles » à
        // l'écran. Le déplacer d'un cran y ferait entrer — ou en sortirait — une classe
        // entière de mots de passe, sans que rien d'autre ne change.
        assertTrue(SanteDuCoffre.force("abcdefgh").estFaible)
        assertFalse(SanteDuCoffre.force("abcdEFGH").estFaible)
        // Et le cas qui a surpris : huit caractères et deux variétés passent le seuil.
        assertFalse(SanteDuCoffre.force("azerty12").estFaible)
    }

    // ─── Le bilan ───

    @Test
    fun lesTroisListesSeparentBienLeursCas() {
        val bilan = SanteDuCoffre.bilan(
            listOf(
                // « motdepasse » : dix minuscules. Huit caractères et deux variétés —
                // « azerty12 » — donnent déjà 2 sur 4, c'est-à-dire « Moyen » et non
                // « Faible ». Le premier jet de ce témoin l'avait rangé parmi les faibles
                // et c'est le témoin qui se trompait, pas le barème : iOS et le web en
                // disent autant du même mot de passe.
                connexion("1", "GitHub", "motdepasse"), // faible : 1 sur 4
                connexion("2", "Amazon", "Tr0ub4dor&3xyz!QW", totp = "otpauth://totp/a"),
                connexion("3", "Netflix", "Partage!2024Long"), // réutilisé
                connexion("4", "Disney", "Partage!2024Long"), // réutilisé
            ),
        )
        assertEquals(listOf("GitHub"), bilan.faibles.map { it.element.name })
        assertEquals(listOf("Netflix", "Disney"), bilan.reutilises.map { it.element.name })
        // Amazon a un second facteur ; les trois autres non.
        assertEquals(
            listOf("GitHub", "Netflix", "Disney"),
            bilan.sansCode.map { it.element.name },
        )
        assertEquals(4, bilan.examines)
        assertFalse(bilan.estSain)
        assertEquals(3, bilan.aRevoir)
    }

    @Test
    fun unMotDePasseUniqueNEstPasReutilise() {
        // Le contrôle du contrôle : sans lui, « réutilisés » pourrait contenir tout le
        // monde et le témoin d'au-dessus passerait quand même.
        val bilan = SanteDuCoffre.bilan(
            listOf(
                connexion("1", "A", "Unique!Long2024aa"),
                connexion("2", "B", "Different!Long24b"),
            ),
        )
        assertTrue(bilan.reutilises.isEmpty())
        assertTrue(bilan.estSain)
    }

    /**
     * **Une ligne illisible n'est pas une ligne saine**, et ne doit pas être comptée.
     *
     * C'est le §5 du brief déplacé dans un compteur. Compter les illisibles parmi les
     * « éléments examinés » donnerait un total rassurant sur des éléments qu'on n'a pas pu
     * regarder : le coffre paraîtrait plus sain qu'il ne l'est, précisément à cause de ce
     * qu'on ne sait pas lire.
     */
    @Test
    fun uneLigneIllisibleNEstPasComptee() {
        val bilan = SanteDuCoffre.bilan(
            listOf(
                connexion("1", "GitHub", "motdepasse"),
                EntreeDuCoffre.Illisible("2", RaisonDIllisibilite.CleManquante),
                EntreeDuCoffre.Illisible("3", RaisonDIllisibilite.CleManquante),
            ),
        )
        assertEquals(
            "les lignes illisibles sont comptées parmi les éléments examinés : le coffre " +
                "paraît plus sain qu'il ne l'est, à cause de ce qu'on ne sait pas lire",
            1,
            bilan.examines,
        )
    }

    /**
     * Un registre n'est pas un mot de passe.
     *
     * `gp:folders` et consorts sont des données de l'application déguisées en éléments de
     * coffre. Sans ce filtre, ils apparaîtraient nommément dans la liste des mots de passe
     * faibles — une ligne que l'utilisateur n'a jamais créée et ne peut pas corriger.
     */
    @Test
    fun unRegistreNEstPasUnMotDePasse() {
        val bilan = SanteDuCoffre.bilan(
            listOf(
                connexion("1", "GitHub", "Tr0ub4dor&3xyz!QW"),
                connexion("2", Registres.PREFIXE + "folders", "x"),
            ),
        )
        assertEquals(1, bilan.examines)
        assertTrue(
            "un registre figure dans la liste des mots de passe faibles : " +
                "${bilan.faibles.map { it.element.name }}",
            bilan.faibles.isEmpty(),
        )
    }

    // ─── Le k-anonymat ───

    /**
     * **La phrase affichée à l'écran, tenue par un témoin.**
     *
     * « Seuls les cinq premiers caractères de l'empreinte sont envoyés : ni le mot de passe
     * ni son empreinte complète ne quittent l'appareil. » Tant que personne ne le vérifie,
     * c'est une phrase ; ici, l'adresse appelée est capturée et fouillée.
     */
    @Test
    fun seulsCinqCaracteresDeLEmpreinteSortent() {
        val motDePasse = "correct horse battery staple"
        val empreinte = VerificationDeFuite.empreinte(motDePasse)
        val appelees = ArrayList<String>()

        VerificationDeFuite.compteDeFuites(motDePasse) { adresse ->
            appelees.add(adresse)
            "0000000000000000000000000000000000:3\n"
        }

        assertEquals(1, appelees.size)
        val adresse = appelees.single()
        assertTrue(
            "l'adresse appelée ne porte pas le préfixe de cinq caractères : $adresse",
            adresse.endsWith("/range/${empreinte.prefixe}"),
        )
        assertEquals(5, empreinte.prefixe.length)
        assertFalse(
            "**l'empreinte complète part sur le réseau** : $adresse. La promesse affichée à " +
                "l'écran est fausse, et rien à l'écran ne le montrerait",
            adresse.contains(empreinte.entiere),
        )
        assertFalse(
            "le suffixe de l'empreinte part sur le réseau : $adresse",
            adresse.contains(empreinte.suffixe),
        )
        assertFalse(
            "**le mot de passe lui-même part sur le réseau** : $adresse",
            adresse.contains(motDePasse) || adresse.contains("correct"),
        )
    }

    @Test
    fun laCorrespondanceSeFaitSurLeSuffixe() {
        val motDePasse = "motdepasse"
        val empreinte = VerificationDeFuite.empreinte(motDePasse)
        // Une réponse réaliste : des suffixes étrangers, et le nôtre au milieu.
        val reponse = buildString {
            append("0000000000000000000000000000000000A:12\n")
            append("${empreinte.suffixe}:4821\n")
            append("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:7\n")
        }
        assertEquals(4821, VerificationDeFuite.compteDeFuites(motDePasse) { reponse })

        // Et l'absence se distingue de la présence : sans ce second cas, la fonction
        // pourrait rendre le premier nombre venu.
        val sansLeNotre = "0000000000000000000000000000000000A:12\n"
        assertEquals(0, VerificationDeFuite.compteDeFuites(motDePasse) { sansLeNotre })
    }

    /**
     * **Un service muet ne veut pas dire « aucune fuite ».**
     *
     * C'est le défaut le plus coûteux de la semaine, transposé : un `catch` qui retombe sur
     * un état d'apparence normale rend la garantie invisible *tout en rassurant*. Ici, rendre
     * 0 après un échec réseau afficherait « aucun mot de passe connu des fuites » à quelqu'un
     * dont on n'a rien vérifié du tout.
     */
    @Test
    fun unServiceIndisponibleNeSeLitPasCommeUneAbsenceDeFuite() {
        val echec = runCatching {
            VerificationDeFuite.compteDeFuites("motdepasse") {
                throw VerificationDeFuite.Indisponible("le service a répondu 503")
            }
        }
        assertTrue(
            "la vérification a rendu ${echec.getOrNull()} au lieu de propager l'échec : " +
                "l'écran dirait « aucun mot de passe connu des fuites » sans avoir rien vérifié",
            echec.isFailure,
        )
    }

    @Test
    fun unSeulAppelParMotDePasseDistinct() {
        val entrees = listOf(
            connexion("1", "Netflix", "Partage!2024Long"),
            connexion("2", "Disney", "Partage!2024Long"),
            connexion("3", "GitHub", "Autre!2024LongAbc"),
            connexion("4", "Vide", ""),
        )
        val appels = ArrayList<String>()
        VerificationDeFuite.compromis(entrees) { adresse ->
            appels.add(adresse)
            ""
        }
        assertEquals(
            "le service reçoit un appel par élément et non par mot de passe distinct : il " +
                "apprend combien de fois chaque préfixe revient, ce qui est exactement ce " +
                "qu'un coffre à mots de passe réutilisés ne doit pas lui dire. Appels : $appels",
            2,
            appels.size,
        )
    }

    @Test
    fun lesElementsCompromisSontCeuxQuiPartagentLeMotDePasse() {
        val entrees = listOf(
            connexion("1", "Netflix", "Partage!2024Long"),
            connexion("2", "Disney", "Partage!2024Long"),
            connexion("3", "GitHub", "Autre!2024LongAbc"),
        )
        val fuite = VerificationDeFuite.empreinte("Partage!2024Long")
        val compromis = VerificationDeFuite.compromis(entrees) { adresse ->
            if (adresse.endsWith(fuite.prefixe)) "${fuite.suffixe}:9\n" else ""
        }
        assertEquals(listOf("Netflix", "Disney"), compromis.map { it.element.name })
    }

    @Test
    fun lEmpreinteEstEnMajuscules() {
        // Le service rend ses suffixes en majuscules. Une empreinte en minuscules ne
        // correspondrait jamais, et l'écran dirait « aucune fuite » pour tout le monde —
        // un repli silencieux, et le plus rassurant de tous.
        val empreinte = VerificationDeFuite.empreinte("password")
        assertEquals("5BAA6", empreinte.prefixe)
        assertEquals(35, empreinte.suffixe.length)
        assertEquals(empreinte.entiere, empreinte.entiere.uppercase())
    }
}
