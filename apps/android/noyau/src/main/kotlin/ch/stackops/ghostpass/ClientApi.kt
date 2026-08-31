package ch.stackops.ghostpass

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Ce que le serveur rend au pré-login. `kdfParams` est une **chaîne contenant du JSON**,
 * jamais un objet JSON : le serveur stocke la colonne en TEXT et la renvoie verbatim.
 *
 * La décoder puis la ré-encoder produirait une chaîne doublement échappée que `serde`
 * rejette côté cœur, et *toute* connexion échouerait. C'est écrit dans le test de contrat
 * (`lesParametresKdfDuServeurSontAcceptesParLeCoeur`) et dans le client iOS aux mêmes
 * mots. On la transporte donc telle quelle, du serveur au cœur, sans jamais la relire.
 */
@Serializable
data class ReponseDePrelogin(val kdfParams: String)

/** Ce que le serveur rend à la connexion. Les quatre champs, aux noms exacts du serveur. */
@Serializable
data class ReponseDeConnexion(
    val token: String,
    val kdfParams: String,
    val encryptedUserKey: String,
    val encryptedPrivateKey: String,
)

/**
 * Un élément chiffré, tel qu'il arrive du serveur.
 *
 * **camelCase et à plat.** Le cœur, lui, attend `{"encrypted_key":…,"encrypted_data":…}`
 * en snake_case et sans identifiant. La conversion tient en un seul endroit — [Coffre.ouvrir]
 * — précisément pour qu'elle ne se fasse pas deux fois différemment.
 *
 * `updatedAt` et `deletedAt` sont des **millisecondes** depuis l'epoch : les colonnes sont
 * des `INTEGER` et le serveur les expose tels quels. Les attendre en `String` faisait
 * échouer le décodage de la liste entière côté iOS — donc du coffre entier. Elles sont
 * aussi optionnelles : un serveur plus ancien peut ne pas les rendre.
 *
 * Attention à l'unité : le registre des partages, lui, compte en **secondes**
 * (voir [PartageEnCours]). Les deux cohabitent.
 */
@Serializable
data class ElementChiffre(
    val id: String,
    val encryptedKey: String,
    val encryptedData: String,
    val updatedAt: Long? = null,
    val deletedAt: Long? = null,
)

@Serializable
private data class EnveloppeDElements(val items: List<ElementChiffre>)

/** Le corps d'erreur du serveur, y compris le signal de second facteur. */
@Serializable
private data class ErreurServeur(
    val error: String? = null,
    val mfaRequired: Boolean? = null,
    val mfaType: String? = null,
)

/** Ce qui peut mal tourner en parlant au serveur. */
sealed class ErreurApi(message: String) : Exception(message) {
    class AdresseInvalide : ErreurApi("Adresse de serveur invalide.")
    class Reseau(cause: String) : ErreurApi(cause)
    class ReponseIllisible : ErreurApi("Réponse du serveur illisible.")
    class Http(val statut: Int, message: String) : ErreurApi(message)

    /**
     * Le serveur réclame un second facteur. C'est un **401 porteur d'un corps JSON**, pas
     * un 200 : le chemin d'erreur doit lire le corps avant de lever, sinon le signal se
     * perd et l'utilisateur voit « identifiants invalides » alors que son mot de passe
     * était bon.
     */
    class SecondFacteurRequis(val genre: String) : ErreurApi("Second facteur requis.")
}

/**
 * Le client HTTP du serveur GhostPass.
 *
 * `HttpURLConnection` plutôt qu'une bibliothèque : il existe sur la JVM du poste comme sur
 * Android, ce qui rend ce client — et donc la forme des requêtes — éprouvable sans
 * émulateur, contre un vrai serveur local. Une dépendance qui n'existerait que sur Android
 * repousserait cette vérification à l'appareil, c'est-à-dire en pratique à jamais.
 *
 * **Aucun point de terminaison de l'éditeur n'est en dur ici** (§7). L'adresse vient
 * entièrement de ce que l'utilisateur a saisi.
 */
class ClientApi(baseUrl: String) {

