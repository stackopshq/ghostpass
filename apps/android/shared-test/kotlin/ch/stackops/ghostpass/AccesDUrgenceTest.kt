package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.register

/**
 * L'accès d'urgence, éprouvé **de bout en bout et sans serveur**.
 *
 * C'est le seul endroit du produit où la clé d'un coffre est scellée vers un **tiers**. Tout
 * le reste est scellé pour soi-même, ou pour une organisation dont on est membre. Ici la
 * clé part, et trois choses doivent être vraies en même temps :
 *
 *  - le contact désigné **peut** lire le coffre du donneur ;
 *  - quelqu'un d'autre **ne peut pas**, même avec l'enveloppe sous les yeux ;
 *  - la reprise produit bien un compte que le donneur ne peut plus ouvrir avec son ancien
 *    mot de passe.
 *
 * Aucune de ces trois ne se vérifie à l'écran. Le second point surtout : une enveloppe
 * scellée vers la mauvaise clé ne produit **aucune erreur visible** chez celui qui la scelle.
 * Elle échouerait chez le contact, des mois plus tard, au moment où le donneur n'est
 * précisément plus là pour la refaire.
 */
class AccesDUrgenceTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun elementJson(nom: String) = buildJsonObject {
        put("name", nom)
        put("notes", "le code du coffre-fort est dans le tiroir")
        put("folder", null as String?)
        put("data", buildJsonObject {
            put("kind", "Login")
            put("data", buildJsonObject {
                put("username", "clara")
                put("password", "tr0ubad0ur")
                put("uris", buildJsonArray { })
                put("totp", null as String?)
            })
        })
    }

    /** L'enveloppe que le cœur attend, telle que `Coffre.enveloppeDe` la construit. */
    private fun enveloppe(scelle: String): String {
        val objet = json.parseToJsonElement(scelle).jsonObject
        return buildJsonObject {
            put("encrypted_key", objet["encrypted_key"]!!.jsonPrimitive.content)
            put("encrypted_data", objet["encrypted_data"]!!.jsonPrimitive.content)
        }.toString()
    }

    @Test
    fun leContactDesigneLitLeCoffreDuDonneur() {
        val donneur = register("correct horse battery staple", "clara@ghostpass.test").account()
        val contact = register("un autre mot de passe", "kevin@ghostpass.test").account()

        // Le donneur scelle sa clé de coffre vers la clé publique **annoncée** du contact.
        val scellee = donneur.sealUserKeyFor(contact.publicKey())
        val element = donneur.encryptItem(elementJson("Banque").toString())

        // Le contact ouvre, et lit.
        val coffre = contact.openEmergency(donneur.publicKey(), scellee)
        val clair = json.parseToJsonElement(coffre.decryptItem(enveloppe(element))).jsonObject
        assertEquals("Banque", clair["name"]?.jsonPrimitive?.content)
        assertEquals(
            "le contact lit le nom mais pas le contenu : l'enveloppe ne traverse qu'à moitié",
            "le code du coffre-fort est dans le tiroir",
            clair["notes"]?.jsonPrimitive?.content,
        )
    }

    /**
     * **Le témoin qui compte le plus** : un tiers non désigné ne passe pas.
     *
     * Sans lui, celui d'au-dessus prouverait que l'enveloppe s'ouvre, jamais qu'elle ne
     * s'ouvre que pour la bonne personne. Et c'est bien la question : on confie la lecture
     * de tous ses mots de passe à quelqu'un, une fois, sans pouvoir vérifier ensuite.
     */
    @Test
    fun unTiersNonDesigneNOuvrePasLEnveloppe() {
        val donneur = register("correct horse battery staple", "clara@ghostpass.test").account()
        val contact = register("un autre mot de passe", "kevin@ghostpass.test").account()
        val curieux = register("encore un autre", "inconnu@ghostpass.test").account()

        val scellee = donneur.sealUserKeyFor(contact.publicKey())

        var refuse = false
        try {
            curieux.openEmergency(donneur.publicKey(), scellee)
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue(
            "une enveloppe d'urgence scellée pour quelqu'un d'autre s'ouvre quand même : " +
                "n'importe quel compte pourrait lire le coffre du donneur",
            refuse,
        )
    }

    /**
     * L'enveloppe est liée au **donneur** autant qu'au contact.
     *
     * Le contact désigné, présentant la bonne enveloppe mais en prétendant qu'elle vient de
     * quelqu'un d'autre, doit échouer. C'est le domaine de scellement qui l'impose, et sans
     * lui une enveloppe volée pourrait être rejouée sous une autre identité.
     */
    @Test
    fun lEnveloppeEstLieeAuDonneur() {
        val donneur = register("correct horse battery staple", "clara@ghostpass.test").account()
        val contact = register("un autre mot de passe", "kevin@ghostpass.test").account()
        val autreDonneur = register("troisième", "autre@ghostpass.test").account()

        val scellee = donneur.sealUserKeyFor(contact.publicKey())

        var refuse = false
        try {
            contact.openEmergency(autreDonneur.publicKey(), scellee)
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue(
            "l'enveloppe s'ouvre en annonçant un autre donneur : elle n'est pas liée à " +
                "celui qui l'a scellée",
            refuse,
        )
    }

    /**
     * La reprise rend une remise complète, **par le code du produit**.
     *
     * `RepriseDUrgence.depuisLeCoeur` lit les noms de serde ; les écrire en camelCase
     * enverrait des chaînes vides au serveur, qui réinitialiserait le compte du donneur avec
     * un mot de passe que personne ne connaît. Chez quelqu'un qui, par hypothèse, n'est plus
     * là pour le signaler.
     */
    @Test
    fun laRepriseRendUneRemiseComplete() {
        val email = "clara@ghostpass.test"
        val inscription = register("correct horse battery staple", email)
        val donneur = inscription.account()
        val kdf = json.parseToJsonElement(inscription.blob()).jsonObject["kdf_params"]!!.toString()
        val contact = register("un autre mot de passe", "kevin@ghostpass.test").account()

        val coffre = contact.openEmergency(
            donneur.publicKey(), donneur.sealUserKeyFor(contact.publicKey()),
        )
        val remise = RepriseDUrgence.depuisLeCoeur(
            coffre.takeover(email, kdf, "le mot de passe imposé par le contact"),
        )
        assertTrue(remise.empreinteDuMotDePasse.isNotEmpty())
        assertTrue(remise.cleUtilisateur.isNotEmpty())

        // L'empreinte est bien celle du **nouveau** mot de passe, pour le compte du
        // **donneur** : c'est elle que le serveur rangera, et une empreinte calculée sur le
        // mauvais e-mail donnerait un compte que plus personne n'ouvre.
        assertEquals(
            "l'empreinte de la reprise n'est pas celle du nouveau mot de passe du donneur : " +
                "le compte serait réinitialisé vers un mot de passe que personne ne connaît",
            uniffi.ghost_crypto_ffi.masterPasswordHash(
                "le mot de passe imposé par le contact", email, kdf,
            ),
            remise.empreinteDuMotDePasse,
        )
    }

    /**
     * Et le tour entier : après la reprise, le coffre s'ouvre avec le **nouveau** mot de
     * passe, contenu intact.
     */
    @Test
    fun apresLaRepriseLeCoffreSOuvreAvecLeNouveauMotDePasse() {
        val email = "clara@ghostpass.test"
        val inscription = register("correct horse battery staple", email)
        val donneur = inscription.account()
        val enveloppeDuCompte = json.parseToJsonElement(inscription.blob()).jsonObject
        val kdf = enveloppeDuCompte["kdf_params"]!!.toString()
        val element = donneur.encryptItem(elementJson("Banque").toString())

        val contact = register("un autre mot de passe", "kevin@ghostpass.test").account()
        val coffre = contact.openEmergency(
            donneur.publicKey(), donneur.sealUserKeyFor(contact.publicKey()),
        )
        val remise = RepriseDUrgence.depuisLeCoeur(coffre.takeover(email, kdf, "le nouveau"))

        // Ce que le serveur rangerait, rejoué ici : le compte se rouvre avec la nouvelle
        // clé utilisateur et le nouveau mot de passe.
        val repris = uniffi.ghost_crypto_ffi.Account.unlock(
            "le nouveau", email, kdf, remise.cleUtilisateur,
            enveloppeDuCompte["encrypted_private_key"]!!.jsonPrimitive.content,
        )
        val relu = json.parseToJsonElement(repris.decryptItem(enveloppe(element))).jsonObject
        assertEquals(
            "l'élément du donneur ne se relit pas après la reprise : le contenu du coffre " +
                "est perdu, et c'est précisément ce que la reprise devait sauver",
            "Banque",
            relu["name"]?.jsonPrimitive?.content,
        )
    }
}
