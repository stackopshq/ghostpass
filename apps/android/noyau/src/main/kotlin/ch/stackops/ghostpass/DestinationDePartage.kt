package ch.stackops.ghostpass

/**
 * Le contrôle du domaine d'un lien de partage (docs/android.md §4).
 *
 * **C'est le point de sécurité le plus important du produit**, et il est contre-intuitif.
 * La clé de déchiffrement d'un partage voyage dans le **fragment** du lien, après le `#`.
 * Un navigateur n'envoie jamais le fragment dans la requête HTTP, ce qui donne l'illusion
 * qu'il est à l'abri du serveur — mais la *page* servie par ce domaine est du code que ce
 * domaine contrôle, et rien ne l'empêche de lire `location.hash`.
 *
 * Accepter sans contrôle l'adresse rendue par le serveur revient donc à **le laisser
 * désigner qui recevra la clé**. Il détient déjà le chiffré ; il obtiendrait le secret en
 * clair, et le partage à connaissance nulle n'aurait servi à rien.
 *
 * L'ancre de confiance est donc **le serveur que l'utilisateur a saisi lui-même**, jamais
 * ce que le serveur répond.
 */
object DestinationDePartage {

    /**
     * Le lien est-il de confiance pour ce serveur ?
     *
     * Trois règles, dans cet ordre :
     *
     *  1. **même hôte que le serveur configuré → accepté.** L'égalité est *exacte* : aucun
     *     rapprochement par suffixe, contrairement au remplissage automatique. C'est ce qui
     *     arrête `ghostpass.example.com.attaquant.example`, dont l'hôte *finit* par celui
     *     du serveur sans lui appartenir. La règle du remplissage
     *     ([RapprochementDeSite.memeSite]) serait ici une faille, et c'est pourquoi les
     *     deux ne partagent pas de code : elles se ressemblent et veulent l'inverse.
     *  2. **`https` exigé**, sauf si le serveur lui-même est en clair — le cas d'une
     *     instance en boucle locale. Un serveur en `https` dont le lien retombe en `http`
     *     est une rétrogradation, et elle reste refusée même pour un hôte approuvé :
     *     l'approbation porte sur *qui*, pas sur *comment*.
     *  3. **autre hôte → refusé**, sauf s'il figure parmi ceux que l'utilisateur a
     *     explicitement approuvés **pour ce serveur-là**.
     *
     * @param approuvesPourCeServeur les hôtes que l'utilisateur a validés pour ce serveur.
     *   Jamais une liste globale : approuver `ghostbit.example.com` pour l'instance de son
     *   entreprise ne doit rien autoriser sur l'instance d'un tiers.
     */
    fun estDeConfiance(
        lien: String,
        serveurConfigure: String,
        approuvesPourCeServeur: Set<String>,
    ): Boolean {
        val hoteDuLien = AdresseServeur.hote(lien) ?: return false
        val schemaDuLien = AdresseServeur.schema(lien) ?: return false
        val hoteDuServeur = AdresseServeur.hote(serveurConfigure) ?: return false
        val schemaDuServeur = AdresseServeur.schema(serveurConfigure) ?: return false

        // Un lien sans hôte — « https:///s/abc » — n'a pas de destinataire identifiable.
        if (hoteDuLien.isEmpty()) return false

        // Règle 2, appliquée avant toute acceptation : le serveur en clair est le seul à
        // pouvoir produire des liens en clair.
        if (schemaDuLien != "https" && schemaDuServeur == "https") return false
        if (schemaDuLien != "http" && schemaDuLien != "https") return false

        if (hoteDuLien == hoteDuServeur) return true
        return hoteDuLien in approuvesPourCeServeur
    }

    /**
     * Faut-il demander à l'utilisateur avant d'envoyer ce lien ?
     *
     * Distinct de [estDeConfiance] : un hôte inconnu se **montre** et se confirme, il ne se
     * refuse pas d'office. Un refus, lui, **révoque** le partage — qui existe déjà côté
     * serveur à cet instant, puisque c'est le serveur qui vient de le créer. L'oublier
     * laisserait derrière soi un secret publié que personne ne surveille.
     *
     * Une rétrogradation de schéma n'est jamais proposée : elle ne se confirme pas, elle
     * se refuse.
     */
    fun demandeUneConfirmation(lien: String, serveurConfigure: String, approuves: Set<String>): Boolean {
        if (estDeConfiance(lien, serveurConfigure, approuves)) return false
        val schemaDuLien = AdresseServeur.schema(lien) ?: return false
        val schemaDuServeur = AdresseServeur.schema(serveurConfigure) ?: return false
        if (schemaDuLien != "https" && schemaDuServeur == "https") return false
        return !AdresseServeur.hote(lien).isNullOrEmpty()
    }

    /**
     * L'adresse de repli quand le serveur ne rend qu'un identifiant (§4, compatibilité).
     *
     * Un serveur antérieur au relais rend `{ id }` seul : `url` et `deleteToken` sont donc
     * **optionnels**. On retombe sur `<serveur>/s/<id>` — de confiance par construction,
     * puisque c'est l'hôte que l'utilisateur a saisi — et **rien n'est écrit au registre
     * des partages** : sans jeton et sans route de révocation, une ligne y serait un vœu.
     */
    fun lienDeRepli(serveurConfigure: String, id: String): String =
        serveurConfigure.removeSuffix("/") + "/s/" + id
}