    /**
     * L'adresse normalisée, sans barre finale. Les chemins s'y concatènent avec un `/`
     * explicite.
     *
     * iOS résout ses chemins avec `URL(string:relativeTo:)`, qui les interprète comme
     * *relatifs au répertoire* de la base : sur une base portant un chemin, le dernier
     * segment serait remplacé plutôt que conservé. La concaténation est plus bête et fait
     * ce qu'on attend d'elle, y compris pour un serveur monté sous un sous-chemin.
     */
    private val base: String = baseUrl.removeSuffix("/")

    private val json = Json { ignoreUnknownKeys = true }

    private companion object {
        /** Les corps de requête de l'authentification sont de simples objets de chaînes. */
        val CHAMPS = MapSerializer(String.serializer(), String.serializer())
    }

    /** Pré-login : rend les paramètres KDF. Un email inconnu rend les paramètres par défaut. */
    fun prelogin(email: String): ReponseDePrelogin =
        json.decodeFromString(
            ReponseDePrelogin.serializer(),
            requete(
                "POST", "/api/auth/prelogin",
                corps = json.encodeToString(CHAMPS, mapOf("email" to email)),
            ),
        )

    /**
     * Connexion. `codeTotp` n'est envoyé que s'il est non vide : le serveur ne réclame le
     * second facteur qu'après validation du mot de passe.
     */
    fun connexion(
        email: String,
        empreinteDuMotDePasseMaitre: String,
        codeTotp: String?,
    ): ReponseDeConnexion {
        val charge = buildMap {
            put("email", email)
            put("masterPasswordHash", empreinteDuMotDePasseMaitre)
            if (!codeTotp.isNullOrEmpty()) put("totpCode", codeTotp)
        }
        return json.decodeFromString(
            ReponseDeConnexion.serializer(),
            requete("POST", "/api/auth/login", corps = json.encodeToString(CHAMPS, charge)),
        )
    }

    /** La liste des éléments chiffrés. Le serveur ne sait pas ce qu'ils contiennent. */
    fun elements(jeton: String): List<ElementChiffre> =
        json.decodeFromString(
            EnveloppeDElements.serializer(),
            requete("GET", "/api/vault/items", jeton = jeton),
        ).items

    /** Déconnexion : révoque la session côté serveur. Sans corps. */
    fun deconnexion(jeton: String) {
        try {
            requete("POST", "/api/auth/logout", jeton = jeton)
        } catch (_: ErreurApi) {
            // Une déconnexion qui échoue ne doit pas retenir l'utilisateur sur son coffre
            // ouvert : le client oublie ses clés dans tous les cas. Le jeton expirera.
        }
    }

    private fun requete(
        methode: String,
        chemin: String,
        jeton: String? = null,
        corps: String? = null,
    ): String {
        val url = try {
            URL(base + chemin)
        } catch (_: Exception) {
            throw ErreurApi.AdresseInvalide()
        }
        val connexion = try {
            url.openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw ErreurApi.Reseau(e.message ?: "Connexion impossible.")
        }
        try {
            connexion.requestMethod = methode
            connexion.connectTimeout = 15_000
            connexion.readTimeout = 30_000
            // `Content-Type` seulement s'il y a un corps : plusieurs routes du serveur
            // n'en prennent aucun, et l'annoncer quand même est au mieux du bruit.
            if (corps != null) {
                connexion.setRequestProperty("Content-Type", "application/json")
                connexion.doOutput = true
            }
            if (jeton != null) {
                connexion.setRequestProperty("Authorization", "Bearer $jeton")
            }
            if (corps != null) {
                connexion.outputStream.use { it.write(corps.toByteArray(Charsets.UTF_8)) }
            }

            val statut = connexion.responseCode
            val flux = if (statut in 200..299) connexion.inputStream else connexion.errorStream
            val texte = flux?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

            if (statut !in 200..299) {
                // Lire le corps **avant** de lever : c'est là que vit `mfaRequired`.
                val erreur = try {
                    json.decodeFromString(ErreurServeur.serializer(), texte)
                } catch (_: Exception) {
                    null
                }
                if (erreur?.mfaRequired == true) {
                    throw ErreurApi.SecondFacteurRequis(erreur.mfaType ?: "totp")
                }
                throw ErreurApi.Http(statut, erreur?.error ?: "Erreur serveur ($statut).")
            }
            return texte
        } catch (e: ErreurApi) {
            throw e
        } catch (e: IOException) {
            throw ErreurApi.Reseau(e.message ?: "Connexion impossible.")
        } finally {
            connexion.disconnect()
        }
    }
}
