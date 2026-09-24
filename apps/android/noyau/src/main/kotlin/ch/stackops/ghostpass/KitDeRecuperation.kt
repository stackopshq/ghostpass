package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Les noms de champs du cœur Rust, **lus à un seul endroit**.
 *
 * `Account.createRecovery()` et `RecoveryResult.reset()` rendent du JSON dont les noms sont
 * ceux de **serde** : `recovery_key`, `recovery_auth_hash`, `encrypted_user_key_recovery`,
 * `master_password_hash`, `encrypted_user_key`. Les écrire en camelCase par habitude ne
 * casserait **aucune compilation** — la lecture rendrait `null`, le client enverrait des
 * chaînes vides, et le serveur enregistrerait sans broncher un kit inutilisable.
 *
 * Le défaut ne se manifesterait qu'une seule fois, chez quelqu'un qui a oublié son mot de
 * passe maître et pour qui cette clé était la dernière issue. C'est la pire fréquence
 * possible : jamais pendant le développement, une fois chez l'utilisateur, sans recours.
 *
 * **Ces classes existent pour que le témoin traverse le même code que le produit.** Le
 * premier jet lisait ces noms directement dans `Coffre`, et `CleDeRecuperationTest` les
 * relisait de son côté : deux copies des mêmes cinq chaînes, dont l'une aurait fini par
 * dériver — et le témoin serait resté vert en mesurant sa propre copie.
 *
 * Un champ vide est traité comme un champ absent. Le serveur accepte les deux sans broncher,
 * et une chaîne vide enregistrée comme preuve rendrait la clé définitivement inutilisable.
 */
data class KitDeRecuperation(
    /** La clé à montrer une fois, et qui ne s'écrit nulle part. */
    val cle: String,
    /** Ce que le serveur garde pour reconnaître la clé sans la connaître. */
    val preuve: String,
    /** La clé du coffre, enveloppée pour la clé de récupération. */
    val cleUtilisateurEnveloppee: String,
) {
    companion object {
        fun depuisLeCoeur(json: String): KitDeRecuperation {
            val objet = Json.parseToJsonElement(json).jsonObject
            return KitDeRecuperation(
                cle = champ(objet, "recovery_key"),
                preuve = champ(objet, "recovery_auth_hash"),
                cleUtilisateurEnveloppee = champ(objet, "encrypted_user_key_recovery"),
            )
        }
    }
}

/** Ce que `RecoveryResult.reset()` rend, à transmettre tel quel au serveur. */
data class RemiseDeRecuperation(
    val empreinteDuMotDePasse: String,
    val preuve: String,
    val cleUtilisateur: String,
) {
    companion object {
        fun depuisLeCoeur(json: String): RemiseDeRecuperation {
            val objet = Json.parseToJsonElement(json).jsonObject
            return RemiseDeRecuperation(
                empreinteDuMotDePasse = champ(objet, "master_password_hash"),
                preuve = champ(objet, "recovery_auth_hash"),
                cleUtilisateur = champ(objet, "encrypted_user_key"),
            )
        }
    }
}

private fun champ(objet: kotlinx.serialization.json.JsonObject, nom: String): String =
    objet[nom]?.jsonPrimitive?.content?.takeIf { it.isNotEmpty() }
        ?: throw ErreurApi.ReponseIllisible()

/**
 * Ce que `EmergencyVault.takeover()` rend, à transmettre tel quel au serveur.
 *
 * Mêmes noms de serde, même raison d'exister que les deux classes ci-dessus :
 * `master_password_hash` et `encrypted_user_key`. Et le même coût si l'un d'eux se perd — un
 * compte dont le mot de passe ne marche plus, chez quelqu'un qui, par hypothèse, n'est pas
 * là pour le signaler.
 */
data class RepriseDUrgence(
    val empreinteDuMotDePasse: String,
    val cleUtilisateur: String,
) {
    companion object {
        fun depuisLeCoeur(json: String): RepriseDUrgence {
            val objet = Json.parseToJsonElement(json).jsonObject
            return RepriseDUrgence(
                empreinteDuMotDePasse = champ(objet, "master_password_hash"),
                cleUtilisateur = champ(objet, "encrypted_user_key"),
            )
        }
    }
}
