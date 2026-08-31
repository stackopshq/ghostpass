package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.openSend
import uniffi.ghost_crypto_ffi.sealSend

/**
 * L'enveloppe d'un partage de lien — le bloc `share_envelope` de `contrat.json`.
 *
 * **Ce n'est pas le scellement du coffre**, et les confondre a rendu la création de partage
 * impossible depuis mobile pendant plusieurs jours : le cœur produisait le nonce de 24
 * octets de XChaCha20, le relais refusait « expected 12 bytes after decode, got 24 », et le
 * serveur traduisait ce refus en 502.
 *
 * ## Pourquoi ce test est **croisé**, et pourquoi c'est le seul qui vaille
 *
 * Le contrat le dit en toutes lettres : « un témoin qui vérifie qu'un côté se relit lui-même
 * passe au vert dans le monde cassé ». C'est exact et c'est le piège central de cette
 * classe de défaut : sceller puis rouvrir avec la même implémentation réussit tout aussi
 * bien en XChaCha20 qu'en AES-GCM. Le test serait vert, et le partage cassé.
 *
 * Le vecteur de `crossed_vector` vient donc de **l'autre côté** : clé et nonce constants,
 * chiffré produit par WebCrypto — celui du navigateur qui ouvrira le lien. Que le cœur
 * l'ouvre est la seule chose qui prouve que les deux parlent le même format.
 *
 * L'autre direction — ce que le cœur scelle doit s'ouvrir chez le navigateur — est mesurée
 * par `tools/android/temoin-du-partage-croise.sh`, qui fait ouvrir un scellement du cœur
 * par une implémentation AES-GCM tierce.
 *
 * ## Ce que le vendorage nous avait caché
 *
 * Ce bloc **manquait dans la copie vendorée** de ce dépôt au moment d'écrire ces lignes,
 * alors qu'il existait dans le fichier canonique de la suite. Le fichier était donc vendoré
 * *et* périmé — la pire des deux situations, puisqu'on croit lire le contrat commun. Un
 * `diff` entre les deux copies l'a montré en une seconde ; rien d'autre ne l'aurait fait.
 */
class EnveloppeDePartageTest {

    private val enveloppe: JsonObject
        get() = contrat["share_envelope"]?.jsonObject ?: error(
            "Le bloc `share_envelope` manque de la copie vendorée de contrat.json.\n" +
                "Ce n'est pas un test à sauter : c'est le format d'enveloppe des partages, " +
                "et son absence est exactement la raison pour laquelle une divergence est " +
                "restée invisible entre le cœur et le navigateur.\n" +
                "Re-vendorez depuis suite/assets/vecteurs/contrat.json.",
        )

    /**
     * **Le témoin croisé.** Ce que le navigateur a scellé, le cœur doit l'ouvrir.
     *
     * Si l'algorithme ou la taille de nonce divergeaient, cette ligne tomberait — et elle
     * est la seule à pouvoir le faire, puisque tous les autres chemins passent deux fois
     * par la même implémentation.
     */
    @Test
    fun leCoeurOuvreCeQueLeNavigateurAScelle() {
        val vecteur = enveloppe["crossed_vector"]!!.jsonObject
        val clair = openSend(
            vecteur["key_b64"]!!.jsonPrimitive.content,
            vecteur["nonce_b64"]!!.jsonPrimitive.content,
            vecteur["ciphertext_b64"]!!.jsonPrimitive.content,
        )
        assertEquals(
            "le cœur n'ouvre pas ce que WebCrypto a scellé : les deux ne parlent pas le " +
                "même format d'enveloppe, et aucun partage ne traversera",
            vecteur["plaintext"]!!.jsonPrimitive.content,
            clair,
        )
    }

