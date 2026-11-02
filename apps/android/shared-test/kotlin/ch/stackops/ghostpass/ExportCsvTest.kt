package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L'export CSV, et surtout **l'aller-retour**.
 *
 * Ce qui se joue ici n'est pas la mise en forme d'un fichier : c'est que
 * `ExportCsv.texte` et `ImportCsv.elements` se répondent exactement. Un export qui produit
 * un fichier relisible mais pas *identique* ne lève aucune erreur — il rend un coffre dont
 * une entrée a changé de nom, ou perdu une adresse, et personne ne compare deux cents
 * lignes à la main.
 *
 * Trois propriétés y sont éprouvées, et chacune a failli ne pas tenir :
 *
 *  - **la réversibilité de l'apostrophe.** L'export préfixe ce qu'un tableur évaluerait ;
 *    l'import retire ce préfixe. Si les deux ne s'accordent pas sur ce qui « amorce une
 *    formule », un nom grossit d'une apostrophe à chaque cycle ;
 *  - **les adresses multiples.** Elles voyagent à la ligne dans la cellule `url` ;
 *  - **la structure**, face à une virgule, un guillemet ou un saut de ligne dans un mot de
 *    passe.
 */
class ExportCsvTest {

    private fun entree(
        nom: String,
        identifiant: String = "",
        motDePasse: String = "",
        adresses: List<String> = emptyList(),
        dossier: String? = null,
        totp: String? = null,
    ) = EntreeDuCoffre.Lisible(
        id = "id-$nom",
        element = ElementDuCoffre(
            name = nom,
            folder = dossier,
            data = ContenuDElement.Connexion(
                Identifiants(
                    username = identifiant,
                    password = motDePasse,
                    uris = adresses,
                    totp = totp,
                ),
            ),
        ),
    )

    // ─── Le format, celui des deux autres plateformes ───

    @Test
    fun lEnTeteEstCeluiDeLaWebAppEtDiOS() {
        // `EN_TETE_CSV` d'`apps/web-next/src/lib/export.ts` et `CsvExport.entete` de
        // `CsvExport.swift`. Un fichier écrit sur le téléphone doit se relire dans le
        // navigateur : trois en-têtes qui divergent, et c'est le fichier qui décide de ce
        // qu'on garde.
        assertEquals("name,folder,url,username,password,totp", ExportCsv.EN_TETE)
        assertEquals(ExportCsv.EN_TETE, ExportCsv.texte(emptyList()))
    }

    @Test
    fun unCoffreVideNeRendQueLEnTete() {
        // Et non une chaîne vide : un fichier sans en-tête ne se réimporte nulle part.
        assertEquals(1, ExportCsv.texte(emptyList()).lines().size)
    }

    @Test
    fun lesSixColonnesSortentDansLOrdre() {
        val csv = ExportCsv.texte(
            listOf(
                entree(
                    nom = "Banque",
                    identifiant = "clara",
                    motDePasse = "secret",
                    adresses = listOf("https://banque.example.com"),
                    dossier = "Finances",
                    totp = "otpauth://totp/Banque?secret=ABC",
                ),
            ),
        )
        assertEquals(
            "\"Banque\",\"Finances\",\"https://banque.example.com\"," +
                "\"clara\",\"secret\",\"otpauth://totp/Banque?secret=ABC\"",
            csv.lines()[1],
        )
    }

    @Test
    fun uneNoteEtUneCarteSortentAvecLeursColonnesDeConnexionVides() {
        // Elles sortent **quand même**. Les omettre ferait disparaître leur ligne d'un
        // fichier censé être complet, sans qu'un décompte d'entrées ne le révèle.
        //
        // Ce que ce test fige aussi, c'est une perte : l'en-tête n'a pas de colonne pour le
        // contenu d'une note ni pour les champs d'une carte, et ces données restent
        // derrière. C'est vrai des trois plateformes, et c'est consigné dans `ExportCsv`.
        val note = EntreeDuCoffre.Lisible(
            id = "n", element = ElementDuCoffre(name = "Code du coffre", folder = "Maison",
                data = ContenuDElement.NoteSecrete(Note("1234"))),
        )
        val lignes = ExportCsv.texte(listOf(note)).lines()
        assertEquals("\"Code du coffre\",\"Maison\",\"\",\"\",\"\",\"\"", lignes[1])
        assertTrue(
            "le contenu de la note ne doit pas se retrouver dans le fichier par accident",
            !lignes[1].contains("1234"),
        )
    }

    @Test
    fun leNomDeFichierPorteLaDate() {
        val nom = ExportCsv.nomDeFichier(java.util.Date(0))
        assertEquals("ghostpass-export-1970-01-01.csv", nom)
    }

