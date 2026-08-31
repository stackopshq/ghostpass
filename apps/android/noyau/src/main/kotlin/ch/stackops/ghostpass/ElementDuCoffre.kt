package ch.stackops.ghostpass

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Un élément de coffre en clair, tel que le cœur Rust le sérialise.
 *
 * Les noms de champs sont ceux de serde et **ne se traduisent pas** : `password_history`,
 * `exp_month`, `exp_year`. Un champ renommé ici ne casse aucune compilation — il rend
 * simplement le champ vide chez le lecteur suivant, sans un mot. C'est pour cette classe
 * d'écarts qu'existe `apps/ios/Tests/ContractTests.swift`, et le test Kotlin qui le porte.
 *
 * `notes` et `dossier` restent **nullables**. C'est la distinction que demande le §5 du
 * brief : `null` veut dire « absent », `""` veut dire « présent et vide ». Les ramener
 * tous deux à la chaîne vide ferait passer une donnée manquante pour une donnée mal
 * remplie, et c'est précisément la confusion à ne pas faire.
 */
@Serializable
data class ElementDuCoffre(
    val name: String,
    val notes: String? = null,
    // `#[serde(default)]` côté Rust : les items chiffrés avant l'ajout du champ se
    // déchiffrent à `null`, et doivent continuer de le faire.
    val folder: String? = null,
    val data: ContenuDElement,
) {
    /** Les identifiants de connexion, ou `null` si l'élément n'en porte pas. */
    val identifiants: Identifiants?
        get() = (data as? ContenuDElement.Connexion)?.valeur

    /**
     * L'élément est-il un registre à nom réservé ?
     *
     * Le **préfixe** décide, jamais une liste de noms connus : un registre écrit par une
     * version plus récente, ou par un autre produit de la suite, doit être masqué lui
     * aussi. Une liste fermée le laisserait apparaître comme une ligne fantôme au nom
     * illisible, ce qu'aucun utilisateur ne saurait interpréter.
     */
    val estUnRegistre: Boolean
        get() = name.startsWith(Registres.PREFIXE)
}

/** Contenu typé — `#[serde(tag = "kind", content = "data")]` côté Rust. */
sealed interface ContenuDElement {
    data class Connexion(val valeur: Identifiants) : ContenuDElement
    data class NoteSecrete(val valeur: Note) : ContenuDElement
    data class Carte(val valeur: CarteBancaire) : ContenuDElement
}

@Serializable
data class Identifiants(
    val username: String = "",
    val password: String = "",
    val uris: List<String> = emptyList(),
    val totp: String? = null,
    /** Anciens mots de passe, plus récent en tête. `#[serde(default)]` : rétrocompatible. */
    @SerialName("password_history") val passwordHistory: List<String> = emptyList(),
)

@Serializable
data class Note(val content: String = "")

@Serializable
data class CarteBancaire(
    val cardholder: String = "",
    val number: String = "",
    @SerialName("exp_month") val expMonth: String = "",
    @SerialName("exp_year") val expYear: String = "",
    val code: String = "",
)

/**
 * Le codec du contenu typé.
 *
 * serde produit une union **adjacente** — `{"kind":"Login","data":{…}}` — que
 * kotlinx.serialization ne sait pas décrire par annotation : son polymorphisme est
 * *interne* (le discriminant vit dans l'objet lui-même). Plutôt que de tordre le format
 * pour qu'il entre dans la bibliothèque, on écrit les huit lignes qui le lisent. Le
 * format de fil est ce qui fait contrat ; c'est la bibliothèque qui doit s'y plier.
 */
object CodecDElement {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = true
        encodeDefaults = true
    }

    /** Lit le JSON que rend `account.decryptItem`. Lève si la forme est inconnue. */
    fun lire(texte: String): ElementDuCoffre {
        val objet = json.parseToJsonElement(texte).jsonObject
        val contenu = objet["data"]?.jsonObject
            ?: throw IllegalArgumentException("l'élément ne porte pas de champ `data`")
        val genre = contenu["kind"]?.jsonPrimitive?.content
            ?: throw IllegalArgumentException("le contenu ne porte pas de champ `kind`")
        val charge = contenu["data"] ?: JsonObject(emptyMap())
        val typé: ContenuDElement = when (genre) {
            "Login" -> ContenuDElement.Connexion(json.decodeFromJsonElement(Identifiants.serializer(), charge))
            "SecureNote" -> ContenuDElement.NoteSecrete(json.decodeFromJsonElement(Note.serializer(), charge))
            "Card" -> ContenuDElement.Carte(json.decodeFromJsonElement(CarteBancaire.serializer(), charge))
            // Un genre inconnu vient d'un client plus récent. On le signale plutôt que de
            // le deviner : l'appelant en fera une ligne illisible, visible et expliquée.
            else -> throw IllegalArgumentException("type d'élément inconnu : $genre")
        }
        return ElementDuCoffre(
            name = objet["name"]?.jsonPrimitive?.content
                ?: throw IllegalArgumentException("l'élément ne porte pas de nom"),
            notes = objet["notes"]?.let { if (it.jsonPrimitive.isString) it.jsonPrimitive.content else null },
            folder = objet["folder"]?.let { if (it.jsonPrimitive.isString) it.jsonPrimitive.content else null },
            data = typé,
        )
    }

    /** Rend le JSON que `account.encryptItem` attend. */
    fun ecrire(element: ElementDuCoffre): String {
        val (genre, charge) = when (val d = element.data) {
            is ContenuDElement.Connexion ->
                "Login" to json.encodeToJsonElement(Identifiants.serializer(), d.valeur)
            is ContenuDElement.NoteSecrete ->
                "SecureNote" to json.encodeToJsonElement(Note.serializer(), d.valeur)
            is ContenuDElement.Carte ->
                "Card" to json.encodeToJsonElement(CarteBancaire.serializer(), d.valeur)
        }
        val objet = buildJsonObject {
            put("name", element.name)
            put("notes", element.notes)
            put("folder", element.folder)
            put("data", buildJsonObject {
                put("kind", genre)
                put("data", charge)
            })
        }
        return json.encodeToString(JsonObject.serializer(), objet)
    }
}
