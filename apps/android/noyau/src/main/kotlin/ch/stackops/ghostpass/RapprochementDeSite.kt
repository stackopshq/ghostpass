package ch.stackops.ghostpass

/**
 * Rapprochement entre l'adresse d'un champ de saisie et les adresses d'un item.
 *
 * Port de `apps/ios/Ghostpass/Services/SiteMatching.swift`. Partagé par l'application et
 * le service de remplissage : c'est le même code qui décide, des deux côtés, si un
 * identifiant vaut pour un site. Deux règles qui divergeraient donneraient des
 * suggestions différentes selon l'endroit d'où l'on regarde.
 *
 * **La règle n'utilise aucune liste de suffixes publics**, et c'est un choix assumé plutôt
 * qu'un oubli (docs/android.md §6). Ses deux conséquences, mesurées côté iOS :
 *
 *  - deux domaines frères ne sont jamais rapprochés — `mail.google.com` ne propose rien
 *    sur `accounts.google.com`. C'est un faux **négatif**, le défaut le plus visible à
 *    l'usage : l'utilisateur voit une liste vide et tape son mot de passe à la main ;
 *  - un hôte qui *est* un suffixe public, comme `github.io`, correspond à tout ce qui est
 *    dessous. C'est un faux **positif**, mais il reste borné : il faut d'abord qu'un item
 *    porte `github.io` nu comme adresse.
 *
 * Le remplacer par une liste de suffixes publics est une décision à prendre pour la suite
 * entière, pas pour un client : deux clients qui rapprocheraient différemment
 * proposeraient des identifiants différents sur la même page.
 */
object RapprochementDeSite {

    /**
     * Ramène une URL ou un domaine à son hôte : minuscules, sans schéma, sans chemin, sans
     * requête, sans port, sans `www.`.
     *
     * Écrit à la main plutôt que confié à `URI` : ce qui arrive ici est parfois un domaine
     * nu (`git.stackops.ch`), que `URI` range en chemin et dont il rend un hôte nul.
     */
    fun hote(valeur: String): String {
        var texte = valeur.trim().lowercase()
        val separateur = texte.indexOf("://")
        if (separateur >= 0) texte = texte.substring(separateur + 3)
        texte = texte.substringBefore('/')
        texte = texte.substringBefore('?')
        // Un IPv6 entre crochets n'a pas de port à retirer de cette façon.
        if (!texte.startsWith("[")) texte = texte.substringBefore(':')
        if (texte.startsWith("www.")) texte = texte.substring(4)
        return texte
    }

    /**
     * `login.example.com` doit correspondre à `example.com` : les sites déplacent leur
     * formulaire d'authentification sur un sous-domaine sans prévenir personne.
     *
     * Le point du suffixe est ce qui tient la règle : sans lui, `notexample.com` finirait
     * par `example.com` et serait rapproché. C'est le piège de
     * `ghostpass.example.com.attaquant.example`, sous une autre forme.
     */
    fun memeSite(a: String, b: String): Boolean {
        if (a.isEmpty() || b.isEmpty()) return false
        return a == b || a.endsWith(".$b") || b.endsWith(".$a")
    }

    /** L'item convient-il à l'un des domaines demandés ? */
    fun correspond(element: ElementDuCoffre, domaines: List<String>): Boolean {
        val identifiants = element.identifiants ?: return false
        val cibles = domaines.map(::hote).filter { it.isNotEmpty() }
        if (cibles.isEmpty()) return false
        val adresses = identifiants.uris.map(::hote).filter { it.isNotEmpty() }
        return adresses.any { adresse -> cibles.any { memeSite(adresse, it) } }
    }
}
