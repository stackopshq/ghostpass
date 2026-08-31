package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.register

/**
 * Les règles de comportement du coffre — celles qu'**aucun vecteur partagé ne peut
 * vérifier**.
 *
 * `suite/docs/adr/0002` le dit en toutes lettres : « ce qui ne se déchiffre pas s'affiche
 * quand même » n'est pas une donnée, c'est une règle. Elle n'est pas *partageable*, mais
 * elle est *témoignable chez son client* : un test qui tombe si la règle est enfreinte.
 * L'ADR exige un témoin par règle et par client. Ceci en est un.
 *
 * Rien n'est simulé ici : les comptes sont réels, les scellements traversent le cœur, et
 * les échecs de déchiffrement sont de vrais échecs. Un test qui poserait lui-même
 * l'exception qu'il attend ne vérifierait que sa propre mise en scène.
 */
class ReglesDuCoffreTest {

    // ─── §5 — ce qui ne se déchiffre pas s'affiche quand même ───

    /**
     * Un élément scellé pour quelqu'un d'autre **garde sa place dans la liste**.
     *
     * Ce qui se joue : une ligne absente se lit « il n'y a rien ». L'utilisateur qui ne
     * voit pas son identifiant conclut qu'il ne l'a jamais enregistré et le recrée — alors
     * que l'original est là, sous une clé que ce client n'a pas.
     */
    @Test
    fun unElementIllisibleGardeSaPlaceEtDitPourquoi() {
        val moi = compte("clara@ghostpass.test")
        val quelquUnDAutre = compte("kevin@ghostpass.test")

        val aMoi = connexion(moi, "Forgejo", "forgejo")
        val pasAMoi = connexion(quelquUnDAutre, "Le coffre de Kevin", "etranger")

        val lecture = Coffre.lecture(listOf(aMoi, pasAMoi), moi)

        assertEquals(
            "les deux lignes doivent être là — celle qu'on ouvre et celle qu'on n'ouvre pas",
            2,
            lecture.entrees.size,
        )
        assertEquals(1, lecture.nombreDIllisibles)

        val illisible = lecture.entrees.filterIsInstance<EntreeDuCoffre.Illisible>().single()
        assertEquals(
            "la ligne illisible doit rester désignable par son identifiant serveur",
            "etranger",
            illisible.id,
        )
        assertTrue(
            "elle doit dire que le sceau a été refusé, pas rester muette — reçu ${illisible.raison}",
            illisible.raison is RaisonDIllisibilite.SceauRefuse,
        )
    }

    /**
     * Le témoin du témoin : si l'on revenait au comportement d'iOS — écarter en silence ce
     * qui ne s'ouvre pas — ce test tomberait.
     *
     * Il ne suffit pas qu'une ligne illisible existe quelque part : elle doit se trouver
     * **dans la liste que l'écran parcourt**. Un compteur d'erreurs à côté d'une liste
     * amputée satisferait la lettre de la règle et manquerait son objet.
     */
    @Test
    fun laListeAffichableContientBienLesLignesIllisibles() {
        val moi = compte("clara@ghostpass.test")
        val autre = compte("kevin@ghostpass.test")

        val lecture = Coffre.lecture(listOf(connexion(autre, "invisible", "x")), moi)

        assertEquals("c'est `entrees` que l'écran parcourt, et elle porte la ligne", 1, lecture.entrees.size)
        assertTrue("aucune ligne ne s'est ouverte, et pourtant la liste n'est pas vide", lecture.lisibles.isEmpty())
    }

