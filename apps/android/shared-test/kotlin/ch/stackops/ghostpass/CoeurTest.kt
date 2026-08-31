package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.chiffrerSymetrique
import uniffi.ghost_crypto_ffi.cleDepuisFragment
import uniffi.ghost_crypto_ffi.cleVersFragment
import uniffi.ghost_crypto_ffi.dechiffrerSymetrique
import uniffi.ghost_crypto_ffi.defaultKdfParams
import uniffi.ghost_crypto_ffi.deriverCle
import uniffi.ghost_crypto_ffi.masterPasswordHash
import uniffi.ghost_crypto_ffi.openSend
import uniffi.ghost_crypto_ffi.register
import uniffi.ghost_crypto_ffi.sealSend
import uniffi.ghost_crypto_ffi.selAleatoire

/**
 * Le test qui fait traverser le cœur Rust jusqu'à Kotlin.
 *
 * Il n'y a rien ici qui ressemble à de l'application : chaque assertion appelle le cœur
 * commun à travers la frontière UniFFI, et compare le résultat à une valeur **recopiée**
 * — jamais recalculée. Un vecteur qu'on recalcule avec le code qu'on vérifie ne compare
 * que le cœur à lui-même.
 *
 * Le même fichier est compilé deux fois :
 *
 *  - par `:coeur-hote:test`, sur la JVM du poste, contre `libghost_crypto_ffi.dylib` ;
 *  - par `:app:connectedAndroidTest`, sur un appareil, contre le `.so` de son ABI.
 *
 * Le premier dit que le cœur et les liaisons s'accordent. Le second, en plus, que l'APK
 * embarque bien les `.so` et qu'Android sait les charger. Aucun des deux ne remplace
 * l'autre.
 *
 * Provenance des valeurs :
 *
 *  - la dérivation Argon2id vient de `hash-wasm`, la bibliothèque du **navigateur**
 *    (docs/android.md §1, et `ghost-crypto/tests/zk_interop.rs`) ;
 *  - le vecteur de fragment vient du web lui aussi (`zk_interop.rs`) ;
 *  - tout le reste est repris valeur par valeur de `apps/ios/Tests/ContractTests.swift`.
 */
class CoeurTest {

    // ─── La dérivation du mot de passe maître ───

    /**
     * Le vecteur le plus important du fichier. Il vient de **hash-wasm**, la bibliothèque
     * Argon2 que le navigateur exécute — pas du cœur. C'est ce qui le rend capable
     * d'échouer.
     *
     * Produit par :
     *   argon2id({password:"correct horse", salt: Uint8Array(16).fill(7),
     *             parallelism:1, iterations:3, memorySize:65536, hashLength:32})
     *
     * Un échec ici veut dire qu'aucun utilisateur n'ouvrira plus sa session : c'est cette
     * clé qui déballe la clé privée de l'organisation.
     */
    @Test
    fun laDerivationReproduitCelleDuNavigateur() {
        val sel = ByteArray(16) { 0x07 }
        val attendu = "7b985d8fa00c9eccccf918c8cb9feaa8036af381caf6f498e099b5b849b8c18a"
        assertEquals(
            "la clé dérivée diffère de celle que produit hash-wasm : les enveloppes " +
                "existantes ne s'ouvriraient plus",
            attendu,
            hex(deriverCle("correct horse", sel)),
        )
    }

    /**
     * Le sel fait 16 octets côté web. En accepter d'autres laisserait produire des clés
     * que le navigateur ne saurait pas reproduire.
     */
    @Test
    fun unSelDeMauvaiseTailleEstRefuse() {
        for (taille in intArrayOf(8, 32)) {
            var refuse = false
            try {
                deriverCle("peu importe", ByteArray(taille))
            } catch (_: GhostCryptoException) {
                refuse = true
            }
            assertTrue("un sel de $taille octets doit être refusé", refuse)
        }
    }

    /** Un sel neuf traverse la frontière avec la bonne taille. */
    @Test
    fun leSelAleatoireFaitSeizeOctets() {
        assertEquals(16, selAleatoire().size)
        assertNotEquals(hex(selAleatoire()), hex(selAleatoire()))
    }

    // ─── Le hash d'authentification ───

