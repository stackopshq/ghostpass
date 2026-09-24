package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L'import CSV, éprouvé sur les en-têtes **des cinq exports réels**.
 *
 * Ce qui se joue ici n'est pas l'analyse d'un format — c'est la table d'équivalences. Un
 * nom de colonne oublié ne fait échouer aucun import : il produit un coffre dans lequel
 * une donnée manque, et une donnée manquante a exactement l'air d'une donnée qui n'existait
 * pas. Quelqu'un qui migre deux cents identifiants depuis LastPass et perd toutes ses notes
 * ne s'en aperçoit pas le jour de l'import.
 *
 * Les en-têtes ci-dessous sont **relevés** dans les exports de chaque produit, pas devinés.
 */
class ImportCsvTest {

    private fun connexion(element: ElementDuCoffre) = element.identifiants!!

    // ─── Le découpage ───

    @Test
    fun uneVirguleDansUnMotDePasseNeDecalePasLesColonnes() {
        // Le défaut qu'un découpage naïf produit, et il ne lève aucune erreur : le mot de
        // passe devient l'adresse, l'adresse devient la note, et l'élément paraît normal.
        val csv = """
            name,username,password,url
            Banque,clara,"a,b,c#2024",https://banque.example.com
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("a,b,c#2024", connexion(element).password)
        assertEquals(listOf("https://banque.example.com"), connexion(element).uris)
    }

    @Test
    fun unSautDeLigneDansUneNoteResteDansLaNote() {
        val csv = "name,password,notes\nServeur,x,\"première ligne\nseconde ligne\"\n"
        val element = ImportCsv.elements(csv).single()
        assertEquals("première ligne\nseconde ligne", element.notes)
        assertEquals(
            "le saut de ligne a coupé l'enregistrement en deux : un élément importé en a " +
                "produit deux, dont un sans mot de passe",
            1,
            ImportCsv.elements(csv).size,
        )
    }

    @Test
    fun lesGuillemetsDoublesSeRamenentAUnSeul() {
        val csv = "name,password\nGuillemets,\"il a dit \"\"bonjour\"\"\"\n"
        assertEquals("il a dit \"bonjour\"", connexion(ImportCsv.elements(csv).single()).password)
    }

    @Test
    fun lesFinsDeLigneWindowsEtMacSontAcceptees() {
        val windows = "name,password\r\nA,1\r\nB,2\r\n"
        val macClassique = "name,password\rA,1\rB,2\r"
        assertEquals(listOf("A", "B"), ImportCsv.elements(windows).map { it.name })
        assertEquals(listOf("A", "B"), ImportCsv.elements(macClassique).map { it.name })
    }

    @Test
    fun lesLignesVidesSontIgnorees() {
        // Les exports en sèment en fin de fichier. Une ligne vide importée donnerait un
        // « (sans nom) » sans mot de passe, à retrouver et supprimer à la main.
        val csv = "name,password\nA,1\n\n\n"
        assertEquals(1, ImportCsv.elements(csv).size)
    }

    @Test
    fun unFichierSansEnregistrementNeRendRien() {
        assertTrue(ImportCsv.elements("").isEmpty())
        assertTrue(ImportCsv.elements("name,password\n").isEmpty())
    }

    // ─── Les cinq exports, avec leurs en-têtes réels ───

    @Test
    fun bitwarden() {
        val csv = """
            folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
            Travail,,login,Forgejo,une note,,0,https://git.example.com,clara,s3cret,otpauth://totp/a
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("Forgejo", element.name)
        assertEquals("Travail", element.folder)
        assertEquals("une note", element.notes)
        assertEquals("clara", connexion(element).username)
        assertEquals("s3cret", connexion(element).password)
        assertEquals(listOf("https://git.example.com"), connexion(element).uris)
        assertEquals("otpauth://totp/a", connexion(element).totp)
    }

    @Test
    fun onePassword() {
        val csv = """
            Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes
            Amazon,https://amazon.example,clara@example.com,hunter2,otpauth://totp/b,,,Achats,livraison
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("Amazon", element.name)
        // `Tags` fait office de dossier chez 1Password.
        assertEquals("Achats", element.folder)
        assertEquals("livraison", element.notes)
        assertEquals("clara@example.com", connexion(element).username)
        assertEquals("hunter2", connexion(element).password)
        assertEquals("otpauth://totp/b", connexion(element).totp)
    }

    @Test
    fun lastPass() {
        // **`extra` et `grouping`.** Ce sont les deux noms que LastPass emploie et que
        // personne ne devine : la note et le dossier. Les omettre perdrait, sur un coffre
        // migré, toutes les notes et tout le classement — sans un message.
        val csv = """
            url,username,password,totp,extra,name,grouping,fav
            https://netflix.example,clara,pop,otpauth://totp/c,carte de la belle-mère,Netflix,Maison,0
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("Netflix", element.name)
        assertEquals("Maison", element.folder)
        assertEquals("carte de la belle-mère", element.notes)
        assertEquals("otpauth://totp/c", connexion(element).totp)
    }

