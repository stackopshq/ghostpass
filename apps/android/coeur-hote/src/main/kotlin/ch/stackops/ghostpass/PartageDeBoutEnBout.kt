package ch.stackops.ghostpass

/**
 * Le **client de partage** d'Android, en ligne de commande, pour le témoin de destination.
 *
 * `tools/android/temoin-de-la-destination.sh` le fait dialoguer avec un vrai serveur à
 * relais et un ghostbit simulé qui rend une adresse sur un **autre domaine**. C'est le seul
 * moyen d'éprouver le §4 : le serveur de la branche de travail ne rend qu'un identifiant, le
 * lien retombe donc toujours sur l'hôte que l'utilisateur a saisi, et la question ne se pose
 * jamais.
 *
 * Ce qui s'y joue est le point de sécurité le plus important du produit. Le serveur détient
 * déjà le chiffré ; s'il choisit le domaine du lien, il obtient le secret **en clair**,
 * puisque la page servie par ce domaine lit `location.hash`.
 *
 *     partager <serveur> <email> <mdp> <secret> [hôte approuvé…]
 *         → PRET <lien> | ADEMANDER <hôte> <id> <jeton> | REFUSE <raison>
 *
 *     revoquer <serveur> <email> <mdp> <id> <jeton>
 *         → REVOQUE
 */
object PartageDeBoutEnBout {

    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "partager" -> {
                val coffre = ouvrir(args[1], args[2], args[3])
                val approuves = args.drop(5).toSet()
                when (val resultat = coffre.partager(
                    secret = args[4],
                    heures = 24,
                    consultations = 1,
                    nom = "Essai de destination",
                    approuves = approuves,
                )) {
                    is Coffre.Partage.Pret ->
                        println("PRET ${resultat.lien}")
                    is Coffre.Partage.ADemander ->
                        // L'identifiant et le jeton sortent ici parce que le témoin doit
                        // pouvoir vérifier qu'un refus **révoque vraiment**. Ils ne sortent
                        // nulle part dans l'application.
                        println(
                            "ADEMANDER ${resultat.hote} ${resultat.cree.id} " +
                                resultat.cree.deleteToken,
                        )
                    is Coffre.Partage.Refuse ->
                        println("REFUSE ${resultat.raison}")
                }
            }
            "revoquer" -> {
                ouvrir(args[1], args[2], args[3]).revoquerUnPartage(args[4], args[5])
                println("REVOQUE")
            }
            else -> {
                System.err.println(
                    "usage : partager <serveur> <email> <mdp> <secret> [hôtes approuvés…]\n" +
                        "        revoquer <serveur> <email> <mdp> <id> <jeton>",
                )
                kotlin.system.exitProcess(2)
            }
        }
    }

    private fun ouvrir(serveur: String, email: String, motDePasse: String): Coffre =
        Coffre().apply { ouvrirUneSession(serveur, email, motDePasse) }
}
