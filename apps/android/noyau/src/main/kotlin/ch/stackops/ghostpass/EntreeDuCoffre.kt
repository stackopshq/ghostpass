package ch.stackops.ghostpass

/**
 * Une ligne du coffre, **qu'elle se soit ouverte ou non**.
 *
 * C'est la règle §5 du brief, et elle est structurelle plutôt que cosmétique : le type
 * lui-même refuse de laisser tomber une ligne. Une liste de `ElementDuCoffre` ne pourrait
 * représenter que ce qui s'est déchiffré, et le reste disparaîtrait forcément — pas par
 * choix, mais faute de pouvoir l'écrire.
 *
 * **Ce n'est pas un portage.** iOS fait aujourd'hui l'inverse : `VaultStore.lecture`
 * écarte silencieusement ce qui ne s'ouvre pas (`guard let item = try? decrypt(…) else {
 * continue }`, VaultStore.swift:516), et il n'existe là-bas aucun type pour une ligne
 * illisible. Le brief présente cette règle comme acquise ; elle ne l'est pas, elle naît
 * ici. C'est signalé à l'endroit où quelqu'un ira vérifier.
 *
 * Pourquoi elle compte : une ligne absente se lit « il n'y a rien ». L'utilisateur qui ne
 * voit pas son identifiant conclut qu'il ne l'a jamais enregistré, et le recrée — alors
 * que l'original est là, chiffré sous une clé que ce client n'a pas. Une ligne qui dit
 * « chiffré sous une clé dont vous ne disposez pas » mène à la bonne action ; son absence
 * mène à la mauvaise, avec la même assurance.
 */
sealed interface EntreeDuCoffre {
    /** L'identité de la ligne côté serveur. Toujours connue : elle ne vient pas du chiffré. */
    val id: String

    /** Millisecondes depuis l'epoch, telles que le serveur les rend. Voir [ElementChiffre]. */
    val misAJourLe: Long?

    /** Une ligne ouverte. */
    data class Lisible(
        override val id: String,
        val element: ElementDuCoffre,
        override val misAJourLe: Long? = null,
    ) : EntreeDuCoffre

    /**
     * Une ligne qui n'a pas pu être ouverte, et qui reste affichée.
     *
     * Elle ne porte aucun nom : le nom vit *dans* le chiffré. Prétendre en afficher un
     * serait inventer. Elle porte son identifiant serveur — de quoi la désigner dans un
     * message d'aide — et la raison, qui est ce dont l'utilisateur a besoin pour agir.
     */
    data class Illisible(
        override val id: String,
        val raison: RaisonDIllisibilite,
        override val misAJourLe: Long? = null,
    ) : EntreeDuCoffre
}

/**
 * Pourquoi une ligne ne s'est pas ouverte.
 *
 * Trois causes distinctes, et les confondre coûte : la première se répare en rejoignant
 * une organisation, la deuxième en mettant l'application à jour, la troisième pas du tout.
 * Un message unique « erreur de déchiffrement » les rendrait toutes également
 * décourageantes.
 */
sealed interface RaisonDIllisibilite {
    /**
     * Le chiffré est là, mais aucune clé dont dispose ce client ne l'ouvre — typiquement
     * un élément d'une organisation qu'on a quittée, ou dont la clé a tourné.
     */
    data object CleManquante : RaisonDIllisibilite

    /** Le cœur a refusé l'enveloppe : elle est corrompue, ou scellée pour quelqu'un d'autre. */
    data class SceauRefuse(val message: String) : RaisonDIllisibilite

    /**
     * Le cœur a bien ouvert l'enveloppe, mais ce qu'il y avait dedans a une forme que
     * cette version ne sait pas lire — un genre d'élément ajouté par un client plus
     * récent, par exemple.
     *
     * Cas distinct du précédent, et le plus facile à confondre avec lui : ici la
     * cryptographie a *fonctionné*. Le dire évite d'envoyer quelqu'un chercher un
     * problème de clé qui n'existe pas.
     */
    data class ContenuInconnu(val message: String) : RaisonDIllisibilite
}