    // ─── L'aller-retour ───

    @Test
    fun uneVirguleDansUnMotDePasseTraverseLAllerRetour() {
        val relu = allerRetour(entree("Banque", "clara", "a,b,c#2024"))
        assertEquals("a,b,c#2024", relu.identifiants!!.password)
    }

    @Test
    fun unGuillemetDansUnMotDePasseTraverseLAllerRetour() {
        val relu = allerRetour(entree("Banque", "clara", "il a dit \"non\""))
        assertEquals("il a dit \"non\"", relu.identifiants!!.password)
    }

    @Test
    fun deuxAdressesTraversentLAllerRetour() {
        // Le défaut qu'iOS porte encore : `CsvExport.texte` n'écrit que `uris.first`, et un
        // coffre exporté depuis l'iPhone revient amputé de ses adresses secondaires.
        val relu = allerRetour(
            entree(
                "Ulys",
                adresses = listOf("https://connect.ulys.com", "https://user.ulys.com"),
            ),
        )
        assertEquals(
            listOf("https://connect.ulys.com", "https://user.ulys.com"),
            relu.identifiants!!.uris,
        )
    }

    @Test
    fun leDossierEtLeTotpTraversentLAllerRetour() {
        val relu = allerRetour(
            entree("Banque", dossier = "Finances", totp = "otpauth://totp/B?secret=ABC"),
        )
        assertEquals("Finances", relu.folder)
        assertEquals("otpauth://totp/B?secret=ABC", relu.identifiants!!.totp)
    }

    // ─── La neutralisation des formules, et sa réversibilité ───

    @Test
    fun unNomQuiCommenceParEgalEstNeutralise() {
        // L'injection de formule CSV : le tableur retire les guillemets, puis évalue. Un nom
        // d'élément est du texte que quelqu'un d'autre a pu écrire — un CSV qu'on vous a
        // fait importer, un élément semé dans une collection d'équipe.
        val csv = ExportCsv.texte(listOf(entree("=1+1")))
        assertEquals("\"'=1+1\",\"\",\"\",\"\",\"\",\"\"", csv.lines()[1])
    }

    @Test
    fun lesQuatreAmorcesClassiquesSontNeutralisees() {
        for (amorce in listOf("=", "+", "-", "@")) {
            assertEquals(
                "l'amorce « $amorce » doit être neutralisée",
                "'$amorce" + "SOMME(A1)",
                ExportCsv.neutraliserLaFormule(amorce + "SOMME(A1)"),
            )
        }
    }

    @Test
    fun laTabulationEstNeutraliseeCommeChezIOS() {
        // Elle manquait à la liste d'`ImportCsv`, et le manque était sans conséquence tant
        // qu'Android n'exportait pas. Depuis, un jeu plus pauvre à la lecture qu'à
        // l'écriture ferait grossir ces valeurs d'une apostrophe à chaque aller-retour.
        assertEquals("'\tfoo", ExportCsv.neutraliserLaFormule("\tfoo"))
        assertEquals("\tfoo", ImportCsv.rendreSaFormule("'\tfoo"))
    }

    @Test
    fun lApostropheNeSAccumulePasSurDeuxCycles() {
        // **La propriété qui compte.** Un préfixe posé sans retrait exact ferait grandir le
        // nom à chaque export-import, et le symptôme n'arriverait qu'au troisième cycle.
        val premier = allerRetour(entree("=1+1"))
        assertEquals("=1+1", premier.name)
        val second = ImportCsv.elements(
            ExportCsv.texte(listOf(EntreeDuCoffre.Lisible("x", premier))),
        ).single()
        assertEquals("=1+1", second.name)
    }

    @Test
    fun uneApostropheDejaPresenteEstTraiteeRecursivement() {
        // `'=SOMME(…)` doit être neutralisé lui aussi : sans cela l'import retirerait son
        // apostrophe et rendrait la formule à un futur export.
        assertEquals("''=1+1", ExportCsv.neutraliserLaFormule("'=1+1"))
        assertEquals("'=1+1", allerRetour(entree("'=1+1")).name)
    }

    @Test
    fun unNomOrdinaireNeGagnePasDApostrophe() {
        assertEquals("Banque", ExportCsv.neutraliserLaFormule("Banque"))
        assertEquals("\"Banque\"", ExportCsv.texte(listOf(entree("Banque"))).lines()[1].take(8))
    }

    /** Exporte une entrée, réimporte le fichier, et rend l'élément relu. */
    private fun allerRetour(entree: EntreeDuCoffre.Lisible): ElementDuCoffre =
        ImportCsv.elements(ExportCsv.texte(listOf(entree))).single()
}
