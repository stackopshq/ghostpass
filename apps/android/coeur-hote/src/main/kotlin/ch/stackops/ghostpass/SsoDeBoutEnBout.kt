package ch.stackops.ghostpass

/**
 * Le **client** du SSO mobile, en ligne de commande, pour le témoin de bout en bout.
 *
 * `tools/android/temoin-du-sso-mobile.sh` fait dialoguer ce code — celui que l'application
 * Android exécute vraiment — avec le **vrai serveur** GhostPass et un fournisseur d'identité
 * simulé. Rien n'est simulé côté client : le vérificateur PKCE, la vérification de l'état et
 * la requête d'échange sont exactement ceux de l'application.
 *
 * Ce que cela couvre et qu'un test unitaire ne couvre pas : que le défi calculé ici est
 * celui que le serveur accepte au `start`, que le `redirect_uri` est bien dans sa liste
 * blanche, et que le corps de l'échange porte les noms qu'il attend. Trois écarts qui ne
 * produiraient aucune erreur de compilation.
 *
 *     pkce                                              → verificateur, défi, état
 *     terminer <serveur> <retour> <état> <verificateur> → l'adresse du compte ouvert
 */
object SsoDeBoutEnBout {

    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "pkce" -> {
                val pkce = SsoMobile.Pkce.tirer()
                val etat = SsoMobile.chaineAleatoire(16)
                println(pkce.verificateur)
                println(pkce.defi)
                println(etat)
            }
            "terminer" -> {
                val (serveur, retour, etat, verificateur) =
                    listOf(args[1], args[2], args[3], args[4])
                // L'état d'abord : un retour qui n'est pas le nôtre ne mérite pas qu'on lise
                // ce qu'il transporte. C'est la même fonction que l'application appelle.
                val code = SsoMobile.codeDuRetour(retour, etat).getOrThrow()
                val coffre = Coffre()
                val session = coffre.ouvrirUneSessionParSso(serveur, code, verificateur)
                println(session.email)
            }
            else -> {
                System.err.println(
                    "usage : pkce | terminer <serveur> <retour> <état> <verificateur>")
                kotlin.system.exitProcess(2)
            }
        }
    }

    private operator fun <T> List<T>.component4(): T = this[3]
}
