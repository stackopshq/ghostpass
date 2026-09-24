package ch.stackops.ghostpass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.register

/**
 * L'enveloppe d'appareil d'`docs/adr/0002`, **côté cœur**.
 *
 * L'ADR décide qu'on persiste la clé du coffre enveloppée par une clé de l'`AndroidKeyStore`.
 * Cela fait deux moitiés, et elles ne s'éprouvent pas au même endroit :
 *
 *  - **ici**, la moitié cryptographique : la clé du coffre s'enveloppe sous un secret, et se
 *    rouvre sous ce secret et pas un autre. Elle ne demande aucune API Android, donc elle
 *    tourne sur la JVM du poste, en une seconde, sans émulateur ;
 *  - **là-bas** (`CleDEnveloppeTest`, instrumenté), la moitié plateforme : les trois réglages
 *    du KeyStore, dont celui dont l'oubli ne se voit jamais.
 *
 * Les séparer est ce qui rend la première éprouvable du tout. Une seule suite instrumentée
 * n'aurait tourné que sur appareil, c'est-à-dire en pratique rarement.
 *
 * **Rien n'est réécrit en Kotlin.** L'enveloppe est `wrap_user_key_for_passkey` du cœur Rust,
 * et son ouverture `unlock_with_passkey` — les mêmes que le déverrouillage par passkey du
 * web. Le seul écart est la provenance du secret : une passkey là-bas, le KeyStore ici. Le
 * cœur ne fait pas la différence, et c'est ce qui évite un second format d'enveloppe.
 */
class EnveloppeDuCoffreTest {

    /** Un secret d'enveloppe de la forme que le cœur attend : 32 octets en base64. */
    private val secret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
    private val autreSecret = "/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v4="

    /**
     * Le coffre se rouvre sans mot de passe maître, et rend **les mêmes** éléments.
     *
     * Ce qui se joue : le service de remplissage est lié par le système alors que l'interface
     * n'a jamais été ouverte. S'il ne peut pas rouvrir le coffre, la fonction principale du
     * produit ne marche pas — et si l'enveloppe rendait une clé *différente*, il rouvrirait
     * un coffre où plus rien ne se déchiffre, ce qui est pire qu'une fonction absente.
     */
    @Test
    fun laCleEnveloppeeRouvreLeMemeCoffre() {
        val inscription = register("correct horse battery staple", "clara@ghostpass.test")
        val compte = inscription.account()
        val clePriveeChiffree = clePrivee(inscription.blob())

        // Un élément scellé par le compte d'origine.
        val scelle = compte.encryptItem(itemJson("Forgejo"))

        val enveloppe = compte.wrapUserKeyForPasskey(secret)
        // Le compte d'origine disparaît : ce qui suit ne peut plus s'appuyer sur lui.
        compte.close()

        val rouvert = Account.withPasskey(secret, enveloppe, clePriveeChiffree)
        assertTrue(
            "l'élément scellé avant l'enveloppe doit se rouvrir après elle",
            rouvert.decryptItem(scelle).contains("Forgejo"),
        )
        rouvert.close()
    }