    /**
     * Le contrôle du témoin croisé : le vecteur n'est pas ouvrable par n'importe quoi.
     *
     * Sans lui, on ne saurait pas si le test précédent mesure l'algorithme ou se contente
     * de constater qu'`openSend` rend quelque chose. On perturbe **là où le consommateur
     * lit** — un caractère du chiffré — et le sceau doit refuser.
     */
    @Test
    fun unChiffreAltereEstRefuse() {
        val vecteur = enveloppe["crossed_vector"]!!.jsonObject
        val chiffre = vecteur["ciphertext_b64"]!!.jsonPrimitive.content
        val dernier = chiffre.last()
        val altere = chiffre.dropLast(1) + if (dernier == 'A') 'B' else 'A'
        assertNotEquals(chiffre, altere)

        var refuse = false
        try {
            openSend(
                vecteur["key_b64"]!!.jsonPrimitive.content,
                vecteur["nonce_b64"]!!.jsonPrimitive.content,
                altere,
            )
        } catch (_: Exception) {
            refuse = true
        }
        assertTrue("un chiffré altéré doit être refusé par l'authentification de GCM", refuse)
    }

    /**
     * Le nonce que le cœur produit fait la taille que le contrat annonce.
     *
     * C'est le défaut qui a coûté les jours : un nonce de 24 octets, parfaitement valide
     * pour le coffre, que le relais refusait. Le contrôle porte sur la valeur **lue dans le
     * fichier**, pas sur un `12` écrit ici — un `12` en dur resterait vert le jour où le
     * contrat changerait.
     */
    @Test
    fun leNonceDuCoeurFaitLaTailleDuContrat() {
        val attendu = enveloppe["nonce_bytes"]!!.jsonPrimitive.content.toInt()
        val octetsDeCle = enveloppe["key_bytes"]!!.jsonPrimitive.content.toInt()
        val scelle = sealSend("un mot de passe partage")

        assertEquals(
            "le nonce du cœur ne fait pas la taille du contrat : c'est exactement le " +
                "défaut « expected 12 bytes after decode, got 24 »",
            attendu,
            base64(scelle.nonce).size,
        )
        assertEquals("la clé de partage ne fait pas la taille du contrat",
            octetsDeCle, base64(scelle.key).size)
    }

    /** Et ce que le cœur scelle, le cœur le rouvre — la moitié la moins intéressante. */
    @Test
    fun leCoeurRouvreSonPropreScellement() {
        val scelle = sealSend("un mot de passe partage")
        assertEquals(
            "un aller-retour par le cœur doit rendre le clair",
            "un mot de passe partage",
            openSend(scelle.key, scelle.nonce, scelle.ciphertext),
        )
    }

    /**
     * Les tailles de nonce que le contrat range en `rejected` sont bien refusées.
     *
     * Celle de 24 octets est le nonce du coffre : c'est celle qui a fait le défaut, et la
     * plus facile à réintroduire, puisqu'elle vient d'une autre partie du même cœur.
     */
    @Test
    fun lesTaillesDeNonceRefuseesLeSontVraiment() {
        val refusees = enveloppe["rejected"]!!.jsonObject["nonce_bytes"]!!.jsonArray
            .map { it.jsonPrimitive.content.toInt() }
        assertTrue("le contrat doit nommer au moins une taille refusée", refusees.isNotEmpty())

        val scelle = sealSend("un mot de passe partage")
        for (taille in refusees) {
            var refuse = false
            try {
                openSend(scelle.key, base64(ByteArray(taille)), scelle.ciphertext)
            } catch (_: Exception) {
                refuse = true
            }
            assertTrue("un nonce de $taille octets doit être refusé", refuse)
        }
    }

    /**
     * La clé voyage en **base64url sans remplissage**, et doit être acceptée telle quelle.
     *
     * N'accepter que le base64 standard échoue sur « Invalid padding » — un message qui
     * accuse le format et laisse croire à une clé corrompue.
     */
    @Test
    fun laCleSeLitAussiEnBase64url() {
        val transport = enveloppe["transport"]!!.jsonObject
        assertTrue(
            "le contrat doit dire que la clé voyage dans le fragment",
            transport["key_in_url_fragment"]!!.jsonPrimitive.content.toBoolean(),
        )
        val scelle = sealSend("un mot de passe partage")
        val enUrl = scelle.key.replace('+', '-').replace('/', '_').trimEnd('=')
        assertEquals(
            "la clé écrite comme elle voyage — base64url sans remplissage — doit ouvrir",
            "un mot de passe partage",
            openSend(enUrl, scelle.nonce, scelle.ciphertext),
        )
    }

    // ─── Le lien, et les deux générations de serveur (§4) ───

