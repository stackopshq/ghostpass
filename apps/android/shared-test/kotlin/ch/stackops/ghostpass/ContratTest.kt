package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Les vecteurs de contrat de la suite, **lus dans le fichier** et non recopiés ici.
 *
 * C'est ce qu'exige `suite/docs/adr/0002` et que ne fait encore aucun client : ni
 * `apps/ios/Tests/ContractTests.swift`, ni `ghostcal/apps/mobile/test/contrat_test.dart`
 * ne l'ouvrent — tous deux transcrivent les valeurs à la main, ce que l'ADR décrit
 * précisément comme la situation à quitter (« trois copies d'une même vérité, qui
 * divergeraient »).
 *
 * La différence est vérifiable et c'est tout l'intérêt : perturbez un octet de
 * `assets/vecteurs/contrat.json` et **cette classe tombe**. Un client qui resterait vert
 * ne lit pas le fichier, quelles que soient les apparences de son code (ADR-0002 §4).
 * C'est langage-agnostique et insensible au formatage.
 *
 * Ce que cette classe **ne** couvre pas : les règles de comportement, qui ne sont pas des
 * vecteurs. « Ce qui ne se déchiffre pas s'affiche quand même » n'est vérifiable par aucune
 * donnée partagée — son témoin est dans [RegleDAffichageTest], chez son client, comme
 * l'ADR le demande.
 */
class ContratTest {

    // ─── La lecture du fichier ───

    /**
     * Le fichier doit être **trouvé**, et son absence doit tomber — jamais s'ignorer.
     *
     * C'est le troisième état de l'ADR §2 : conforme, divergent, ou *pas pu regarder*. Un
     * test qui passerait au vert faute d'avoir trouvé ses vecteurs est pire que pas de
     * test — il fait croire à une vérification qui n'a pas eu lieu. Toutes les méthodes
     * ci-dessous passent donc par ici.
     */
    @Test
    fun leFichierDeVecteursEstTrouveEtLisible() {
        assertEquals(
            "la version du fichier de vecteurs a changé : relisez l'ADR-0002 avant d'ajuster",
            1,
            contrat["version"]!!.jsonPrimitive.content.toInt(),
        )
    }

    // ─── §1 — la dérivation ───

    /**
     * Le vecteur le plus important : il vient de `hash-wasm`, la bibliothèque du
     * navigateur, et non du cœur. Il vérifie que Kotlin obtient ce que le web obtient.
     *
     * `CoeurTest.laDerivationReproduitCelleDuNavigateur` fait déjà traverser la frontière
     * avec cette valeur ; ici on vérifie que la valeur qu'il utilise est bien **celle du
     * fichier**, et que la taille de sel exigée l'est aussi.
     */
    @Test
    fun laDerivationSuitLeFichier() {
        val derivation = contrat["zk_derivation"]!!.jsonObject
        val phrase = derivation["passphrase"]!!.jsonPrimitive.content
        val selHex = derivation["salt_hex"]!!.jsonPrimitive.content
        val attendu = derivation["expected_hex"]!!.jsonPrimitive.content
        val octetsDeSel = derivation["salt_bytes"]!!.jsonPrimitive.content.toInt()

        val sel = octetsDepuisHex(selHex)
        assertEquals("le sel du fichier doit faire la taille qu'il déclare", octetsDeSel, sel.size)
        assertEquals(
            "la clé dérivée diffère de celle que produit hash-wasm : les enveloppes " +
                "existantes ne s'ouvriraient plus",
            attendu,
            hex(uniffi.ghost_crypto_ffi.deriverCle(phrase, sel)),
        )

        for (taille in derivation["rejected_salt_bytes"]!!.jsonArray) {
            val n = taille.jsonPrimitive.content.toInt()
            if (n == octetsDeSel) continue
            var refuse = false
            try {
                uniffi.ghost_crypto_ffi.deriverCle("peu importe", ByteArray(n))
            } catch (_: uniffi.ghost_crypto_ffi.GhostCryptoException) {
                refuse = true
            }
            assertTrue("un sel de $n octets doit être refusé", refuse)
        }
    }

    // ─── §2 — les registres à nom réservé ───

    /**
     * Les quatre noms de registres, et le préfixe, tels que le fichier les écrit.
     *
     * À un octet près, l'élément cesse d'être filtré et apparaît dans la liste comme une
     * ligne fantôme. Le NUL est vérifié pour ce qu'il est — l'octet 0 — et pas seulement
     * par comparaison de chaînes : une espace et un NUL se ressemblent beaucoup à la
     * relecture, et rien d'autre ne les distingue à l'œil.
     */
    @Test
    fun lesNomsDeRegistresSuiventLeFichier() {
        val registres = contrat["registries"]!!.jsonObject
        assertEquals(registres["prefix"]!!.jsonPrimitive.content, Registres.PREFIXE)
        assertEquals(
            "le préfixe doit commencer par un octet NUL, pas par une espace",
            0,
            Registres.PREFIXE.toByteArray(Charsets.UTF_8)[0].toInt(),
        )

        val noms = registres["names"]!!.jsonObject
        assertEquals(noms["folders"]!!.jsonPrimitive.content, Registres.DOSSIERS)
        assertEquals(noms["favorites"]!!.jsonPrimitive.content, Registres.FAVORIS)
        assertEquals(noms["shares"]!!.jsonPrimitive.content, Registres.PARTAGES)
        assertEquals(noms["org_colors"]!!.jsonPrimitive.content, Registres.COULEURS_DEQUIPE)
    }