    /**
     * Un autre secret n'ouvre rien — et c'est **le** point de sécurité de l'ADR.
     *
     * Sans cette moitié, le test précédent passerait aussi bien sur une enveloppe qui
     * ignorerait son secret. Le témoin porte donc sur le cas où les deux branches
     * divergent, pas sur le cas le plus représentatif.
     */
    @Test
    fun unAutreSecretNOuvreRien() {
        val inscription = register("correct horse battery staple", "clara@ghostpass.test")
        val compte = inscription.account()
        val clePriveeChiffree = clePrivee(inscription.blob())
        val enveloppe = compte.wrapUserKeyForPasskey(secret)
        compte.close()

        assertNotEquals("les deux secrets d'essai doivent différer", secret, autreSecret)

        var refuse = false
        try {
            Account.withPasskey(autreSecret, enveloppe, clePriveeChiffree).close()
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue("l'enveloppe ne doit s'ouvrir que sous son propre secret", refuse)
    }

    /**
     * Deux secrets différents donnent deux enveloppes différentes.
     *
     * Le contrôle du contrôle : si `wrapUserKeyForPasskey` ignorait son argument, le test
     * ci-dessus tomberait pour une raison qui n'est pas celle qu'on croit, et celui-ci le
     * dirait. C'est le piège du témoin dont les deux branches produisent la même sortie.
     */
    @Test
    fun leSecretEstBienCeQuiEnveloppe() {
        val compte = register("correct horse battery staple", "clara@ghostpass.test").account()
        assertNotEquals(
            "l'enveloppe doit dépendre du secret, sinon le refus mesuré plus haut ne prouve rien",
            compte.wrapUserKeyForPasskey(secret),
            compte.wrapUserKeyForPasskey(autreSecret),
        )
        compte.close()
    }

    /**
     * L'enveloppe d'un compte n'ouvre pas le coffre d'un autre.
     *
     * Cas voisin du précédent et distinct : ici le secret est **le bon**, et c'est la clé
     * privée présentée qui vient d'ailleurs. Le cœur doit refuser plutôt que de rendre un
     * compte à moitié cohérent.
     */
    @Test
    fun uneEnveloppeNeSePorteQuAvecSaPropreClePrivee() {
        val moi = register("correct horse battery staple", "clara@ghostpass.test")
        val quelquUnDAutre = register("correct horse battery staple", "kevin@ghostpass.test")
        val enveloppe = moi.account().wrapUserKeyForPasskey(secret)

        var refuse = false
        try {
            Account.withPasskey(secret, enveloppe, clePrivee(quelquUnDAutre.blob())).close()
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue("la clé privée d'un autre compte ne doit pas porter cette enveloppe", refuse)
    }

    /**
     * Une enveloppe altérée d'un seul caractère est refusée.
     *
     * Elle vit dans `filesDir`, privé à l'application — mais « privé » n'est pas
     * « inaltérable » sur un appareil dont le propriétaire a les droits d'administration.
     * Le refus doit venir du sceau, pas de notre confiance dans le système de fichiers.
     */
    @Test
    fun uneEnveloppeAltereeEstRefusee() {
        val inscription = register("correct horse battery staple", "clara@ghostpass.test")
        val enveloppe = inscription.account().wrapUserKeyForPasskey(secret)

        // On perturbe **là où le consommateur lit** : le dernier caractère de la charge,
        // pas un octet ajouté à la fin d'un conteneur qui ne le lirait pas.
        val dernier = enveloppe.last()
        val remplacant = if (dernier == 'A') 'B' else 'A'
        val altere = enveloppe.dropLast(1) + remplacant
        assertNotEquals(enveloppe, altere)

        var refuse = false
        try {
            Account.withPasskey(secret, altere, clePrivee(inscription.blob())).close()
        } catch (_: Exception) {
            refuse = true
        }
        assertTrue("une enveloppe altérée doit être refusée", refuse)
    }

    // ─── Outillage ───

    /**
     * La clé privée chiffrée, telle qu'elle sort du blob d'inscription.
     *
     * En snake_case : le blob vient de `serde`, pas de l'API. C'est le même écart que
     * `SemerLeServeur` documente, et il se paie ici aussi.
     */
    private fun clePrivee(blob: String): String {
        val objet = kotlinx.serialization.json.Json
            .parseToJsonElement(blob) as kotlinx.serialization.json.JsonObject
        val valeur = objet["encrypted_private_key"] ?: objet["encryptedPrivateKey"]
        assertTrue(
            "le blob d'inscription doit porter la clé privée chiffrée — reçu ${objet.keys}",
            valeur != null,
        )
        return (valeur as kotlinx.serialization.json.JsonPrimitive).content
    }

    private fun itemJson(nom: String): String = """
        {"name":"$nom","notes":null,"folder":null,
         "data":{"kind":"Login","data":{"username":"clara","password":"s3cret",
                 "uris":["https://git.stackops.ch"],"totp":null,"password_history":[]}}}
    """.trimIndent()
}
