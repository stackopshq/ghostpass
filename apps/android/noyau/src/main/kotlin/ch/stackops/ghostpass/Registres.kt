package ch.stackops.ghostpass

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Les registres à nom réservé (docs/android.md §2).
 *
 * Le coffre ne contient que des éléments chiffrés. Ce que l'application doit retenir en
 * plus — les dossiers vides, les favoris, les partages en cours, les couleurs d'équipe —
 * vit dans des éléments comme les autres, sous un nom commençant par un **octet NUL**.
 * Aucun clavier n'en produit, donc aucun nom d'utilisateur ne peut usurper un registre.
 *
 * **Piège mesuré** (§2, et le même est écrit dans `contrat.json`) : `grep` traite un
 * fichier contenant un NUL comme binaire et rend zéro résultat *sans le dire*. Chercher
 * `gp:shares` sans son préfixe, ou passer `-a`.
 */
object Registres {

    /**
     * `\0gp:` — le NUL est un **vrai octet nul**, pas les deux caractères `\` et `0`.
     *
     * Écrit en échappement `\u0000` et non posé littéralement dans le source : un octet
     * nul littéral est invisible à la relecture, se perd au premier copier-coller, et rend
     * le fichier binaire aux yeux de `grep`, qui cesse alors d'y trouver quoi que ce soit
     * — sans le dire. C'est arrivé à ce fichier même pendant son écriture.
     */
    const val PREFIXE = "\u0000gp:"

    /** Les dossiers **vides** — ceux qu'aucun élément n'habite. Tableau JSON de chemins. */
    const val DOSSIERS = PREFIXE + "folders"

    /** Les identifiants des éléments mis en favori. Tableau JSON. */
    const val FAVORIS = PREFIXE + "favorites"

    /** Les partages en cours, avec leur jeton de révocation. Tableau JSON d'objets. */
    const val PARTAGES = PREFIXE + "shares"

    /** La couleur choisie par équipe. Objet JSON `{ "<id d'organisation>": "#RRGGBB" }`. */
    const val COULEURS_DEQUIPE = PREFIXE + "orgcolors"

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Le contenu d'un registre en tableau de chaînes.
     *
     * Illisible, il vaut mieux le tenir pour vide que faire échouer la lecture entière :
     * un registre corrompu par un autre client ne doit pas priver l'utilisateur de son
     * coffre. C'est le seul endroit où avaler une erreur est le bon comportement — et
     * c'est parce que le registre est un *accessoire*, pas une donnée de l'utilisateur.
     * La règle §5 ne s'y applique pas : ce qui doit rester visible, ce sont les éléments.
     */
    fun listeDe(element: ElementDuCoffre): List<String> {
        val note = (element.data as? ContenuDElement.NoteSecrete)?.valeur ?: return emptyList()
        return try {
            json.decodeFromString(ListSerializer(String.serializer()), note.content)
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Le registre des couleurs : un objet JSON, identifiant d'équipe vers `#RRGGBB`. */
    fun couleursDe(element: ElementDuCoffre): Map<String, String> {
        val note = (element.data as? ContenuDElement.NoteSecrete)?.valeur ?: return emptyMap()
        return try {
            val objet = json.parseToJsonElement(note.content) as? JsonObject ?: return emptyMap()
            objet.mapNotNull { (cle, valeur) ->
                val texte = valeur.jsonPrimitive
                if (texte.isString) cle to texte.content else null
            }.toMap()
        } catch (_: Exception) {
            emptyMap()
        }
    }

    /** Le registre des partages. */
    fun partagesDe(element: ElementDuCoffre): List<PartageEnCours> {
        val note = (element.data as? ContenuDElement.NoteSecrete)?.valeur ?: return emptyList()
        return try {
            json.decodeFromString(ListSerializer(PartageEnCours.serializer()), note.content)
        } catch (_: Exception) {
            emptyList()
        }
    }
}

/**
 * Un partage en cours, tel qu'il vit au registre `\0gp:shares`.
 *
 * **Les horodatages sont en secondes**, et c'est l'exception qu'il faut tenir : les
 * horodatages des *éléments* rendus par le serveur (`updatedAt`, `deletedAt`) sont en
 * millisecondes. Les deux unités cohabitent dans la même application. `createdAt` et
 * `expiresAt` étaient dans deux unités différentes au premier jet de la suite — dans une
 * structure partagée par trois clients — et l'écart ne se serait vu qu'à l'affichage, chez
 * celui qui n'a pas écrit la ligne.
 *
 * `url` et `deleteToken` sont **optionnels** : un serveur antérieur au relais rend `{ id }`
 * seul (§4). Mais leur absence signifie qu'on n'écrit rien ici — sans jeton et sans route
 * de révocation, une ligne au registre serait un vœu.
 */
@Serializable
data class PartageEnCours(
    val id: String,
    val url: String,
    val deleteToken: String,
    val name: String,
    /** Secondes depuis l'epoch. */
    val createdAt: Long,
    /** Secondes depuis l'epoch, ou `null` si le partage n'expire pas. */
    val expiresAt: Long? = null,
)
