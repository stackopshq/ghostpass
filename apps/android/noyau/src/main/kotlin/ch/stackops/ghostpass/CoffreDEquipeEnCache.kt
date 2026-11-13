package ch.stackops.ghostpass

import kotlinx.serialization.Serializable

/**
 * La copie locale d'un **coffre d'équipe**, pour l'affichage hors ligne et le remplissage.
 *
 * Pendant de `CoffreDEquipeEnCache` dans `apps/ios/Ghostpass/Services/TeamCache.swift`.
 * Jusqu'au 2026-11-13, Android ne gardait que le coffre personnel : hors ligne, le
 * remplissage ne proposait rien de ce qui vit en équipe — pour un compte dont tout vit en
 * équipe, rien du tout.
 *
 * **Rien ici n'est en clair.** Les éléments sont tels que le serveur les détient, scellés
 * sous l'Org Key ; l'Org Key elle-même est scellée pour ce compte, avec la clé publique de
 * qui l'a scellée. Cela n'élargit pas ce que l'appareil peut ouvrir : il le pouvait déjà en
 * ligne, avec le même compte. Ce qui change est qu'il n'a plus besoin du réseau.
 */
@Serializable
data class CoffreDEquipeEnCache(
    val organisation: String,
    val nom: String,
    val adminPublicKey: String,
    val encryptedOrgKey: String,
    val collections: List<CollectionEnCache>,
    // ─── Le rôle et l'état, pour que l'équipe garde sa pastille hors ligne ───
    //
    // Relevé le 2026-11-13 sur un Redmi, serveur coupé : les éléments d'équipe restaient
    // bien dans la liste, mais les pastilles de choix de coffre disparaissaient — le choix
    // « Tous les éléments / telle équipe » n'existait plus, alors que son contenu, lui,
    // était là. Une pastille demande une `Organisation`, donc un rôle et un état, et la
    // copie n'en gardait aucun.
    //
    // Ce sont les noms des valeurs de `RoleDOrganisation` et `EtatDAppartenance`, pas ceux
    // du serveur : la copie est relue par la même version qui l'a écrite. Les deux ont une
    // valeur par défaut, pour qu'une copie écrite avant ce champ se relise sans être jetée.
    val role: String = "",
    val etat: String = "",
)

@Serializable
data class CollectionEnCache(
    val id: String,
    val nom: String,
    val items: List<ElementChiffre>,
)