    /**
     * Le serveur **à relais** rend une adresse : c'est elle qui fait foi.
     *
     * La reconstruire depuis l'identifiant produirait un lien vers une machine qui ne
     * connaît pas ce partage — mort, et sans la moindre erreur pour le dire.
     */
    @Test
    fun lAdresseRendueParLeServeurFaitFoi() {
        val lien = Coffre.lienDePartage(
            PartageCree(id = "abc", url = "https://ghostbit.example.com/p/abc"),
            adresseServeur = "https://ghostpass.example.com",
            cle = "AAAA",
        )
        assertTrue(lien, lien.startsWith("https://ghostbit.example.com/p/abc#"))
    }

    /**
     * Un serveur antérieur ne rend qu'un identifiant : on déduit alors l'adresse de la
     * sienne, ce qui est la seule chose juste à faire.
     *
     * Se fier à `url` seule casserait le partage sur tous les serveurs pas encore basculés
     * — dont celui de cette branche.
     */
    @Test
    fun sansAdresseRendueOnRetombeSurLaNotre() {
        val lien = Coffre.lienDePartage(
            PartageCree(id = "abc"),
            adresseServeur = "https://ghostpass.example.com",
            cle = "AAAA",
        )
        assertTrue(lien, lien.startsWith("https://ghostpass.example.com/s/abc#"))
    }

    /**
     * **La clé s'écrit en base64url sans remplissage dans le fragment.**
     *
     * `contrat.json`, bloc `share_envelope.transport`, le dit et prévient de l'erreur :
     * n'accepter que le base64 standard échoue sur « Invalid padding », un message qui
     * accuse le format et laisse croire à une clé corrompue.
     *
     * On part donc d'une clé qui contient **les trois caractères qui diffèrent** — `+`, `/`
     * et le remplissage. Une clé sans eux passerait quelle que soit la conversion, et le
     * témoin serait vert des deux côtés de la mutation.
     */
    @Test
    fun laCleSEcritEnBase64urlDansLeFragment() {
        val cleStandard = "a+b/c=="
        val lien = Coffre.lienDePartage(
            PartageCree(id = "abc"), "https://ghostpass.example.com", cleStandard)
        val fragment = lien.substringAfter('#')
        assertEquals("a-b_c", fragment)
        assertFalse("un fragment ne doit porter ni + ni /", fragment.any { it == '+' || it == '/' })
        assertFalse("ni remplissage", fragment.contains('='))
    }

    /**
     * Un horodatage qui n'est pas plausible en secondes n'est **pas inscrit**.
     *
     * `expiresAt` vient d'un service de partage tiers, par un relais qui ne fait que le
     * transmettre : rien dans ce dépôt n'en garantit l'unité, alors que le registre est en
     * secondes. On préfère ne rien inscrire à inscrire une valeur mille fois trop grande —
     * convertir à la volée reviendrait à deviner l'unité d'un champ dont c'est justement
     * l'unité qui est en jeu.
     */
    @Test
    fun unHorodatageQuiNEstPasEnSecondesNEstPasInscrit() {
        assertEquals(1_788_000_000L, Coffre.secondesPlausibles(1_788_000_000L))
        assertEquals(
            "1 788 000 000 000 est ce même instant en millisecondes : il ne doit pas entrer",
            null,
            Coffre.secondesPlausibles(1_788_000_000_000L),
        )
        assertEquals(null, Coffre.secondesPlausibles(null))
        assertEquals(null, Coffre.secondesPlausibles(0L))
    }

    // ─── Outillage ───

    private fun base64(texte: String): ByteArray = java.util.Base64.getDecoder().decode(texte)
    private fun base64(octets: ByteArray): String = java.util.Base64.getEncoder().encodeToString(octets)

    private companion object {
        val contrat: JsonObject by lazy {
            val flux = EnveloppeDePartageTest::class.java.classLoader
                ?.getResourceAsStream("contrat.json")
                ?: error(
                    "contrat.json est introuvable sur le chemin de classes des tests.\n" +
                        "C'est un échec, pas un test à sauter : sans les vecteurs, rien " +
                        "n'a été vérifié.",
                )
            val texte = flux.bufferedReader(Charsets.UTF_8).use { it.readText() }
            Json.parseToJsonElement(texte).jsonObject
        }
    }
}