    /**
     * Un coffre verrouillé rend **toutes** ses lignes illisibles, et n'en perd aucune.
     *
     * C'est la cause la plus fréquente, et la plus facile à confondre avec « le coffre est
     * vide » : au premier affichage, avant que la clé n'existe, la liste ne doit pas
     * paraître vide — elle doit paraître fermée.
     */
    @Test
    fun unCoffreVerrouilleNePerdAucuneLigne() {
        val moi = compte("clara@ghostpass.test")
        val elements = listOf(
            connexion(moi, "Forgejo", "a"),
            connexion(moi, "GitHub", "b"),
            connexion(moi, "Gitea", "c"),
        )

        val verrouille = Coffre.lecture(elements, null)
        assertEquals("aucune ligne ne disparaît quand la clé manque", 3, verrouille.entrees.size)
        assertEquals(3, verrouille.nombreDIllisibles)
        assertTrue(
            "et la cause annoncée doit être la clé, pas un sceau refusé",
            verrouille.entrees.all {
                (it as EntreeDuCoffre.Illisible).raison == RaisonDIllisibilite.CleManquante
            },
        )

        // La même liste, avec la clé : les trois s'ouvrent. Sans cette moitié, le test
        // passerait aussi bien sur des éléments qui ne sont ouvrables par personne.
        assertEquals(3, Coffre.lecture(elements, moi).lisibles.size)
    }

    /**
     * « Clé manquante » et « sceau refusé » ne se confondent pas.
     *
     * L'une se répare en déverrouillant, l'autre pas du tout : l'élément appartient à
     * quelqu'un d'autre, ou à une organisation qu'on a quittée. Les annoncer pareil
     * enverrait chercher un mot de passe là où il n'y a rien à chercher.
     */
    @Test
    fun uneCleManquanteNEstPasUnSceauRefuse() {
        val moi = compte("clara@ghostpass.test")
        val autre = compte("kevin@ghostpass.test")
        val sien = connexion(autre, "Le coffre de Kevin", "x")

        assertEquals(
            RaisonDIllisibilite.CleManquante,
            (Coffre.lecture(listOf(sien), null).entrees.single() as EntreeDuCoffre.Illisible).raison,
        )
        assertTrue(
            "avec une clé qui existe mais n'ouvre pas celui-ci, la cause change",
            (Coffre.lecture(listOf(sien), moi).entrees.single()
                as EntreeDuCoffre.Illisible).raison is RaisonDIllisibilite.SceauRefuse,
        )
    }

    /**
     * Un contenu d'un genre inconnu est refusé par le codec — et **le cœur le refuse
     * avant lui**.
     *
     * Mesuré en écrivant ce test : `encryptItem` refuse déjà `{"kind":"PasseportQuantique"}`
     * (« unknown variant `PasseportQuantique`, expected one of `Login`, `SecureNote`,
     * `Card` »). Le cœur analyse le `VaultItem` complet aux deux bouts, et il rend la
     * **même** `GhostCryptoException` pour un genre inconnu que pour une clé qui n'ouvre
     * pas.
     *
     * Conséquence, et c'est une limite à connaître : la branche
     * [RaisonDIllisibilite.ContenuInconnu] n'est aujourd'hui **pas atteignable à travers le
     * cœur**. On ne peut donc pas, depuis Android, distinguer « écrit par un client plus
     * récent » de « pas votre clé » — le §5 du brief demande cette distinction, et le cœur
     * ne la rend pas encore possible. Elle le deviendra le jour où son modèle acceptera ce
     * qu'il ne connaît pas plutôt que de le rejeter.
     *
     * Ce test vérifie donc les deux moitiés vraies : le codec refuse bien un genre inconnu,
     * et le cœur le refuse aussi. Il ne prétend pas atteindre une branche qu'il n'atteint
     * pas.
     */
    @Test
    fun unGenreInconnuEstRefuseParLeCodecEtParLeCoeur() {
        val futur = buildJsonObject {
            put("name", "Futur")
            put("notes", null as String?)
            put("folder", null as String?)
            put("data", buildJsonObject {
                put("kind", "PasseportQuantique")
                put("data", buildJsonObject { })
            })
        }.toString()

        var codecRefuse = false
        try {
            CodecDElement.lire(futur)
        } catch (_: IllegalArgumentException) {
            codecRefuse = true
        }
        assertTrue("le codec Kotlin doit refuser un genre qu'il ne connaît pas", codecRefuse)

        val moi = compte("clara@ghostpass.test")
        var coeurRefuse = false
        try {
            moi.encryptItem(futur)
        } catch (_: uniffi.ghost_crypto_ffi.GhostCryptoException) {
            coeurRefuse = true
        }
        assertTrue(
            "et le cœur le refuse en amont — c'est ce qui rend `ContenuInconnu` " +
                "inatteignable pour l'instant",
            coeurRefuse,
        )
    }

