package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.recover
import uniffi.ghost_crypto_ffi.register

/**
 * La clé de récupération, éprouvée **jusqu'au déchiffrement**, sans serveur.
 *
 * Le tour entier passe par le cœur Rust : créer un compte, y sceller un élément, fabriquer
 * un kit de récupération, puis rouvrir le coffre avec la seule clé et un mot de passe tout
 * neuf. Si l'élément se relit à la fin, c'est que la chaîne entière tient.
 *
 * ## Pourquoi ce témoin existe, et pourquoi il vaut plus qu'un test d'écran
 *
 * `Account.createRecovery()` rend du JSON dont les noms de champs sont ceux de **serde**,
 * côté Rust : `recovery_key`, `recovery_auth_hash`, `encrypted_user_key_recovery`. Les
 * écrire en camelCase par habitude ne casserait **aucune compilation** — la lecture rendrait
 * `null`, le client enverrait des chaînes vides, et le serveur enregistrerait sans broncher
 * un kit inutilisable.
 *
 * Le défaut ne se manifesterait alors qu'une seule fois, chez quelqu'un qui a oublié son mot
 * de passe maître, et pour qui cette clé était la dernière issue. C'est la pire fréquence
 * possible : jamais pendant le développement, une fois chez l'utilisateur, et sans recours.
 */
class CleDeRecuperationTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun elementJson(nom: String) = buildJsonObject {
        put("name", nom)
        put("notes", null as String?)
        put("folder", null as String?)
        put("data", buildJsonObject {
            put("kind", "Login")
            put("data", buildJsonObject {
                put("username", "clara")
                put("password", "tr0ubad0ur")
                put("uris", kotlinx.serialization.json.buildJsonArray { })
                put("totp", null as String?)
            })
        })
    }

    /**
     * **Le tour complet.** C'est le seul témoin qui dise que la récupération récupère
     * vraiment quelque chose.
     */
    @Test
    fun uneCleDeRecuperationRouvreLeCoffreAvecUnNouveauMotDePasse() {
        val email = "clara@ghostpass.test"
        val inscription = register("correct horse battery staple", email)
        val compte = inscription.account()
        val enveloppeDuCompte = json.parseToJsonElement(inscription.blob()).jsonObject

        // Un élément scellé par le compte d'origine. C'est lui qu'on devra relire à la fin.
        val scelle = compte.encryptItem(elementJson("Forgejo").toString())

        // ─── Le kit ───
        //
        // **Par `KitDeRecuperation`, c'est-à-dire par le code du produit.** Le premier jet
        // relisait les noms de serde ici, de son côté : deux copies des mêmes chaînes, et
        // un témoin qui serait resté vert en mesurant sa propre copie pendant que celle du
        // produit dérivait. `depuisLeCoeur` lève sur un champ absent **ou vide**, et c'est
        // cette levée qui tient les cinq noms.
        val kit = KitDeRecuperation.depuisLeCoeur(compte.createRecovery())
        val cle = kit.cle
        val preuve = kit.preuve
        val enveloppePourLaCle = kit.cleUtilisateurEnveloppee
        assertTrue("la clé de récupération est vide", cle.isNotEmpty())

        // ─── La récupération, avec un mot de passe tout neuf ───
        val resultat = recover(
            cle,
            email,
            "un tout autre mot de passe",
            // **`kdf_params` est un objet JSON dans l'enveloppe, et une chaîne pour le
            // cœur.** Le serveur le range en colonne TEXT et le rend verbatim ; c'est cette
            // forme-là que `recover` attend. La confusion est celle que `CoeurTest`
            // documente déjà dans l'autre sens, et elle ne lève pas d'erreur de type : ici
            // elle a fait tomber le témoin sur « is not a JsonPrimitive », ce qui est au
            // moins bruyant. En production, une chaîne doublement échappée passerait la
            // frontière et serde la refuserait à l'autre bout.
            enveloppeDuCompte["kdf_params"]!!.toString(),
            enveloppePourLaCle,
            enveloppeDuCompte["encrypted_private_key"]!!.jsonPrimitive.content,
        )

        // Le coffre se relit : c'est **la** chose à prouver.
        val relu = json.parseToJsonElement(
            resultat.account().decryptItem(scelle),
        ).jsonObject
        assertEquals(
            "l'élément scellé avant la récupération ne se relit pas après : la clé du " +
                "coffre n'a pas traversé, et le contenu est perdu",
            "Forgejo",
            relu["name"]?.jsonPrimitive?.content,
        )

        // ─── Et la remise, celle qui part au serveur ───
        //
        // `depuisLeCoeur` lève si l'un des trois champs manque ou est vide : le serveur,
        // lui, accepterait des chaînes vides sans broncher et laisserait un compte dont le
        // mot de passe ne marche plus.
        val remise = RemiseDeRecuperation.depuisLeCoeur(resultat.reset())

        // La preuve envoyée au serveur est **la même** que celle enregistrée : c'est elle
        // qui autorise la réinitialisation, et deux valeurs différentes feraient refuser
        // une clé parfaitement valable.
        assertEquals(
            "la preuve de la remise diffère de celle du kit : le serveur refuserait une " +
                "clé de récupération correcte",
            preuve,
            remise.preuve,
        )
    }

    /**
     * Une mauvaise clé est refusée — et **le témoin du témoin**.
     *
     * Sans lui, celui d'au-dessus passerait aussi avec un `recover` qui accepterait
     * n'importe quoi : il prouverait que la bonne clé marche, jamais que la mauvaise échoue.
     */
    @Test
    fun uneMauvaiseCleEstRefusee() {
        val email = "clara@ghostpass.test"
        val inscription = register("correct horse battery staple", email)
        val enveloppe = json.parseToJsonElement(inscription.blob()).jsonObject
        val kit = KitDeRecuperation.depuisLeCoeur(inscription.account().createRecovery())

        var refuse = false
        try {
            recover(
                "une clé inventée de toutes pièces",
                email,
                "un nouveau mot de passe",
                enveloppe["kdf_params"]!!.toString(),
                kit.cleUtilisateurEnveloppee,
                enveloppe["encrypted_private_key"]!!.jsonPrimitive.content,
            )
        } catch (_: GhostCryptoException) {
            refuse = true
        }
        assertTrue(
            "une clé de récupération inventée a été acceptée : n'importe qui pourrait " +
                "réinitialiser n'importe quel compte",
            refuse,
        )
    }

    /**
     * **Un champ vide est un champ absent**, et ce témoin a été ajouté après coup.
     *
     * La garde qui refuse une chaîne vide ne tombait sous aucun témoin : le cœur ne rend
     * jamais de champ vide, si bien que la retirer laissait tout au vert. C'était une garde
     * que personne ne mesurait — donc une garde dont on ne saurait pas qu'elle a disparu.
     *
     * Elle compte pourtant : le serveur accepte sans broncher une preuve vide, et la clé de
     * récupération enregistrée avec deviendrait définitivement inutilisable. On éprouve donc
     * la garde sur du JSON écrit à la main, seul moyen de produire le cas qu'elle protège.
     */
    @Test
    fun unChampVideEstRefuseCommeUnChampAbsent() {
        fun kit(cle: String, preuve: String, enveloppe: String) =
            """{"recovery_key":"$cle","recovery_auth_hash":"$preuve",""" +
                """"encrypted_user_key_recovery":"$enveloppe"}"""

        // Le contrôle du contrôle : le cas complet passe. Sans lui, un `depuisLeCoeur` qui
        // lèverait toujours ferait passer tout le reste de ce témoin.
        assertEquals("K", KitDeRecuperation.depuisLeCoeur(kit("K", "P", "E")).cle)

        val abimes = listOf(
            "clé" to kit("", "P", "E"),
            "preuve" to kit("K", "", "E"),
            "enveloppe" to kit("K", "P", ""),
        )
        for ((quoi, json) in abimes) {
            var refuse = false
            try {
                KitDeRecuperation.depuisLeCoeur(json)
            } catch (_: ErreurApi.ReponseIllisible) {
                refuse = true
            }
            assertTrue(
                "une $quoi vide est acceptée : le serveur l'enregistrerait telle quelle, et " +
                    "la clé de récupération serait définitivement inutilisable",
                refuse,
            )
        }

        // Et la remise, de même.
        var refuse = false
        try {
            RemiseDeRecuperation.depuisLeCoeur(
                """{"master_password_hash":"","recovery_auth_hash":"P","encrypted_user_key":"E"}""",
            )
        } catch (_: ErreurApi.ReponseIllisible) {
            refuse = true
        }
        assertTrue(
            "une empreinte de mot de passe vide est acceptée : le compte se retrouverait " +
                "avec un mot de passe que personne ne peut plus fournir",
            refuse,
        )
    }

    /**
     * Deux kits successifs donnent deux clés différentes.
     *
     * Un générateur qui se répéterait rendrait la clé devinable à partir d'un autre compte.
     */
    @Test
    fun deuxKitsDonnentDeuxClesDistinctes() {
        val compte: () -> Account = { register("correct horse battery staple", "a@b.c").account() }
        val premiere = KitDeRecuperation.depuisLeCoeur(compte().createRecovery()).cle
        val seconde = KitDeRecuperation.depuisLeCoeur(compte().createRecovery()).cle
        assertTrue("deux clés de récupération identiques", premiere != seconde)
    }
}
