package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.masterPasswordHash
import java.net.HttpURLConnection
import java.net.URL

/**
 * **La rotation de clé d'organisation, provoquée pendant qu'une session est ouverte.**
 *
 * Piloté par `tools/android/temoin-de-la-rotation.sh`. C'est le seul chemin de
 * [Coffre.exigerLaCleCourante] qu'aucun autre témoin ne déclenche.
 *
 * ─── Ce qui manquait, et pourquoi rien d'autre ne le couvre ───
 *
 * `OrganisationsTest` montre la **conséquence** — un élément scellé sous une autre Org Key
 * ressort en `SceauRefuse` — mais jamais la garde. Le parcours de bout en bout traverse
 * bien `exigerLaCleCourante`, seulement avec une clé qui n'a pas tourné : seule la branche
 * « les clés concordent » y est éprouvée. Une garde qui ne revérifierait rien laisserait
 * donc tous les témoins verts.
 *
 * Ici la clé tourne **pour de vrai**, par la route `POST /api/orgs/:id/rotate` du serveur,
 * depuis une **seconde session** — un autre appareil du même administrateur, ce qui est
 * exactement la situation réelle. La session ouverte avant la rotation tente ensuite
 * d'écrire.
 *
 * ─── Deux scénarios, deux issues opposées ───
 *
 * C'est ce qui fait de cet outil une preuve plutôt qu'une observation :
 *
 *     sans-rotation  → l'écriture doit RÉUSSIR   (sinon le témoin serait vert parce que
 *                                                 l'écriture d'équipe ne marche jamais)
 *     avec-rotation  → l'écriture doit être REFUSÉE
 *
 * Une `exigerLaCleCourante` vidée de son contenu rend `ECRIT` dans les deux cas, et le
 * témoin rougit sur le second. Une garde qui refuserait toujours rend `REFUSE` dans les
 * deux cas, et le témoin rougit sur le premier. Les deux défauts symétriques sont donc
 * attrapés, ce qu'un seul scénario ne saurait pas faire.
 *
 *     eprouver sans-rotation <serveur> <email> <mdp>   → ECRIT <id> | REFUSE <classe>
 *     eprouver avec-rotation <serveur> <email> <mdp>   → ECRIT <id> | REFUSE <classe>
 *     relire <serveur> <email> <mdp>                   → LISIBLES <n> ILLISIBLES <n>
 */
object RotationDeCle {