    /**
     * Repris de `testLesParametresKdfDuServeurSontAcceptesParLeCoeur`. Le serveur stocke
     * `kdf_params` en colonne TEXT et la renvoie **verbatim** : c'est une chaîne
     * contenant du JSON, jamais un objet JSON. La chaîne doit arriver au cœur telle
     * quelle — une version re-sérialisée produisait une chaîne doublement échappée que
     * serde rejette, et toute connexion échouait.
     */
    @Test
    fun lesParametresKdfDuServeurSontAcceptesParLeCoeur() {
        val kdf = "{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}"
        val hash = masterPasswordHash(
            "correct horse battery staple",
            "clara@ghostpass.test",
            kdf,
        )
        assertTrue("le hash d'authentification ne doit pas être vide", hash.isNotEmpty())
        // Déterministe : même mot de passe, même sel (l'adresse), mêmes paramètres.
        assertEquals(
            hash,
            masterPasswordHash("correct horse battery staple", "clara@ghostpass.test", kdf),
        )
        // Et lié à l'adresse, qui sert de sel.
        assertNotEquals(
            hash,
            masterPasswordHash("correct horse battery staple", "autre@ghostpass.test", kdf),
        )
    }

    /**
     * Les paramètres par défaut du cœur doivent être exactement ceux que le serveur
     * renvoie dans `ContractTests.swift`. S'ils divergeaient, un compte créé depuis
     * Android ne se déverrouillerait plus depuis le web.
     */
    @Test
    fun lesParametresParDefautSontCeuxQueLeServeurRenvoie() {
        assertEquals(
            "{\"mem_cost_kib\":65536,\"time_cost\":3,\"parallelism\":4}",
            defaultKdfParams(),
        )
    }

    // ─── Aller-retour d'un item à travers le cœur ───

    /**
     * Repris de `testUnItemSurvitAuChiffrementEtAuDechiffrement`. Ce test tient les noms
     * de champs serde (`password_history`, `exp_month`, …) : un seul qui diverge et le
     * champ se perd en silence, ce qu'aucune erreur ne signalerait.
     */
    @Test
    fun unItemSurvitAuChiffrementEtAuDechiffrement() {
        val compte = compteDeTest()
        for (item in ITEMS) {
            val relu = compte.decryptItem(compte.encryptItem(item))
            // Le cœur re-sérialise ce qu'il a déchiffré : un second aller-retour doit
            // rendre exactement la même chaîne, sinon un champ s'est perdu en chemin.
            assertEquals(relu, compte.decryptItem(compte.encryptItem(relu)))
        }

        val login = compte.decryptItem(compte.encryptItem(ITEMS[0]))
        for (fragment in listOf(
            "\"name\":\"Forgejo\"",
            "\"notes\":\"compte de service\"",
            "\"folder\":\"Travail/Serveurs\"",
            "\"kind\":\"Login\"",
            "\"username\":\"clara\"",
            "\"password\":\"s3cret\"",
            "\"uris\":[\"https://git.stackops.ch\"]",
            "\"totp\":\"otpauth://totp/x\"",
            "\"password_history\":[\"ancien1\",\"ancien2\"]",
        )) {
            assertTrue("le login relu doit porter $fragment — reçu $login", login.contains(fragment))
        }

        val carte = compte.decryptItem(compte.encryptItem(ITEMS[2]))
        for (fragment in listOf(
            "\"kind\":\"Card\"",
            "\"cardholder\":\"Clara\"",
            "\"number\":\"4111111111111111\"",
            "\"exp_month\":\"04\"",
            "\"exp_year\":\"2030\"",
            "\"code\":\"123\"",
        )) {
            assertTrue("la carte relue doit porter $fragment — reçue $carte", carte.contains(fragment))
        }

        val note = compte.decryptItem(compte.encryptItem(ITEMS[1]))
        assertTrue("les accents doivent survivre à la frontière FFI", note.contains("à ne pas oublier"))
    }