    /**
     * « Absent » ne se confond pas avec « présent et vide ».
     *
     * Les ramener tous deux à la chaîne vide ferait passer une donnée manquante pour une
     * donnée mal remplie — sur iOS, un titre d'événement a **quatre** provenances distinctes
     * que cette confusion réduirait à deux.
     */
    @Test
    fun uneNoteAbsenteNeSeConfondPasAvecUneNoteVide() {
        val moi = compte("clara@ghostpass.test")

        val absente = CodecDElement.lire(moi.decryptItem(moi.encryptItem(
            noteJson(nom = "A", notes = null).toString())))
        val vide = CodecDElement.lire(moi.decryptItem(moi.encryptItem(
            noteJson(nom = "B", notes = "").toString())))

        assertNull("une note absente doit rester nulle", absente.notes)
        assertNotNull("une note vide doit rester présente", vide.notes)
        assertEquals("", vide.notes)
    }

    /** Et l'aller-retour par le cœur préserve la distinction, dans les deux sens. */
    @Test
    fun laDistinctionSurvitAUnAllerRetourParLeCoeur() {
        val moi = compte("clara@ghostpass.test")
        for (notes in listOf(null, "", "quelque chose")) {
            val depart = ElementDuCoffre(
                name = "N", notes = notes, folder = null,
                data = ContenuDElement.NoteSecrete(Note("x")),
            )
            val relu = CodecDElement.lire(moi.decryptItem(moi.encryptItem(
                CodecDElement.ecrire(depart))))
            assertEquals("les notes « $notes » doivent revenir identiques", notes, relu.notes)
        }
    }

    // ─── §2 — les registres ne s'affichent pas ───

    /**
     * Les registres à nom réservé sont retirés de la liste, et leur contenu récolté.
     *
     * Sans ce filtre ils apparaîtraient comme des lignes fantômes, au nom commençant par un
     * octet invisible.
     */
    @Test
    fun lesRegistresSontRecoltesEtRetiresDeLaListe() {
        val moi = compte("clara@ghostpass.test")

        val lecture = Coffre.lecture(
            listOf(
                connexion(moi, "Forgejo", "forgejo"),
                registre(moi, Registres.DOSSIERS, """["Travail/Serveurs","Perso"]"""),
                registre(moi, Registres.FAVORIS, """["abc"]"""),
                registre(moi, Registres.COULEURS_DEQUIPE, """{"org_a":"#123456"}"""),
            ),
            moi,
        )

        assertEquals("seul l'élément de l'utilisateur reste visible", 1, lecture.entrees.size)
        assertEquals("Forgejo", (lecture.entrees.single() as EntreeDuCoffre.Lisible).element.name)
        assertEquals(listOf("Perso", "Travail/Serveurs"), lecture.dossiersVides)
        assertEquals(setOf("abc"), lecture.favoris)
        assertEquals(mapOf("org_a" to "#123456"), lecture.couleursDEquipe)
    }

    /**
     * Un registre d'un produit ou d'une version qu'on ne connaît pas est **masqué quand
     * même** : c'est le préfixe qui décide, pas une liste de noms connus.
     */
    @Test
    fun unRegistreInconnuEstMasqueLuiAussi() {
        val moi = compte("clara@ghostpass.test")
        val lecture = Coffre.lecture(
            listOf(registre(moi, Registres.PREFIXE + "avenir", "[]")), moi)
        assertTrue("un registre inconnu ne doit pas devenir une ligne", lecture.entrees.isEmpty())
    }

