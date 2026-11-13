package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import uniffi.ghost_crypto_ffi.register
import java.net.HttpURLConnection
import java.net.URL

/**
 * **L'administration d'organisation** — inviter un membre, lui accorder une permission —
 * éprouvée contre un vrai serveur.
 *
 * Piloté par `tools/android/temoin-de-l-administration.sh`.
 *
 * ─── Ce qu'une invitation doit prouver, et que « 201 Created » ne prouve pas ───
 *
 * Le serveur ne scelle rien et ne vérifie rien : il range un blob opaque et un rôle. Il
 * répond donc `201` avec autant d'entrain à une Org Key correctement scellée qu'à une suite
 * d'octets scellée vers la mauvaise clé publique. Le code de retour ne mesure rien.
 *
 * La seule preuve est de **l'autre côté** : l'invité ouvre l'organisation avec sa propre clé
 * privée et lit ce que l'équipe y a mis. C'est pourquoi cet outil sait tenir deux comptes.
 *
 *     inscrire  <serveur> <email> <mdp>
 *     inviter   <serveur> <admin> <mdp> <email> <role>  → INVITE <userId> | INCONNU
 *     accepter  <serveur> <email> <mdp>                 → ACCEPTE
 *     lire      <serveur> <email> <mdp>                 → LISIBLES <n> PERMISSION <p>
 *     ecrire    <serveur> <email> <mdp>                 → ECRIT <id> | REFUSE <statut>
 *     accorder  <serveur> <admin> <mdp> <email> <perm>  → ACCORDE <groupe>
 */
object AdministrationDOrg {