    /** Repris de `testUnAutreCompteNeDechiffrePas` : une clé d'enveloppe étrangère n'ouvre rien. */
    @Test
    fun unAutreCompteNeDechiffrePas() {
        val a = compteDeTest()
        val b = compteDeTest()
        val scelle = a.encryptItem(ITEMS[1])
        var refuse = false
        try {
            b.decryptItem(scelle)
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue("un autre compte ne doit rien pouvoir ouvrir", refuse)
    }

    // ─── Les registres à nom réservé ───

    /**
     * Repris de `testLeNomDuRegistreCommenceParUnOctetNul`. À un octet près, l'item cesse
     * d'être filtré et apparaît dans la liste comme une ligne fantôme.
     */
    @Test
    fun leNomDuRegistreCommenceParUnOctetNul() {
        assertEquals("\u0000gp:folders", NOM_DU_REGISTRE_DOSSIERS)
        assertEquals(0, NOM_DU_REGISTRE_DOSSIERS.toByteArray(Charsets.UTF_8)[0].toInt())
    }

    /**
     * Repris de `testLeRegistreEcritParLaWebAppEstFiltre`, réduit à ce qui traverse le
     * cœur : un octet NUL en tête de nom doit survivre à l'aller-retour. Rien ne garantit
     * a priori qu'une chaîne Kotlin contenant un NUL passe la frontière FFI intacte — et
     * si elle était tronquée, le registre deviendrait un item ordinaire visible de tous.
     */
    @Test
    fun leRegistreEcritParLaWebAppTraverseLeCoeur() {
        val compte = compteDeTest()
        val registre = """
            {"name":"\u0000gp:folders","notes":null,"folder":null,
             "data":{"kind":"SecureNote","data":{"content":"[\"Travail/Serveurs\"]"}}}
        """.trimIndent()
        val relu = compte.decryptItem(compte.encryptItem(registre))
        assertTrue(
            "le nom du registre doit revenir avec son octet NUL — reçu $relu",
            relu.contains("\\u0000gp:folders"),
        )
        assertTrue(relu.contains("Travail/Serveurs"))
    }

    // ─── Le partage ponctuel et son fragment ───

    /** Repris des tests de partage de `ContractTests.swift`. */
    @Test
    fun unPartageSeRouvreAvecSaCleEtPasAvecUneAutre() {
        val scelle = sealSend("le code du coffre : 4821")
        assertEquals(
            "le code du coffre : 4821",
            openSend(scelle.key, scelle.nonce, scelle.ciphertext),
        )

        val autre = sealSend("autre")
        var refuse = false
        try {
            openSend(autre.key, scelle.nonce, scelle.ciphertext)
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue("sans la clé, le serveur ne détient qu'un chiffre", refuse)

        // Deux partages du même texte ne doivent pas donner le même chiffre.
        assertNotEquals(sealSend("identique").ciphertext, sealSend("identique").ciphertext)
    }

    /**
     * Le lien produit par le web doit s'ouvrir au mobile : la conversion clé ↔ fragment
     * est un format de fil, même si elle ressemble à de l'encodage d'URL. Vecteur repris
     * de `ghost-crypto/tests/zk_interop.rs`, où il vient du navigateur.
     */
    @Test
    fun leFragmentDuWebSeLitALIdentique() {
        val b64Web = "MC4CAQAwBQYDK2VuBCIEIPv/Pn8AESIzRFVmd4iZqrvM3e7/AQIDBAUGBwgJCgsM"
        val fragmentWeb = "MC4CAQAwBQYDK2VuBCIEIPv_Pn8AESIzRFVmd4iZqrvM3e7_AQIDBAUGBwgJCgsM"
        assertTrue(
            "le vecteur doit contenir un + ou un / pour éprouver quoi que ce soit",
            b64Web.contains('+') || b64Web.contains('/'),
        )
        assertEquals(fragmentWeb, cleVersFragment(b64Web))
        assertEquals(b64Web, cleDepuisFragment(fragmentWeb))
    }

    // ─── Le chiffrement symétrique, tel que le web l'écrit ───

    @Test
    fun uneEnveloppeSymetriqueSeRouvre() {
        val cle = deriverCle("correct horse", ByteArray(16) { 0x07 })
        val clair = "à ne pas oublier".toByteArray(Charsets.UTF_8)
        val blob = chiffrerSymetrique(cle, clair)
        assertEquals(
            "à ne pas oublier",
            String(dechiffrerSymetrique(cle, blob), Charsets.UTF_8),
        )
    }

    // ─── Outillage ───

    private fun compteDeTest() =
        register("correct horse battery staple", "clara@ghostpass.test").account()

    private fun hex(octets: ByteArray) =
        octets.joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }

    private companion object {
        /**
         * Le nom du registre des dossiers, tel que l'écrit la web app : un octet NUL suivi
         * de `gp:folders` (docs/android.md §2). Aucun clavier ne produit un NUL, donc
         * aucun nom d'utilisateur ne peut usurper ce registre.
         */
        const val NOM_DU_REGISTRE_DOSSIERS = "\u0000gp:folders"

        /**
         * Les trois items de `testUnItemSurvitAuChiffrementEtAuDechiffrement`, en JSON —
         * la forme dans laquelle le cœur les reçoit. Les noms de champs sont ceux de
         * serde, et c'est précisément ce qu'on vérifie.
         */
        val ITEMS = listOf(
            """
            {"name":"Forgejo","notes":"compte de service","folder":"Travail/Serveurs",
             "data":{"kind":"Login","data":{"username":"clara","password":"s3cret",
             "uris":["https://git.stackops.ch"],"totp":"otpauth://totp/x",
             "password_history":["ancien1","ancien2"]}}}
            """.trimIndent(),
            """
            {"name":"Note","notes":null,"folder":null,
             "data":{"kind":"SecureNote","data":{"content":"à ne pas oublier"}}}
            """.trimIndent(),
            """
            {"name":"Carte","notes":null,"folder":null,
             "data":{"kind":"Card","data":{"cardholder":"Clara","number":"4111111111111111",
             "exp_month":"04","exp_year":"2030","code":"123"}}}
            """.trimIndent(),
        )
    }
}