    /** Et un élément qui *ressemble* à un registre sans l'être reste visible. */
    @Test
    fun unNomSansOctetNulNEstPasUnRegistre() {
        val moi = compte("clara@ghostpass.test")
        val lecture = Coffre.lecture(listOf(registre(moi, "gp:folders", "[]")), moi)
        assertEquals(
            "« gp:folders » sans octet NUL est un élément ordinaire, et se voit",
            1,
            lecture.entrees.size,
        )
    }

    /**
     * Un registre au contenu corrompu ne vide pas le coffre.
     *
     * C'est la seule place où avaler une erreur est le bon comportement, et c'est parce
     * qu'un registre est un accessoire : la règle §5 protège les *éléments*, pas les
     * dossiers vides. Un registre écrit de travers par un autre client ne doit pas priver
     * l'utilisateur de ses mots de passe.
     */
    @Test
    fun unRegistreCorrompuNePriveDeRien() {
        val moi = compte("clara@ghostpass.test")
        val lecture = Coffre.lecture(
            listOf(
                connexion(moi, "Forgejo", "forgejo"),
                registre(moi, Registres.DOSSIERS, "ceci n'est pas du JSON"),
            ),
            moi,
        )
        assertEquals("l'élément reste", 1, lecture.entrees.size)
        assertEquals("et le registre illisible vaut vide", emptyList<String>(), lecture.dossiersVides)
    }

    // ─── Outillage ───

    private fun compte(email: String): Account =
        register("correct horse battery staple $email", email).account()

    private fun noteJson(nom: String, notes: String?): JsonObject = buildJsonObject {
        put("name", nom)
        put("notes", notes)
        put("folder", null as String?)
        put("data", buildJsonObject {
            put("kind", "SecureNote")
            put("data", buildJsonObject { put("content", "x") })
        })
    }

    /** Un identifiant de connexion ordinaire, scellé pour ce compte. */
    private fun connexion(compte: Account, nom: String, id: String): ElementChiffre =
        scelle(
            compte, id,
            buildJsonObject {
                put("name", nom)
                put("notes", null as String?)
                put("folder", null as String?)
                put("data", buildJsonObject {
                    put("kind", "Login")
                    put("data", buildJsonObject {
                        put("username", "clara")
                        put("password", "s3cret")
                        put("uris", Json.parseToJsonElement("""["https://git.stackops.ch"]"""))
                        put("totp", null as String?)
                        put("password_history", Json.parseToJsonElement("[]"))
                    })
                })
            },
        )

    /**
     * Un registre, scellé pour ce compte.
     *
     * Le nom est passé à `buildJsonObject`, qui l'échappe lui-même : construire ce JSON par
     * concaténation obligerait à échapper l'octet NUL à la main, et une erreur y ferait
     * silencieusement d'un registre un élément ordinaire — le défaut même qu'on teste.
     */
    private fun registre(compte: Account, nom: String, contenu: String): ElementChiffre =
        scelle(
            compte, nom,
            buildJsonObject {
                put("name", nom)
                put("notes", null as String?)
                put("folder", null as String?)
                put("data", buildJsonObject {
                    put("kind", "SecureNote")
                    put("data", buildJsonObject { put("content", contenu) })
                })
            },
        )

    private fun scelle(compte: Account, id: String, item: JsonObject): ElementChiffre {
        val enveloppe = Json.parseToJsonElement(
            compte.encryptItem(item.toString())) as JsonObject
        return ElementChiffre(
            id = id,
            encryptedKey = (enveloppe["encrypted_key"] as JsonPrimitive).content,
            encryptedData = (enveloppe["encrypted_data"] as JsonPrimitive).content,
        )
    }
}