    private val json = Json { ignoreUnknownKeys = true }

    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "eprouver" -> eprouver(args[1], args[2], args[3], args[4])
            "relire" -> relire(args[1], args[2], args[3])
            else -> {
                System.err.println(
                    "usage : eprouver <sans-rotation|avec-rotation> <serveur> <email> <mdp>\n" +
                        "        relire <serveur> <email> <mdp>",
                )
                kotlin.system.exitProcess(2)
            }
        }
    }

    /**
     * Ouvre une session, fait éventuellement tourner la clé **ailleurs**, puis écrit.
     *
     * L'ordre est tout : la session est ouverte **avant** la rotation, et c'est ce qui la
     * met en possession d'une Org Key périmée sans qu'elle en sache rien.
     */
    private fun eprouver(scenario: String, serveur: String, email: String, motDePasse: String) {
        val coffre = Coffre().apply { ouvrirUneSession(serveur, email, motDePasse) }
        val organisation = coffre.organisations().firstOrNull()
            ?: error("aucune organisation sur ce compte — le serveur n'a pas été semé")
        val ouvert = coffre.ouvrirLOrganisation(organisation).getOrElse {
            error("l'organisation ne s'ouvre pas : $it")
        }
        val collection = ouvert.collections.firstOrNull()?.id
            ?: error("l'organisation n'a aucune collection")

        if (scenario == "avec-rotation") {
            faireTournerLaCle(serveur, email, motDePasse, organisation.id)
        }

        // La session d'origine n'a **rien vu** de la rotation : ni notification, ni erreur.
        // C'est tout le problème, et c'est pourquoi la garde relit avant d'écrire.
        val element = ElementDuCoffre(
            name = "Écrit " + System.currentTimeMillis(),
            notes = null,
            folder = null,
            data = ContenuDElement.NoteSecrete(Note("après la rotation")),
        )
        try {
            val entree = coffre.creerDansCollection(ouvert, collection, element)
            println("ECRIT ${entree.id}")
        } catch (e: Coffre.CleDOrganisationPerimee) {
            println("REFUSE ${e.javaClass.simpleName}")
        }
    }

    /**
     * Relit la collection d'équipe dans une session **neuve**, et compte.
     *
     * C'est la mesure de la conséquence : après une écriture sous une clé périmée, l'élément
     * existe côté serveur et ressort illisible pour tout le monde. Une session neuve est
     * indispensable — celle qui a écrit détient encore l'ancienne clé et le relirait très
     * bien, ce qui est précisément l'illusion qui rend ce défaut si coûteux.
     */
    private fun relire(serveur: String, email: String, motDePasse: String) {
        val coffre = Coffre().apply { ouvrirUneSession(serveur, email, motDePasse) }
        val organisation = coffre.organisations().first()
        val ouvert = coffre.ouvrirLOrganisation(organisation).getOrElse {
            error("l'organisation ne s'ouvre pas : $it")
        }
        val lecture = coffre.elementsDeCollection(ouvert, ouvert.collections.first().id)
        println("LISIBLES ${lecture.lisibles.size} ILLISIBLES ${lecture.nombreDIllisibles}")
    }

    /**
     * **La rotation, menée comme un administrateur la mène** — depuis une autre session.
     *
     * Le client Android n'a pas de route d'administration ; c'est écrit dans `docs/android.md`
     * et ça reste vrai. Cet outil ne l'ajoute pas à l'application : il refait ici, avec le
     * **cœur** et des requêtes nues, ce qu'un administrateur ferait depuis le web. Aucune
     * crypto n'est réimplémentée — `createOrg`, `rewrapItem` et `openOrg` sont ceux des
     * bindings.
     *
     * Le serveur applique le tout en une transaction : nouvelle clé scellée pour les membres
     * restants, et items ré-enveloppés. Un item non ré-enveloppé deviendrait illisible pour
     * tous, ce qui est la faute que la route évite en exigeant les deux ensemble.
     */
    private fun faireTournerLaCle(
        serveur: String,
        email: String,
        motDePasse: String,
        idOrg: String,
    ) {
        val api = ClientApi(serveur)
        val kdf = api.prelogin(email).kdfParams
        val connexion = api.connexion(email, masterPasswordHash(motDePasse, email, kdf), null)
        val compte = Account.unlock(
            motDePasse,
            email,
            connexion.kdfParams,
            connexion.encryptedUserKey,
            connexion.encryptedPrivateKey,
        )
        val jeton = connexion.token

        // L'ancienne Org Key, ouverte comme l'application l'ouvre — avec la vérification de
        // provenance contre la clé publique de l'émetteur.
        val appartenance = api.appartenance(jeton, idOrg)
        val ancienne = compte.openOrg(
            appartenance.sealedByPublicKey ?: error("aucune clé publique d'émetteur"),
            appartenance.encryptedOrgKey ?: error("aucune Org Key scellée"),
        )

        // La nouvelle. `createOrg` génère une Org Key et la scelle pour soi : c'est
        // exactement ce dont une rotation a besoin, l'organisation existant déjà côté
        // serveur — seule la clé change.
        val creation = compte.createOrg()
        val nouvelle = creation.org()

        // Mon identifiant, que seule la liste des membres donne. On l'apparie par email ;
        // le serveur ne rend pas « qui suis-je » sur cette route.
        val membres = json.parseToJsonElement(lire("$serveur/api/orgs/$idOrg/members", jeton))
            .jsonObject["members"] as JsonArray
        val moi = membres.map { it.jsonObject }.firstOrNull {
            (it["email"] as? JsonPrimitive)?.content == email
        } ?: error("je ne me trouve pas dans la liste des membres de l'organisation")
        val monId = (moi["userId"] as JsonPrimitive).content

        // Ré-envelopper **tous** les items de l'organisation, collection par collection.
        val reenveloppes = buildJsonArray {
            for (collection in api.collectionsDOrganisation(jeton, idOrg)) {
                for (chiffre in api.elementsDeCollection(jeton, idOrg, collection.id)) {
                    val enveloppe = buildJsonObject {
                        put("encrypted_key", chiffre.encryptedKey)
                        put("encrypted_data", chiffre.encryptedData)
                    }
                    // Un item scellé sous une **autre** Org Key (le semeur en dépose un, pour
                    // la règle §5) ne se ré-enveloppe pas : il n'a jamais été à cette
                    // organisation. On le laisse tel quel plutôt que d'échouer — un
                    // administrateur réel est dans le même cas.
                    val neuf = try {
                        json.parseToJsonElement(
                            nouvelle.rewrapItem(ancienne, enveloppe.toString()),
                        ).jsonObject
                    } catch (_: Exception) {
                        continue
                    }
                    add(
                        buildJsonObject {
                            put("id", chiffre.id)
                            put("encryptedKey", (neuf["encrypted_key"] as JsonPrimitive).content)
                        },
                    )
                }
            }
        }

        val corps = buildJsonObject {
            put(
                "members",
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("userId", monId)
                            put("encryptedOrgKey", creation.sealedForSelf())
                        },
                    )
                },
            )
            put("items", reenveloppes)
        }
        poster("$serveur/api/orgs/$idOrg/rotate", corps.toString(), jeton)
        System.err.println(
            "rotation appliquée : ${reenveloppes.size} élément(s) ré-enveloppé(s).")
    }

    private fun lire(url: String, jeton: String): String {
        val connexion = URL(url).openConnection() as HttpURLConnection
        connexion.setRequestProperty("Authorization", "Bearer $jeton")
        return corps(connexion, url)
    }

    private fun poster(url: String, corps: String, jeton: String): String {
        val connexion = URL(url).openConnection() as HttpURLConnection
        connexion.requestMethod = "POST"
        connexion.setRequestProperty("Content-Type", "application/json")
        connexion.setRequestProperty("Authorization", "Bearer $jeton")
        connexion.doOutput = true
        connexion.outputStream.use { it.write(corps.toByteArray(Charsets.UTF_8)) }
        return corps(connexion, url)
    }

    private fun corps(connexion: HttpURLConnection, url: String): String {
        val statut = connexion.responseCode
        val flux = if (statut in 200..299) connexion.inputStream else connexion.errorStream
        val texte = flux?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        if (statut !in 200..299) error("$url a rendu $statut : $texte")
        return texte
    }
}
