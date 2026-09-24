package ch.stackops.ghostpass

import java.net.URLEncoder

/**
 * L'adresse à laquelle demander l'icône d'un site — à **notre** serveur, jamais à un tiers.
 *
 * Port de `apps/ios/Ghostpass/Services/Favicon.swift`, règle pour règle. Demander une
 * icône à Google ou à un service de favicons reviendrait à lui annoncer les sites que
 * contient le coffre, un par un. Le serveur de la suite expose donc son propre relais
 * (`GET /api/icons?domain=…`), qui va chercher l'icône et la met en cache : aucun tiers ne
 * voit les domaines.
 *
 * Le serveur, lui, les voit — c'est le prix de l'icône, et la raison pour laquelle
 * l'affichage se coupe depuis les réglages. Un coffre chiffré de bout en bout ne dit rien
 * de son contenu au serveur ; les requêtes d'icônes, elles, en disent quelque chose.
 */
object IconeDeSite {

    /**
     * L'adresse du relais pour cet URI, ou `null` s'il n'y a pas de domaine exploitable
     * **ou pas de jeton**.
     *
     * Le jeton n'est pas une politesse. Depuis que le serveur a fermé l'oracle temporel de
     * cette route — publique, et son cache indexé sur le seul domaine, si bien que le
     * **temps de réponse** disait si quelqu'un avait ce domaine dans son coffre — une
     * requête sans `t` reçoit `401`.
     *
     * Le rendre facultatif ferait tirer une requête vouée à l'échec par élément de la
     * liste, et la seule trace visible serait une pastille d'initiale — c'est-à-dire le
     * repli prévu pour « ce site n'a pas d'icône ». Un contrat rompu porterait alors
     * l'apparence d'un cas nominal, sur tous les éléments à la fois. C'est ce qui est
     * arrivé sur iOS, et c'est pourquoi l'absence de jeton rend `null` plutôt qu'une URL.
     *
     * Le jeton passe par l'URL parce qu'une image ne porte pas d'en-tête d'autorisation ;
     * il ne nomme l'utilisateur que pour cloisonner le cache du serveur, et n'ouvre rien
     * d'autre.
     */
    fun url(adresse: String, serveur: String, jeton: String?): String? {
        if (jeton.isNullOrEmpty()) return null
        val hote = RapprochementDeSite.hote(adresse)
        if (!estUnDomainePublic(hote)) return null
        // Une adresse de serveur vide, ou sans hôte, donnerait « /api/icons?… » qui ne mène
        // nulle part. `normaliser` exige l'hôte : c'est la même porte que ferme iOS avec
        // `composants.host != nil`.
        val base = AdresseServeur.normaliser(serveur) ?: return null
        // Concaténation, et non remplacement du chemin : c'est la règle de [ClientApi], et
        // c'est elle qui fait marcher un serveur monté sous un sous-chemin. iOS pose
        // `composants.path = "/api/icons"`, ce qui *écrase* le préfixe — une divergence qui
        // n'apparaît que sur un déploiement en sous-chemin, où le client Android a raison.
        return base + "/api/icons?domain=" + encoder(hote) + "&t=" + encoder(jeton)
    }

    /**
     * Un domaine public, au sens où le relais l'entend : des labels séparés par des points
     * et une extension alphabétique. La règle est celle du serveur, appliquée ici pour ne
     * pas lui envoyer une requête qu'il refusera.
     *
     * Elle écarte « localhost », les noms de machine du réseau local et les adresses IP —
     * littérales ou entre crochets. Demander au serveur d'aller chercher une icône sur une
     * IP privée n'aurait aucun sens, et lui apprendrait l'adressage du réseau de
     * l'utilisateur pour rien.
     */
    fun estUnDomainePublic(hote: String): Boolean {
        if (hote.startsWith("[") || !hote.contains(".")) return false
        val labels = hote.split(".")
        if (labels.size < 2) return false
        val suffixe = labels.last()
        if (suffixe.length < 2) return false
        return suffixe.all { it.isLetter() }
    }

    /**
     * La clé de cache d'une icône : le **domaine**, jamais l'URL.
     *
     * L'URL porte le jeton, et le jeton change à chaque rafraîchissement du coffre. Une
     * mémoire indexée dessus manquerait toutes ses entrées une fois par rafraîchissement,
     * et regarnirait son contenu à chaque fois — soit exactement le trafic que le cache
     * existe pour éviter. Indexer sur le domaine garde aussi le jeton hors de la clé.
     */
    fun cle(adresse: String): String? {
        val hote = RapprochementDeSite.hote(adresse)
        return if (estUnDomainePublic(hote)) hote else null
    }

    /**
     * L'initiale affichée à défaut d'icône. Un nom vide donne un point d'interrogation
     * plutôt qu'une pastille muette.
     */
    fun initiale(nom: String): String {
        val propre = nom.trim()
        if (propre.isEmpty()) return "?"
        return propre.take(1).uppercase()
    }

    private fun encoder(valeur: String): String = URLEncoder.encode(valeur, "UTF-8")
}