    @Test
    fun dashlane() {
        // `note` au singulier et `otpSecret` — deux noms à eux seuls. L'en-tête est
        // ramené en minuscules avant la comparaison, d'où `otpsecret` dans la table.
        val csv = """
            username,username2,username3,title,password,note,url,category,otpSecret
            clara,,,GitHub,gh_pat,jeton personnel,https://github.example,Dév,JBSWY3DPEHPK3PXP
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("GitHub", element.name)
        assertEquals("Dév", element.folder)
        assertEquals("jeton personnel", element.notes)
        assertEquals("JBSWY3DPEHPK3PXP", connexion(element).totp)
    }

    @Test
    fun chrome() {
        val csv = """
            name,url,username,password,note
            example.com,https://example.com/login,clara,motdepasse,
        """.trimIndent()
        val element = ImportCsv.elements(csv).single()
        assertEquals("example.com", element.name)
        assertEquals("clara", connexion(element).username)
        // Une note vide reste **`null`** et non `""` : `null` veut dire « absent », `""`
        // veut dire « présent et vide ». Les confondre ferait passer une donnée manquante
        // pour une donnée mal remplie.
        assertNull(element.notes)
        assertNull(element.folder)
    }

    // ─── Les deux nettoyages du nom ───

    /**
     * **Un nom venu d'un fichier ne doit pas pouvoir devenir un registre.**
     *
     * Les registres internes — dossiers, favoris — portent un nom commençant par un octet
     * NUL. Personne ne peut le taper ; un fichier, lui, peut le contenir. Un élément importé
     * sous ce nom disparaîtrait de la liste et **détournerait l'identité du vrai registre** :
     * la prochaine écriture de favoris irait dans le mauvais élément, et les favoris
     * existants seraient perdus sans un message.
     */
    @Test
    fun unNomNePeutPasUsurperUnRegistre() {
        // Le NUL est écrit par son échappement, et le nom du registre vient de la source
        // plutôt que d'être recopié : si le préfixe changeait, ce témoin suivrait.
        val csv = "name,password\n" + Registres.FAVORIS + ",x\n"
        val element = ImportCsv.elements(csv).single()
        // **Seul le NUL est retiré, pas le « gp: ».** C'est ce que fait iOS, et c'est
        // suffisant : le préfixe réservé commence par l'octet NUL, et un nom qui ne le
        // porte plus ne peut plus être pris pour un registre. Retirer aussi « gp: »
        // abîmerait un nom légitime qui commencerait par ces trois caractères.
        assertEquals(
            "le préfixe de registre est resté dans le nom",
            Registres.FAVORIS.replace("\u0000", ""),
            element.name,
        )
        assertFalse(
            "l'élément importé est pris pour un registre : il disparaît de la liste et " +
                "détourne l'identité du vrai registre des favoris",
            element.estUnRegistre,
        )
    }

    /**
     * L'aller-retour export → import doit être **exact**.
     *
     * Notre export préfixe d'une apostrophe ce qu'un tableur évaluerait — `=1+1` deviendrait
     * une formule à l'ouverture. L'import retire exactement cette apostrophe ; sans cela un
     * nom grossirait d'une apostrophe à chaque cycle.
     */
    @Test
    fun lApostropheDeNeutralisationEstRetireeEtElleSeule() {
        assertEquals("=1+1", ImportCsv.rendreSaFormule("'=1+1"))
        assertEquals("@canal", ImportCsv.rendreSaFormule("'@canal"))
        assertEquals("-12", ImportCsv.rendreSaFormule("'-12"))
        // Et une apostrophe qui appartient au nom **reste** : « 'Ancien compte' » n'a
        // jamais été une formule, et la manger abîmerait un nom légitime.
        assertEquals("'Ancien compte", ImportCsv.rendreSaFormule("'Ancien compte"))
        assertEquals("L'agence", ImportCsv.rendreSaFormule("L'agence"))
    }

    @Test
    fun uneLigneSansNomNeDonnePasUnElementSansNom() {
        // « (sans nom) » plutôt qu'une chaîne vide : une ligne du coffre sans nom est
        // invisible, et invisible se lit « l'import a perdu cette entrée ».
        val csv = "name,username,password\n,clara,secret\n"
        assertEquals("(sans nom)", ImportCsv.elements(csv).single().name)
    }
}