    private val json = Json { ignoreUnknownKeys = true }

    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "inscrire" -> inscrire(args[1], args[2], args[3])
            "inviter" -> inviter(args[1], args[2], args[3], args[4], args[5])
            "accepter" -> accepter(args[1], args[2], args[3])
            "lire" -> lire(args[1], args[2], args[3])
            "ecrire" -> ecrire(args[1], args[2], args[3])
            "accorder" -> accorder(args[1], args[2], args[3], args[4], args[5])
            "role" -> role(args[1], args[2], args[3], args[4], args[5])
            "creerEquipe" -> creerEquipe(args[1], args[2], args[3], args[4])
            "horsLigne" -> horsLigne(args[1], args[2], args[3])
            else -> {
                System.err.println("usage : voir la documentation de AdministrationDOrg")
                kotlin.system.exitProcess(2)
            }
        }
    }

    private fun session(serveur: String, email: String, motDePasse: String): Coffre =
        Coffre().apply { ouvrirUneSession(serveur, email, motDePasse) }

    /**
     * Crée un compte. L'application n'a pas d'écran d'inscription ; le témoin en a besoin
     * pour disposer d'un **second** utilisateur, avec une vraie paire de clés.
     */
    private fun inscrire(serveur: String, email: String, motDePasse: String) {
        val inscription = register(motDePasse, email)
        val compte = inscription.account()
        val blob = Json.parseToJsonElement(inscription.blob()).jsonObject
        val corps = buildJsonObject {
            put("email", email)
            put("masterPasswordHash", (blob["master_password_hash"] as JsonPrimitive).content)
            put("kdfParams", blob["kdf_params"].toString())
            put("encryptedUserKey", (blob["encrypted_user_key"] as JsonPrimitive).content)
            put("encryptedPrivateKey", (blob["encrypted_private_key"] as JsonPrimitive).content)
            put("publicKey", compte.publicKey())
        }
        poster("$serveur/api/auth/register", corps.toString(), null)
        println("INSCRIT")
    }

    /**
     * Invite, en passant par les **deux** temps : préparer, puis poser.
     *
     * La clé publique annoncée par le serveur est imprimée sur la sortie d'erreur. C'est
     * elle qu'un écran devrait montrer avant de sceller — le client ne peut pas
     * l'authentifier, il peut seulement refuser de la prendre en silence.
     */
    private fun inviter(
        serveur: String,
        admin: String,
        motDePasse: String,
        email: String,
        role: String,
    ) {
        val coffre = session(serveur, admin, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        when (val invitation = coffre.preparerUneInvitation(email)) {
            is Coffre.Invitation.Inconnu -> println("INCONNU ${invitation.email}")
            is Coffre.Invitation.AConfirmer -> {
                System.err.println(
                    "clé publique annoncée par le serveur pour $email : " +
                        invitation.clePubliqueAnnoncee,
                )
                coffre.poserLInvitation(ouvert, invitation, RoleDOrganisation.depuis(role))
                println("INVITE ${invitation.userId}")
            }
        }
    }

    /** Accepte l'invitation reçue. Avant cela, rien n'est lisible. */
    private fun accepter(serveur: String, email: String, motDePasse: String) {
        val coffre = session(serveur, email, motDePasse)
        val organisation = coffre.organisations().firstOrNull()
            ?: error("aucune organisation : l'invitation n'est pas arrivée")
        coffre.accepterLOrganisation(organisation.id)
        println("ACCEPTE")
    }

    /**
     * Ouvre l'organisation et lit la collection.
     *
     * **C'est ici que se prouve le scellement.** Si l'Org Key avait été scellée vers une
     * autre clé publique, `ouvrirLOrganisation` échouerait — le cœur vérifie la provenance —
     * ou les éléments ressortiraient illisibles.
     */
    private fun lire(serveur: String, email: String, motDePasse: String) {
        val coffre = session(serveur, email, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        val collection = ouvert.collections.first()
        val lecture = coffre.elementsDeCollection(ouvert, collection.id)
        println(
            "LISIBLES ${lecture.lisibles.size} ILLISIBLES ${lecture.nombreDIllisibles} " +
                "PERMISSION ${collection.permission}",
        )
    }

    /**
     * Tente une écriture d'équipe, et **rapporte le refus plutôt que de le laisser tomber**.
     *
     * Un membre en lecture seule doit recevoir un 403 du serveur. Le distinguer d'une panne
     * réseau est tout l'intérêt : « je n'ai pas le droit » et « ça n'a pas marché » mènent à
     * des écrans différents.
     */
    private fun ecrire(serveur: String, email: String, motDePasse: String) {
        val coffre = session(serveur, email, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        val element = ElementDuCoffre(
            name = "Écrit par $email",
            notes = null,
            folder = null,
            data = ContenuDElement.NoteSecrete(Note("essai de permission")),
        )
        try {
            val entree = coffre.creerDansCollection(ouvert, ouvert.collections.first().id, element)
            println("ECRIT ${entree.id}")
        } catch (e: ErreurApi.Http) {
            println("REFUSE ${e.statut}")
        }
    }

    /**
     * Accorde une permission à un membre, **par un groupe**.
     *
     * Le chemin direct — changer le rôle du membre — passe par `PATCH`, que
     * `HttpURLConnection` refuse. Voir [Coffre.accorderSurUneCollection] : ce n'est pas un
     * choix de conception, c'est la seule route d'octroi que ce client peut atteindre.
     */
    private fun accorder(
        serveur: String,
        admin: String,
        motDePasse: String,
        email: String,
        permission: String,
    ) {
        val coffre = session(serveur, admin, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        val membre = coffre.membresDe(ouvert).firstOrNull { it.email == email }
            ?: error("$email n'est pas membre de l'organisation")
        val groupe = coffre.creerUnGroupe(ouvert, "Rédacteurs " + System.currentTimeMillis() % 10000)
        coffre.ajouterAuGroupe(ouvert, groupe, membre.userId)
        coffre.accorderSurUneCollection(
            ouvert,
            groupe,
            ouvert.collections.first().id,
            when (permission.lowercase()) {
                "write" -> PermissionDeCollection.Ecriture
                "manage" -> PermissionDeCollection.Gestion
                else -> PermissionDeCollection.Lecture
            },
        )
        println("ACCORDE $groupe")
    }

    /**
     * Change le rôle d'un membre par `POST …/role`, puis relit le rôle **chez le serveur**.
     *
     * Rapporte le refus plutôt que de le laisser tomber : rétrograder le dernier
     * administrateur doit rendre 400.
     */
    private fun role(serveur: String, admin: String, motDePasse: String, email: String, role: String) {
        val coffre = session(serveur, admin, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        val membre = coffre.membresDe(ouvert).firstOrNull { it.email == email }
            ?: error("$email n'est pas membre de l'organisation")
        try {
            coffre.changerLeRole(ouvert, membre.userId, RoleDOrganisation.depuis(role))
        } catch (e: ErreurApi.Http) {
            println("REFUSE ${e.statut}")
            return
        }
        val relu = coffre.membresDe(ouvert).first { it.userId == membre.userId }.role
        println("ROLE $relu")
    }

    /**
     * Crée une équipe, puis la **rouvre** avec la clé du compte : seule preuve que l'Org Key
     * a été scellée pour lui, et non pour personne.
     */
    private fun creerEquipe(serveur: String, email: String, motDePasse: String, nom: String) {
        val coffre = session(serveur, email, motDePasse)
        coffre.creerUneOrganisation(nom)
        val creee = coffre.organisations().firstOrNull { it.nom == nom }
            ?: error("l'équipe créée n'apparaît pas")
        coffre.ouvrirLOrganisation(creee).getOrElse { error("l'équipe créée ne s'ouvre pas : $it") }
            .use { println("CREEE ${creee.role} OUVERTE ${it.collections.size} COLLECTION(S)") }
    }

    /**
     * Relit la première équipe **depuis sa copie hors ligne**, la session refermée sur le
     * réseau : la copie doit se rouvrir avec le seul compte.
     */
    private fun horsLigne(serveur: String, email: String, motDePasse: String) {
        val coffre = session(serveur, email, motDePasse)
        val ouvert = ouvrirLOrg(coffre)
        val collections = ouvert.collections.map { collection ->
            val (chiffres, _) = coffre.lireUneCollection(ouvert, collection.id)
            CollectionEnCache(collection.id, collection.nom, chiffres)
        }
        val copie = coffre.copieHorsLigne(ouvert, collections) ?: error("aucune copie possible")
        // Aller-retour par le format stocké : c'est lui que lira l'application.
        val texte = Json.encodeToString(CoffreDEquipeEnCache.serializer(), copie)
        val relue = Json.decodeFromString(CoffreDEquipeEnCache.serializer(), texte)
        val lectures = coffre.relireLesEquipesEnCache(listOf(relue))
        val lisibles = lectures.sumOf { it.lisibles.size }
        val illisibles = lectures.sumOf { it.nombreDIllisibles }
        val dEquipe = lectures.all { l -> l.entrees.all { it.origine.estDEquipe } }
        println("HORS LIGNE LISIBLES $lisibles ILLISIBLES $illisibles EQUIPE $dEquipe")
    }

    private fun ouvrirLOrg(coffre: Coffre): Coffre.CoffreDOrganisation {
        val organisation = coffre.organisations().firstOrNull()
            ?: error("aucune organisation sur ce compte")
        return coffre.ouvrirLOrganisation(organisation).getOrElse {
            error("l'organisation ne s'ouvre pas : $it")
        }
    }

    private fun poster(url: String, corps: String, jeton: String?): String {
        val connexion = URL(url).openConnection() as HttpURLConnection
        connexion.requestMethod = "POST"
        connexion.setRequestProperty("Content-Type", "application/json")
        if (jeton != null) connexion.setRequestProperty("Authorization", "Bearer $jeton")
        connexion.doOutput = true
        connexion.outputStream.use { it.write(corps.toByteArray(Charsets.UTF_8)) }
        val statut = connexion.responseCode
        val flux = if (statut in 200..299) connexion.inputStream else connexion.errorStream
        val texte = flux?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        if (statut !in 200..299) error("$url a rendu $statut : $texte")
        return texte
    }
}
