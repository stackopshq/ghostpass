package ch.stackops.ghostpass

import kotlinx.serialization.Serializable

/**
 * Les coffres d'équipe — et pourquoi une application qui les ignore montre un coffre vide.
 *
 * `/api/vault/items` ne rend que le coffre **personnel**. Quelqu'un dont les mots de passe
 * vivent dans des collections d'équipe se connecte, voit une liste vide, et conclut que
 * l'application ne marche pas — ou pire, que ses données ont disparu. Mesuré le 2026-08-31
 * sur un vrai téléphone, et c'est le défaut le plus grave qu'ait connu ce portage : il ne
 * lève aucune erreur, et il ressemble à une perte de données.
 *
 * ## Le chemin des clés, qui n'est pas celui du coffre personnel
 *
 * ```
 *   clé privée de l'utilisateur ──ouvre──▶ Org Key (scellée vers sa clé publique)
 *   Org Key ──ouvre──▶ les éléments des collections
 * ```
 *
 * L'Org Key est **scellée par un administrateur vers la clé publique du membre**, et
 * `Account.openOrg` vérifie qu'elle provient bien de la clé publique annoncée. Sans cette
 * vérification, un serveur actif pourrait substituer une Org Key de son choix et lire ce
 * que le membre y écrirait ensuite. C'est le cœur qui la fait ; l'application ne fait que
 * lui passer les deux valeurs que le serveur rend.
 */

// ─── Ce que le serveur rend ───

@Serializable
data class OrganisationDto(
    val orgId: String,
    val name: String = "",
    val role: String = "",
    val status: String = "",
)

@Serializable
internal data class EnveloppeDOrganisations(val organizations: List<OrganisationDto> = emptyList())

/**
 * L'appartenance du membre à une organisation.
 *
 * `encryptedOrgKey` et `sealedByPublicKey` sont **optionnels**, et leur absence n'est pas
 * une erreur : c'est l'état d'un membre invité à qui aucun administrateur n'a encore remis
 * de clé. Les exiger ferait échouer le décodage, et l'organisation disparaîtrait de la
 * liste au lieu de dire qu'elle attend.
 */
@Serializable
data class AppartenanceDto(
    val role: String = "",
    val status: String = "",
    val encryptedOrgKey: String? = null,
    val sealedByPublicKey: String? = null,
)

@Serializable
data class CollectionDto(
    val id: String,
    val name: String = "",
    /**
     * La permission **effective** telle que le serveur l'établit — rôle d'administrateur,
     * octroi direct et accès de groupe additionnés, maximum retenu.
     *
     * Optionnelle : un serveur antérieur ne la rend pas, et l'exiger ferait échouer le
     * décodage de la liste entière. Absente, on retombe sur le rôle dans l'organisation —
     * moins juste, mais lisible.
     */
    val permission: String? = null,
)

@Serializable
internal data class EnveloppeDeCollections(val collections: List<CollectionDto> = emptyList())

// ─── Ce que l'application en fait ───

/** Le rôle du membre dans l'organisation. */
enum class RoleDOrganisation {
    Admin,
    Membre,
    LectureSeule,

    /**
     * Un rôle que cette version ne connaît pas.
     *
     * **On garde l'organisation plutôt que de l'écarter.** iOS rend `nil` pour un rôle
     * inconnu, et la liste le laisse tomber en silence : c'est exactement le défaut que le
     * §5 combat pour les éléments, transposé aux organisations. Une équipe qui disparaît de
     * la liste se lit « je n'en fais pas partie », ce qui est faux.
     *
     * Un rôle inconnu vaut **lecture seule** : c'est le seul défaut sûr, puisque proposer
     * l'écriture à qui ne l'a pas fait échouer l'enregistrement après la saisie.
     */
    Inconnu;

    companion object {
        fun depuis(brut: String): RoleDOrganisation = when (brut.lowercase()) {
            "admin" -> Admin
            "member" -> Membre
            "readonly" -> LectureSeule
            else -> Inconnu
        }
    }
}

/** L'état de l'adhésion. */
enum class EtatDAppartenance {
    /** Le membre a accepté : le contenu est lisible. */
    Actif,

    /**
     * Invité, pas encore accepté. **Aucun contenu n'est lisible**, et il ne faut pas
     * l'afficher comme vide : « cette équipe n'a rien » et « vous n'avez pas encore
     * accepté » sont deux phrases différentes, et une seule est vraie.
     */
    Invite,

    /** Un état que cette version ne connaît pas. On l'affiche quand même. */
    Inconnu;

    companion object {
        fun depuis(brut: String): EtatDAppartenance = when (brut.lowercase()) {
            "active" -> Actif
            "invited" -> Invite
            else -> Inconnu
        }
    }
}

/**
 * La permission sur une collection.
 *
 * **Par collection, jamais par organisation** : le même membre peut écrire dans l'une et
 * seulement lire dans l'autre. Proposer « Modifier » à un membre en lecture seule fait
 * échouer l'enregistrement après qu'il a tout saisi — le pire moment pour apprendre qu'on
 * n'en avait pas le droit.
 */
enum class PermissionDeCollection {
    Lecture,
    Ecriture,
    Gestion;

    val peutEcrire: Boolean get() = this != Lecture

    companion object {
        /**
         * La permission d'une collection, ou son défaut déduit du rôle.
         *
         * Le repli est **conservateur** : tout ce qui n'est pas explicitement administrateur
         * vaut lecture. Se tromper dans ce sens fait manquer un bouton ; se tromper dans
         * l'autre fait perdre une saisie.
         */
        fun depuis(brut: String?, role: RoleDOrganisation): PermissionDeCollection =
            when (brut?.lowercase()) {
                "manage" -> Gestion
                "write" -> Ecriture
                "read" -> Lecture
                else -> if (role == RoleDOrganisation.Admin) Gestion else Lecture
            }
    }
}

/** Une organisation, telle que l'écran la voit. */
data class Organisation(
    val id: String,
    val nom: String,
    val role: RoleDOrganisation,
    val etat: EtatDAppartenance,
) {
    companion object {
        fun depuis(dto: OrganisationDto): Organisation = Organisation(
            id = dto.orgId,
            // Une organisation sans nom garde son identifiant : mieux vaut une ligne qu'on
            // peut désigner qu'une ligne sans titre.
            nom = dto.name.ifBlank { dto.orgId },
            role = RoleDOrganisation.depuis(dto.role),
            etat = EtatDAppartenance.depuis(dto.status),
        )
    }
}

/** Une collection d'équipe, avec la permission effective du membre dessus. */
data class CollectionDOrganisation(
    val id: String,
    val nom: String,
    val permission: PermissionDeCollection,
)

/**
 * Pourquoi une organisation n'a pas pu être ouverte.
 *
 * Elle reste affichée : **une organisation dont la clé ne s'ouvre pas ne doit pas vider
 * l'écran**, et les autres doivent s'afficher quand même. Le motif dit quoi faire, et les
 * trois conduites à tenir sont différentes.
 */
sealed interface EchecDOrganisation {
    /** L'invitation n'a pas été acceptée : il n'y a rien à lire, et c'est normal. */
    data object InvitationEnAttente : EchecDOrganisation

    /** Aucun administrateur n'a encore scellé l'Org Key pour ce membre. */
    data object AucuneCleRemise : EchecDOrganisation

    /** La clé existe et ne s'ouvre pas — sceau refusé, ou clé d'un autre. */
    data class CleRefusee(val message: String) : EchecDOrganisation

    /** Le serveur n'a pas répondu. */
    data class Reseau(val message: String) : EchecDOrganisation
}