    // ─── §3 — les couleurs d'équipe ───

    /**
     * La palette et la règle d'attribution, vecteur par vecteur, depuis le fichier.
     *
     * Le vecteur `""` n'existe que dans le fichier : `ContractTests.swift` ne le porte pas.
     * Le lire plutôt que le transcrire l'apporte gratuitement.
     */
    @Test
    fun lesCouleursDEquipeSuiventLeFichier() {
        val couleurs = contrat["org_colors"]!!.jsonObject
        val palette = couleurs["palette"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals("la palette doit être celle du fichier", palette, CouleurDEquipe.palette)

        for ((identifiant, attendue) in couleurs["vectors"]!!.jsonObject) {
            assertEquals(
                "couleur attribuée à « $identifiant »",
                attendue.jsonPrimitive.content,
                CouleurDEquipe.attribuee(identifiant),
            )
        }
    }

    /**
     * Une valeur illisible retombe sur la couleur attribuée — **jamais sur du noir**.
     *
     * Le registre des couleurs est écrit par d'autres clients. Un analyseur indulgent
     * rendrait 0 sur « bleu » ou « #GGGGGG », c'est-à-dire du noir, et l'utilisateur
     * verrait une équipe passer au noir sans que rien ne l'explique.
     */
    @Test
    fun uneCouleurIllisibleRetombeSurCelleAttribuee() {
        val couleurs = contrat["org_colors"]!!.jsonObject
        for (valeur in couleurs["unreadable_falls_back_to_assigned"]!!.jsonArray) {
            val texte = valeur.jsonPrimitive.content
            assertNull("« $texte » n'est pas une couleur lisible", CouleurDEquipe.couleurArgb(texte))
        }
        // Et ce qui est lisible l'est bien, dans les deux écritures.
        assertNotNull(CouleurDEquipe.couleurArgb("#4C8DFF"))
        assertNotNull(CouleurDEquipe.couleurArgb("4C8DFF"))
        // Aller-retour sur toute la palette : la couleur choisie au sélecteur se réécrit
        // dans la forme que le web sait relire.
        for (hex in CouleurDEquipe.palette) {
            assertEquals(hex, CouleurDEquipe.hexDe(CouleurDEquipe.couleurArgb(hex)!!))
        }
    }

    // ─── §4 — les domaines de partage ───

    /**
     * L'ancre de confiance est **le serveur que l'utilisateur a saisi**, et le fichier
     * porte les couples à accepter comme ceux à refuser.
     *
     * Le cas `ghostpass.example.com.attaquant.example` est celui qui compte : accepter
     * sans contrôle l'adresse rendue par le serveur reviendrait à le laisser désigner qui
     * recevra la clé de déchiffrement, qu'il obtiendrait alors en clair alors qu'il ne
     * détient aujourd'hui qu'un chiffré.
     */
    @Test
    fun lesDomainesDePartageSuiventLeFichier() {
        val domaines = contrat["share_link_domains"]!!.jsonObject

        for (couple in domaines["accepted"]!!.jsonArray) {
            val (serveur, lien) = deuxChaines(couple)
            assertTrue(
                "« $lien » doit être accepté depuis « $serveur »",
                DestinationDePartage.estDeConfiance(lien, serveur, emptySet()),
            )
        }
        for (couple in domaines["rejected"]!!.jsonArray) {
            val (serveur, lien) = deuxChaines(couple)
            assertFalse(
                "« $lien » ne doit PAS être accepté depuis « $serveur »",
                DestinationDePartage.estDeConfiance(lien, serveur, emptySet()),
            )
        }
        for (triplet in domaines["accepted_after_user_approval"]!!.jsonArray) {
            val elements = triplet.jsonArray.map { it.jsonPrimitive.content }
            val (serveur, lien, approuve) = Triple(elements[0], elements[1], elements[2])
            assertFalse(
                "« $lien » ne doit pas passer sans l'accord explicite de l'utilisateur",
                DestinationDePartage.estDeConfiance(lien, serveur, emptySet()),
            )
            assertTrue(
                "« $lien » doit passer une fois « $approuve » approuvé pour ce serveur",
                DestinationDePartage.estDeConfiance(lien, serveur, setOf(approuve)),
            )
        }
    }

    /**
     * Les domaines approuvés se mémorisent **par serveur, jamais globalement** (§4).
     *
     * Une approbation globale ferait qu'accepter `ghostbit.example.com` pour son serveur
     * d'entreprise l'accepterait aussi pour l'instance d'un tiers, où ce domaine n'a
     * aucune raison d'être de confiance.
     */
    @Test
    fun uneApprobationNeVautQuePourSonServeur() {
        val approuves = setOf("ghostbit.example.com")
        assertTrue(
            DestinationDePartage.estDeConfiance(
                "https://ghostbit.example.com/p/abc", "https://ghostpass.example.com", approuves),
        )
        assertFalse(
            "l'approbation d'un serveur ne doit rien autoriser chez un autre",
            DestinationDePartage.estDeConfiance(
                "https://ghostbit.example.com/p/abc", "https://autre.example.com", emptySet()),
        )
    }

    // ─── §5 des vecteurs — les horodatages ───

    /**
     * Le registre des partages compte en **secondes**.
     *
     * `createdAt` et `expiresAt` étaient dans deux unités différentes au premier jet, dans
     * une structure partagée par trois clients : l'écart ne se serait vu qu'à l'affichage,
     * chez celui qui n'a pas écrit la ligne.
     */
    @Test
    fun lesHorodatagesDuRegistreSontEnSecondes() {
        val horodatages = contrat["timestamps"]!!.jsonObject
        assertEquals("seconds", horodatages["unit"]!!.jsonPrimitive.content)
        val controle = horodatages["difference_check"]!!.jsonObject
        val cree = controle["created_at"]!!.jsonPrimitive.content.toLong()
        val expire = controle["expires_at"]!!.jsonPrimitive.content.toLong()
        val ecart = controle["expected_difference_seconds"]!!.jsonPrimitive.content.toLong()

        val partage = PartageEnCours(
            id = "a", url = "https://x/p/a#k", deleteToken = "j", name = "n",
            createdAt = cree, expiresAt = expire,
        )
        assertEquals(ecart, partage.expiresAt!! - partage.createdAt)
        assertEquals(
            "un horodatage en secondes tient sur dix chiffres",
            horodatages["digits"]!!.jsonPrimitive.content.toInt(),
            partage.createdAt.toString().length,
        )
    }

    /**
     * Et les horodatages des **éléments**, eux, sont en millisecondes.
     *
     * Les deux unités cohabitent dans la même application, ce que le fichier de vecteurs ne
     * dit pas : sa clé `timestamps.unit` vaut « seconds » et ne parle que du registre des
     * partages. Le confirmer ici évite qu'on lise le fichier comme une règle générale et
     * qu'on divise par mille les dates d'un coffre entier.
     */
    @Test
    fun lesHorodatagesDesElementsSontEnMillisecondes() {
        val charge = """
            {"items":[{"id":"abc","encryptedKey":"2.k.k","encryptedData":"2.d.d",
             "createdAt":1787669299110,"updatedAt":1787669299110,"deletedAt":null}]}
        """.trimIndent()
        val elements = Json { ignoreUnknownKeys = true }
            .decodeFromString(EnveloppeDeTest.serializer(), charge).items
        assertEquals(1, elements.size)
        assertEquals(1_787_669_299_110L, elements[0].updatedAt)
        assertNull(elements[0].deletedAt)
        assertEquals(
            "treize chiffres : des millisecondes, pas des secondes",
            13,
            elements[0].updatedAt.toString().length,
        )
    }

    @kotlinx.serialization.Serializable
    private data class EnveloppeDeTest(val items: List<ElementChiffre>)

    // ─── Outillage ───

    private fun deuxChaines(couple: kotlinx.serialization.json.JsonElement): Pair<String, String> {
        val elements = couple.jsonArray.map { it.jsonPrimitive.content }
        return elements[0] to elements[1]
    }

    private fun hex(octets: ByteArray) =
        octets.joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }

    private fun octetsDepuisHex(texte: String) =
        ByteArray(texte.length / 2) { texte.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    private companion object {
        /**
         * Les vecteurs, lus sur le chemin de classes.
         *
         * Ils y arrivent par `resources.srcDir(…/assets/vecteurs)`, déclaré dans
         * `:coeur-hote` **et** dans l'`androidTest` de `:app` : le même fichier est lu sur
         * la JVM du poste et depuis l'APK de test. Un chemin de fichier relatif, lui,
         * n'aurait pas survécu au passage sur appareil.
         *
         * L'absence du fichier **lève**. C'est le troisième état de l'ADR-0002 §2 : ne pas
         * avoir pu regarder n'est pas la même chose qu'avoir regardé et trouvé conforme, et
         * seul l'échec les distingue.
         */
        val contrat: JsonObject by lazy {
            val flux = ContratTest::class.java.classLoader
                ?.getResourceAsStream("contrat.json")
                ?: error(
                    "contrat.json est introuvable sur le chemin de classes des tests.\n" +
                        "C'est un échec, pas un test à sauter : sans les vecteurs, rien " +
                        "n'a été vérifié.\n" +
                        "La copie vendorée vit dans assets/vecteurs/ à la racine du dépôt, " +
                        "et les modules de test la déclarent en `resources.srcDir`.",
                )
            val texte = flux.bufferedReader(Charsets.UTF_8).use { it.readText() }
            Json.parseToJsonElement(texte).jsonObject
        }
    }
}
