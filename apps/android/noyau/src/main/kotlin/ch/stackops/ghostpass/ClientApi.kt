package ch.stackops.ghostpass

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URLEncoder
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

/**
 * Ce que le serveur rend à la connexion, **et à l'échange SSO** : `docs/sso-mobile.md` dit
 * que les deux réponses ont exactement la même forme, « pour que le client n'ait qu'un seul
 * chemin de session à écrire ». On le prend au mot.
 *
 * `email` est **optionnel** parce que les deux routes ne s'accordent pas dessus : l'échange
 * SSO le rend, la connexion classique non — le client la connaît déjà, puisqu'il vient de
 * la saisir. Le déclarer obligatoire ferait échouer le décodage de toute connexion
 * ordinaire, c'est-à-dire tout le produit, pour un champ dont on n'a pas besoin là.
 */
@Serializable
data class ReponseDeConnexion(
    val token: String,
    val kdfParams: String,
    val encryptedUserKey: String,
    val encryptedPrivateKey: String,
    val email: String = "",
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

/**
 * Ce que le serveur rend à la création d'un partage.
 *
 * **Trois champs sur quatre sont optionnels, et ce n'est pas de la prudence** : deux
 * générations de serveur coexistent, et le client doit parler aux deux (§4).
 *
 *  - le serveur **à relais** rend `{ id, url, deleteToken, expiresAt }` : le partage vit
 *    chez ghostbit, et reconstruire l'adresse depuis l'identifiant produirait un lien vers
 *    une machine qui ne connaît pas ce partage — mort, et sans la moindre erreur ;
 *  - le serveur **antérieur** héberge les partages lui-même et ne rend que `{ id }` : là,
 *    déduire l'adresse de celle qu'on a saisie est la seule chose juste à faire.
 *
 * Se fier à `url` seule casserait le partage sur tous les serveurs pas encore basculés —
 * y compris celui de cette branche, qui ne rend que l'identifiant.
 */
@Serializable
data class PartageCree(
    val id: String,
    val url: String? = null,
    val deleteToken: String? = null,
    /** Secondes depuis l'epoch, comme le registre des partages. */
    val expiresAt: Long? = null,
)

/** Ce que rend `GET /api/auth/sso/status`. Un seul champ, et c'est voulu. */
@Serializable
private data class StatutSso(val enabled: Boolean = false)

@Serializable
private data class StatutDuSecondFacteur(val enabled: Boolean = false)

/** Un lien d'urgence, dans l'un ou l'autre sens. */
@Serializable
data class LienDUrgenceDto(
    val id: String = "",
    val contactEmail: String = "",
    val role: String = "view",
    val waitDays: Int = 0,
    val status: String = "invited",
    val requestedAt: Long? = null,
    /** Seulement dans le sens « je suis le contact » : le délai est-il écoulé. */
    val available: Boolean? = null,
)

@Serializable
data class LiensDUrgenceDto(
    val asGrantor: List<LienDUrgenceDto> = emptyList(),
    val asGrantee: List<LienDUrgenceDto> = emptyList(),
)

/** Ce que le serveur rend quand l'accès est ouvert : l'enveloppe, et le coffre du donneur. */
@Serializable
data class AccesDUrgenceDto(
    val role: String = "view",
    val sealedUserKey: String = "",
    val grantorPublicKey: String = "",
    val grantorEmail: String = "",
    val grantorKdfParams: String = "",
    val items: List<ElementChiffre> = emptyList(),
)

/** Ce que le serveur rend pour tenter une récupération — vrai kit, ou leurres. */
@Serializable
data class EnveloppesDeRecuperation(
    val kdfParams: String = "",
    val encryptedUserKeyRecovery: String = "",
    val encryptedPrivateKey: String = "",
)

/** Une connexion, telle que le serveur l'a enregistrée. */
@Serializable
data class ConnexionDto(
    val ip: String? = null,
    val userAgent: String? = null,
    /** Un appareil jamais vu jusque-là. C'est ce qui mérite un regard. */
    val newDevice: Boolean = false,
    val createdAt: Long = 0,
)

@Serializable
private data class EnveloppeDeConnexions(val events: List<ConnexionDto> = emptyList())

/** Une action sensible sur le compte. */
@Serializable
data class ActionDto(
    val action: String = "",
    val target: String? = null,
    val ip: String? = null,
    val createdAt: Long = 0,
)

@Serializable
private data class EnveloppeDActions(val events: List<ActionDto> = emptyList())

/**
 * Ce que le serveur rend pour configurer un second facteur : le secret, et l'URI que lit
 * une application d'authentification.
 */
@Serializable
data class ConfigurationDuSecondFacteur(
    val secret: String,
    val otpauthUri: String = "",
)

/**
 * Le jeton qui autorise les requêtes d'icônes, et sa date d'expiration.
 *
 * `expiresAt` est lu mais **ne sert à rien décider** : voir [ClientApi.jetonDIcone].
 */
@Serializable
data class JetonDIcone(val token: String = "", val expiresAt: Long = 0)

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

    /**
     * Une écriture a été demandée alors que le coffre est fermé.
     *
     * Distincte de [Reseau] : rien n'a été tenté, rien n'a échoué côté serveur. Les
     * confondre ferait afficher « serveur injoignable » à quelqu'un dont le serveur va
     * très bien et dont c'est le coffre qui est verrouillé.
     */
    class CoffreVerrouille : ErreurApi("Le coffre est verrouillé.")
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

    /**
     * Le jeton que l'URL d'icône accrochera, valable douze heures côté serveur.
     *
     * Il se redemande **à chaque rafraîchissement du coffre**, et non à sa seule
     * expiration : si l'exploitant n'a pas posé `ICON_TOKEN_SECRET`, le serveur tire sa clé
     * de signature *au démarrage*, et tous les jetons émis avant un redémarrage deviennent
     * invalides sans avoir expiré. Se fier à `expiresAt` laisserait alors les icônes muettes
     * jusqu'à douze heures, sans rien d'autre à l'écran qu'une liste d'initiales — le repli
     * normal, donc un symptôme qui ne se signale pas. Une requête par rafraîchissement est
     * un prix bien plus faible.
     */
    fun jetonDIcone(jeton: String): JetonDIcone =
        json.decodeFromString(
            JetonDIcone.serializer(),
            requete("GET", "/api/icons/token", jeton = jeton),
        )

    /** La liste des éléments chiffrés. Le serveur ne sait pas ce qu'ils contiennent. */
    fun elements(jeton: String): List<ElementChiffre> =
        json.decodeFromString(
            EnveloppeDElements.serializer(),
            requete("GET", "/api/vault/items", jeton = jeton),
        ).items

    /**
     * Crée un élément. Le serveur rend le `201` et l'élément tel qu'il l'a rangé.
     *
     * Le corps ne porte que les deux blobs : le serveur attribue l'identifiant lui-même
     * (`newId()`), et ne sait rien du contenu. Lui laisser choisir l'identité est ce qui
     * évite deux clients qui inventeraient la même.
     */
    fun creerUnElement(jeton: String, cle: String, donnees: String): ElementChiffre =
        json.decodeFromString(
            ElementChiffre.serializer(),
            requete(
                "POST", "/api/vault/items", jeton = jeton,
                corps = json.encodeToString(CHAMPS, mapOf(
                    "encryptedKey" to cle, "encryptedData" to donnees)),
            ),
        )

    /**
     * Remplace un élément existant. `PUT`, et non `PATCH` : le serveur remplace les deux
     * blobs d'un bloc. Il ne peut pas en modifier un seul — il ne sait pas ce qu'ils
     * contiennent.
     */
    fun remplacerUnElement(
        jeton: String,
        id: String,
        cle: String,
        donnees: String,
    ): ElementChiffre =
        json.decodeFromString(
            ElementChiffre.serializer(),
            requete(
                "PUT", "/api/vault/items/$id", jeton = jeton,
                corps = json.encodeToString(CHAMPS, mapOf(
                    "encryptedKey" to cle, "encryptedData" to donnees)),
            ),
        )

    /**
     * Met un élément à la corbeille. `DELETE` côté serveur est un effacement **doux** :
     * la ligne reçoit un `deletedAt` et sort de `/api/vault/items`, sans disparaître.
     *
     * Rend `204` sans corps, ce que [requete] traduit par une chaîne vide — on ne la lit
     * pas. Décoder une réponse vide en JSON lèverait, et ferait passer une suppression
     * réussie pour un échec.
     */
    fun mettreALaCorbeille(jeton: String, id: String) {
        requete("DELETE", "/api/vault/items/$id", jeton = jeton)
    }

    /**
     * Le serveur propose-t-il le SSO ?
     *
     * `GET /api/auth/sso/status` rend `{ "enabled": true|false }`, et **rien d'autre** : le
     * client ne fait aucune découverte OIDC. Une instance sans SSO répond `false` ; on ne
     * propose alors pas le bouton, plutôt que d'ouvrir un navigateur sur un `404`.
     */
    fun statutSso(): Boolean =
        json.decodeFromString(StatutSso.serializer(), requete("GET", "/api/auth/sso/status")).enabled

    /**
     * L'échange final du SSO mobile : `{ code, codeVerifier }` contre une session.
     *
     * La réponse a **exactement la forme du callback web** — c'est écrit dans
     * `docs/sso-mobile.md`, et c'est ce qui fait qu'il n'y a qu'un seul chemin de session à
     * écrire côté client. On réutilise donc [ReponseDeConnexion] telle quelle.
     *
     * Le `state` n'entre pas ici : le serveur le reprend de l'enregistrement du `start` et
     * ne le lit jamais depuis ce corps. C'est l'application qui doit l'avoir vérifié, et
     * elle seule peut le faire.
     */
    fun echangerLeCodeSso(code: String, verificateur: String): ReponseDeConnexion =
        json.decodeFromString(
            ReponseDeConnexion.serializer(),
            requete(
                "POST", "/api/auth/sso/exchange",
                corps = json.encodeToString(CHAMPS, mapOf(
                    "code" to code, "codeVerifier" to verificateur)),
            ),
        )

    // ─── Le second facteur du compte ───
    //
    // Il protège la **connexion au serveur**, pas le coffre : celui-ci reste chiffré par le
    // mot de passe maître, que le serveur ne connaît pas. Quelqu'un qui volerait le second
    // facteur n'obtiendrait que des enveloppes illisibles — mais il obtiendrait aussi la
    // possibilité de les **effacer**, ce qui suffit à justifier la protection.

    /**
     * Le second facteur est-il actif sur ce compte ?
     *
     * `null` n'existe pas ici : un serveur qui ne connaît pas la route lève
     * [ErreurApi.Http] avec un 404, et c'est à l'appelant de le distinguer d'une panne.
     * Rendre `false` serait un repli silencieux — l'écran proposerait d'activer une
     * fonction que ce serveur n'a pas, et l'échec arriverait à l'étape suivante.
     */
    fun secondFacteurActif(jeton: String): Boolean =
        json.decodeFromString(
            StatutDuSecondFacteur.serializer(),
            requete("GET", "/api/mfa", jeton = jeton),
        ).enabled

    /**
     * Prépare un second facteur, et **remet la configuration à zéro**.
     *
     * À n'appeler que lorsque le statut a répondu « inactif », sous peine de détruire un
     * secret en place : quelqu'un dont l'application d'authentification fonctionne se
     * retrouverait avec des codes refusés, sans rien avoir demandé.
     *
     * Le mot de passe maître ne traverse pas : c'est son empreinte d'authentification,
     * calculée par le cœur Rust, qui part.
     */
    fun preparerLeSecondFacteur(jeton: String, empreinteDuMotDePasse: String): ConfigurationDuSecondFacteur =
        json.decodeFromString(
            ConfigurationDuSecondFacteur.serializer(),
            requete(
                "POST", "/api/mfa/setup", jeton = jeton,
                corps = json.encodeToString(
                    CHAMPS, mapOf("masterPasswordHash" to empreinteDuMotDePasse),
                ),
            ),
        )

    /**
     * Confirme la configuration par un premier code.
     *
     * **Tant qu'elle n'est pas confirmée, le compte reste accessible sans second facteur.**
     * C'est ce qui évite de s'enfermer dehors avec une application d'authentification mal
     * configurée — l'horloge décalée d'une minute, le mauvais compte choisi.
     */
    fun confirmerLeSecondFacteur(jeton: String, code: String) {
        requete(
            "POST", "/api/mfa/activate", jeton = jeton,
            corps = json.encodeToString(CHAMPS, mapOf("code" to code)),
        )
    }

    /**
     * Retire le second facteur. **Les deux sont exigés** : le mot de passe maître et un code
     * valide. Un téléphone déverrouillé trouvé sur une table ne doit pas suffire à retirer
     * la protection.
     */
    fun retirerLeSecondFacteur(jeton: String, empreinteDuMotDePasse: String, code: String) {
        requete(
            "POST", "/api/mfa/disable", jeton = jeton,
            corps = json.encodeToString(
                CHAMPS, mapOf("masterPasswordHash" to empreinteDuMotDePasse, "code" to code),
            ),
        )
    }

    // ─── L'accès d'urgence ───
    //
    // **Le seul endroit du produit où une clé de coffre est scellée vers un tiers.** Tout
    // le reste est scellé pour soi-même ou pour une organisation dont on est membre ; ici,
    // on confie la lecture de son coffre à quelqu'un d'autre, sous condition de délai.
    //
    // Le serveur ne peut rien lire : il garde une enveloppe scellée vers la clé publique du
    // contact, qu'il ne sait pas ouvrir. Ce qu'il tient, c'est **le temps** — la demande, le
    // délai, l'approbation. C'est la seule part du protocole qu'il puisse arbitrer, et c'est
    // pourquoi le client ne décide jamais si l'accès est ouvert.

    fun inviterUnContactDUrgence(
        jeton: String,
        email: String,
        role: String,
        joursDAttente: Int,
        cleUtilisateurScellee: String,
    ) {
        requete(
            "POST", "/api/emergency", jeton = jeton,
            corps = json.encodeToString(
                JsonObject.serializer(),
                buildJsonObject {
                    put("email", email)
                    put("role", role)
                    put("waitDays", joursDAttente)
                    put("sealedUserKey", cleUtilisateurScellee)
                },
            ),
        )
    }

    fun liensDUrgence(jeton: String): LiensDUrgenceDto =
        json.decodeFromString(
            LiensDUrgenceDto.serializer(),
            requete("GET", "/api/emergency", jeton = jeton),
        )

    /**
     * `accept` et `request` appartiennent au contact, `approve` et `reject` au donneur.
     *
     * **Le serveur vérifie qui a le droit de quoi**, et le client ne fait que transmettre.
     * Reproduire la règle ici donnerait deux arbitres, et le jour où ils divergeraient,
     * c'est l'écran qui aurait tort en silence.
     */
    fun agirSurUnLienDUrgence(jeton: String, id: String, action: String) {
        requete("POST", "/api/emergency/$id/$action", jeton = jeton)
    }

    fun revoquerUnLienDUrgence(jeton: String, id: String) {
        requete("DELETE", "/api/emergency/$id", jeton = jeton)
    }

    /**
     * L'accès lui-même : l'enveloppe scellée et le coffre du donneur.
     *
     * Le serveur refuse par 403 tant que le délai court. **C'est lui qui tranche** : le
     * client affiche une date prévue, il ne s'en sert jamais pour décider.
     */
    fun accesDUrgence(jeton: String, id: String): AccesDUrgenceDto =
        json.decodeFromString(
            AccesDUrgenceDto.serializer(),
            requete("GET", "/api/emergency/$id/access", jeton = jeton),
        )

    fun reprendreLeCompte(
        jeton: String,
        id: String,
        nouvelleEmpreinteDuMotDePasse: String,
        nouvelleCleUtilisateur: String,
    ) {
        requete(
            "POST", "/api/emergency/$id/takeover", jeton = jeton,
            corps = json.encodeToString(
                CHAMPS,
                mapOf(
                    "newMasterPasswordHash" to nouvelleEmpreinteDuMotDePasse,
                    "newEncryptedUserKey" to nouvelleCleUtilisateur,
                ),
            ),
        )
    }

    // ─── La clé de récupération ───

    /** Enregistre le kit : la preuve re-hachée et la clé du coffre enveloppée pour lui. */
    fun enregistrerLaRecuperation(
        jeton: String,
        preuveDeRecuperation: String,
        cleUtilisateurPourRecuperation: String,
    ) {
        requete(
            "POST", "/api/account/recovery", jeton = jeton,
            corps = json.encodeToString(
                CHAMPS,
                mapOf(
                    "recoveryAuthHash" to preuveDeRecuperation,
                    "encryptedUserKeyRecovery" to cleUtilisateurPourRecuperation,
                ),
            ),
        )
    }

    /**
     * Les enveloppes nécessaires à une tentative de récupération.
     *
     * **Le serveur répond de la même façon pour un compte sans kit** — avec des leurres
     * déterministes — pour ne pas révéler quels comptes existent. Le client ne peut donc pas
     * distinguer « ce compte n'a pas de clé » de « cette clé est fausse », et c'est
     * délibéré : les distinguer à l'écran rendrait la protection inutile.
     */
    fun enveloppesDeRecuperation(email: String): EnveloppesDeRecuperation =
        json.decodeFromString(
            EnveloppesDeRecuperation.serializer(),
            requete(
                "POST", "/api/auth/recovery-blob",
                corps = json.encodeToString(CHAMPS, mapOf("email" to email)),
            ),
        )

    /**
     * Réinitialise le mot de passe maître.
     *
     * **Le serveur invalide toutes les sessions**, et c'est voulu : si quelqu'un vient de
     * réinitialiser le mot de passe, celles restées ouvertes ailleurs n'ont plus lieu d'être.
     */
    fun recuperer(
        email: String,
        preuveDeRecuperation: String,
        nouvelleEmpreinteDuMotDePasse: String,
        nouvelleCleUtilisateur: String,
    ) {
        requete(
            "POST", "/api/auth/recover",
            corps = json.encodeToString(
                CHAMPS,
                mapOf(
                    "email" to email,
                    "recoveryAuthHash" to preuveDeRecuperation,
                    "newMasterPasswordHash" to nouvelleEmpreinteDuMotDePasse,
                    "newEncryptedUserKey" to nouvelleCleUtilisateur,
                ),
            ),
        )
    }

    // ─── Le journal du compte ───

    /** Les connexions enregistrées : adresse, appareil, et si celui-ci était inconnu. */
    fun connexionsDuCompte(jeton: String): List<ConnexionDto> =
        json.decodeFromString(
            EnveloppeDeConnexions.serializer(),
            requete("GET", "/api/account/activity", jeton = jeton),
        ).events

    /**
     * Les actions sensibles : second facteur retiré, accès d'urgence accordé, clé d'équipe
     * renouvelée. **C'est là qu'un accès illégitime laisse une trace.**
     */
    fun actionsDuCompte(jeton: String): List<ActionDto> =
        json.decodeFromString(
            EnveloppeDActions.serializer(),
            requete("GET", "/api/account/audit", jeton = jeton),
        ).events

    // ─── Les coffres d'équipe ───

    /** Les organisations dont l'utilisateur est membre, invitations comprises. */
    fun organisations(jeton: String): List<OrganisationDto> =
        json.decodeFromString(
            EnveloppeDOrganisations.serializer(),
            requete("GET", "/api/orgs", jeton = jeton),
        ).organizations

    /** Le rôle, l'état, et l'Org Key scellée vers la clé publique de ce membre. */
    fun appartenance(jeton: String, org: String): AppartenanceDto =
        json.decodeFromString(
            AppartenanceDto.serializer(),
            requete("GET", "/api/orgs/$org/membership", jeton = jeton),
        )

    /**
     * Les collections auxquelles ce membre a droit.
     *
     * **Le serveur ne rend que celles-là** : la permission est tranchée là-bas, et
     * l'application ne fait qu'afficher ce qu'on lui donne. Filtrer une seconde fois ici
     * donnerait deux règles à tenir d'accord, dont une seule fait autorité.
     */
    fun collectionsDOrganisation(jeton: String, org: String): List<CollectionDto> =
        json.decodeFromString(
            EnveloppeDeCollections.serializer(),
            requete("GET", "/api/orgs/$org/collections", jeton = jeton),
        ).collections

    /** Les éléments d'une collection, chiffrés sous l'Org Key et non sous la clé du coffre. */
    fun elementsDeCollection(jeton: String, org: String, collection: String): List<ElementChiffre> =
        json.decodeFromString(
            EnveloppeDElements.serializer(),
            requete("GET", "/api/orgs/$org/collections/$collection/items", jeton = jeton),
        ).items

    /** Crée un élément dans une collection d'équipe. Le serveur exige la permission d'écriture. */
    fun creerUnElementDOrganisation(
        jeton: String,
        org: String,
        collection: String,
        cle: String,
        donnees: String,
    ): ElementChiffre =
        json.decodeFromString(
            ElementChiffre.serializer(),
            requete(
                "POST", "/api/orgs/$org/collections/$collection/items", jeton = jeton,
                corps = json.encodeToString(CHAMPS, mapOf(
                    "encryptedKey" to cle, "encryptedData" to donnees)),
            ),
        )

    /** Remplace un élément d'équipe. */
    fun remplacerUnElementDOrganisation(
        jeton: String,
        org: String,
        collection: String,
        id: String,
        cle: String,
        donnees: String,
    ): ElementChiffre =
        json.decodeFromString(
            ElementChiffre.serializer(),
            requete(
                "PUT", "/api/orgs/$org/collections/$collection/items/$id", jeton = jeton,
                corps = json.encodeToString(CHAMPS, mapOf(
                    "encryptedKey" to cle, "encryptedData" to donnees)),
            ),
        )

    /**
     * Supprime un élément d'équipe — **et c'est une destruction, pas une corbeille**.
     *
     * Le coffre personnel a un effacement doux : la ligne reçoit un `deletedAt` et se
     * retrouve dans `/api/vault/trash`. Les collections d'équipe n'en ont pas ; `orgItems.remove`
     * efface la ligne. Les deux verbes s'écrivent `DELETE` et ne font pas la même chose, et
     * l'écran doit le dire — proposer « Supprimer » ici avec la même phrase qu'ailleurs
     * ferait croire à un filet qui n'existe pas.
     */
    fun supprimerUnElementDOrganisation(
        jeton: String,
        org: String,
        collection: String,
        id: String,
    ) {
        requete("DELETE", "/api/orgs/$org/collections/$collection/items/$id", jeton = jeton)
    }

    // ─── L'administration d'organisation ───

    /**
     * La clé publique que le serveur **annonce** pour un email.
     *
     * Le nom de la méthode dit « annoncée » parce que c'est tout ce qu'on en sait : rien ne
     * l'authentifie. Voir [UtilisateurDto] pour ce que cela coûte.
     *
     * La route est fortement limitée en débit côté serveur (vingt par minute) — elle permet
     * d'énumérer des emails et de récolter des clés publiques.
     */
    fun clePubliqueAnnoncee(jeton: String, email: String): UtilisateurDto =
        json.decodeFromString(
            UtilisateurDto.serializer(),
            requete(
                "GET",
                "/api/users/lookup?email=" + URLEncoder.encode(email, "UTF-8"),
                jeton = jeton,
            ),
        )

    /** Les membres de l'organisation. Réservé à l'administrateur : un autre rôle reçoit 403. */
    fun membresDOrganisation(jeton: String, org: String): List<MembreDto> =
        json.decodeFromString(
            EnveloppeDeMembres.serializer(),
            requete("GET", "/api/orgs/$org/members", jeton = jeton),
        ).members

    /**
     * Invite un membre, avec l'Org Key **déjà scellée pour lui** par l'administrateur.
     *
     * Le serveur ne scelle rien et ne peut rien vérifier : il range un blob et un rôle. Ce
     * qui décide de la sécurité de cette route s'est joué avant l'appel, au moment de
     * choisir la clé publique vers laquelle sceller.
     */
    fun ajouterUnMembre(
        jeton: String,
        org: String,
        email: String,
        role: String,
        cleScellee: String,
    ) {
        requete(
            "POST", "/api/orgs/$org/members", jeton = jeton,
            corps = json.encodeToString(CHAMPS, mapOf(
                "email" to email, "role" to role, "encryptedOrgKey" to cleScellee)),
        )
    }

    /** Crée un groupe dans l'organisation, et rend son identifiant. */
    fun creerUnGroupe(jeton: String, org: String, nom: String): String =
        json.decodeFromString(
            GroupeDto.serializer(),
            requete(
                "POST", "/api/orgs/$org/groups", jeton = jeton,
                corps = json.encodeToString(CHAMPS, mapOf("name" to nom)),
            ),
        ).id

    /** Place un membre dans un groupe. */
    fun ajouterAuGroupe(jeton: String, org: String, groupe: String, utilisateur: String) {
        requete(
            "POST", "/api/orgs/$org/groups/$groupe/members", jeton = jeton,
            corps = json.encodeToString(CHAMPS, mapOf("userId" to utilisateur)),
        )
    }

    /**
     * Accorde à un groupe une permission sur une collection : `read`, `write` ou `manage`.
     *
     * C'est **la** route d'octroi que ce client peut atteindre. Celle qui change le rôle
     * d'un membre est un `PATCH`, et `HttpURLConnection` refuse ce verbe — voir
     * [Coffre.accorderSurUneCollection].
     */
    fun accorderAuGroupe(
        jeton: String,
        org: String,
        groupe: String,
        collection: String,
        permission: String,
    ) {
        requete(
            "POST", "/api/orgs/$org/groups/$groupe/collections/$collection", jeton = jeton,
            corps = json.encodeToString(CHAMPS, mapOf("permission" to permission)),
        )
    }

    /** Accepte une invitation. Le serveur rend `{ status: "active" }`, qu'on ne lit pas. */
    fun accepterLOrganisation(jeton: String, org: String) {
        requete("POST", "/api/orgs/$org/accept", jeton = jeton)
    }

    /**
     * Les éléments de la corbeille — ceux qu'un `DELETE` a marqués sans les détruire.
     *
     * Même forme que `/api/vault/items`, `deletedAt` en plus. C'est ce qui permet de les
     * relire avec le même code : la corbeille n'est pas un autre coffre, c'est le même,
     * filtré autrement.
     */
    fun elementsDeLaCorbeille(jeton: String): List<ElementChiffre> =
        json.decodeFromString(
            EnveloppeDElements.serializer(),
            requete("GET", "/api/vault/trash", jeton = jeton),
        ).items

    /** Sort un élément de la corbeille. Le serveur rend `{ ok: true }`, qu'on ne lit pas. */
    fun restaurerUnElement(jeton: String, id: String) {
        requete("POST", "/api/vault/trash/$id/restore", jeton = jeton)
    }

    /**
     * Détruit un élément pour de bon.
     *
     * Distinct de [mettreALaCorbeille], et le seul des deux qui soit irréversible. Les
     * confondre dans l'interface serait la faute la plus coûteuse du produit : personne ne
     * peut rendre un mot de passe que personne n'a plus.
     */
    fun purgerUnElement(jeton: String, id: String) {
        requete("DELETE", "/api/vault/trash/$id", jeton = jeton)
    }

    /**
     * Crée un partage de lien. Le serveur ne voit que du chiffré.
     *
     * `iv` est le nom que le serveur donne au **nonce** — celui de l'enveloppe de partage,
     * douze octets, et non les vingt-quatre du coffre (`contrat.json`, `share_envelope`).
     * Le nom vient d'une époque où le champ portait un vecteur d'initialisation ; le
     * renommer casserait les serveurs déjà déployés, alors on le traduit ici, une fois.
     */
    fun creerUnPartage(
        jeton: String,
        chiffre: String,
        nonce: String,
        heures: Int,
        consultations: Int,
    ): PartageCree =
        json.decodeFromString(
            PartageCree.serializer(),
            requete(
                "POST", "/api/send", jeton = jeton,
                corps = buildJsonObject {
                    put("ciphertext", chiffre)
                    put("iv", nonce)
                    put("expiresInHours", heures)
                    put("maxViews", consultations)
                }.toString(),
            ),
        )

    /**
     * Révoque un partage.
     *
     * **Le jeton voyage en en-tête, pas dans le chemin** : les chemins s'écrivent dans les
     * journaux des serveurs intermédiaires, les en-têtes beaucoup moins. C'est le choix
     * d'iOS et il n'y a aucune raison d'en changer.
     *
     * N'existe que sur les serveurs à relais. Un serveur antérieur n'a pas cette route et
     * répondra `404` — c'est pourquoi rien n'est écrit au registre des partages quand il ne
     * rend pas de jeton : une ligne qu'on ne peut pas révoquer y serait un vœu.
     */
    fun revoquerUnPartage(jeton: String, id: String, jetonDeSuppression: String) {
        requete(
            "DELETE", "/api/send/$id", jeton = jeton,
            entetes = mapOf("x-delete-token" to jetonDeSuppression),
        )
    }

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
        entetes: Map<String, String> = emptyMap(),
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
            // ─── Un corps JSON explicite, même quand la route n'en veut pas ───
            //
            // **Mesuré, et invisible depuis iOS.** La pile HTTP d'Android ajoute d'elle-même
            // `Content-Type: application/x-www-form-urlencoded` aux méthodes qui *peuvent*
            // porter un corps — POST, PUT, DELETE — même lorsqu'on ne lui en donne aucun.
            // Fastify voit alors un type qu'il ne sait pas analyser et répond
            // **415 « Unsupported Media Type »**, sans jamais atteindre la route.
            //
            // Le symptôme était parfait : la suppression d'un élément ne faisait rien,
            // l'écran restait ouvert, et le serveur n'avait aucune trace d'une suppression.
            // On cherche alors du côté du coffre, des permissions, du jeton. Le message
            // « Unsupported Media Type » n'apparaissait qu'en bas d'un écran, sous les
            // champs. `URLSession` côté iOS n'ajoute rien, donc rien de tout cela n'existait
            // là-bas — la classe de défaut « une divergence entre clients ne produit aucune
            // erreur », vue depuis le client qui la subit.
            //
            // On ne peut pas *retirer* un en-tête posé par la pile ; on peut l'écraser. Un
            // `{}` explicite est donc envoyé quand la route n'attend rien : Fastify l'analyse
            // sans broncher, et les routes concernées ignorent leur corps.
            //
            // Un corps **vide** avec `application/json` ne marcherait pas non plus : Fastify
            // rend « Body cannot be empty when content-type is set to 'application/json' ».
            // Les trois cas ont été mesurés contre le serveur, pas déduits.
            val charge = corps ?: if (methode == "GET" || methode == "HEAD") null else "{}"
            if (charge != null) {
                connexion.setRequestProperty("Content-Type", "application/json")
                connexion.doOutput = true
            }
            if (jeton != null) {
                connexion.setRequestProperty("Authorization", "Bearer $jeton")
            }
            for ((nom, valeur) in entetes) connexion.setRequestProperty(nom, valeur)
            if (charge != null) {
                connexion.outputStream.use { it.write(charge.toByteArray(Charsets.UTF_8)) }
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
