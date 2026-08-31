package ch.stackops.ghostpass

import java.net.URI

/**
 * L'adresse du serveur, telle qu'on peut raisonnablement l'écrire.
 *
 * Port de `apps/ios/Ghostpass/Services/ServerAddress.swift`, règle pour règle.
 *
 * Quelqu'un qui tape le nom de son serveur — le geste naturel — écrit
 * « ghostpass.stackops.ch », sans schéma. `URI` l'accepte sans broncher et en fait une URI
 * *relative*, sans hôte : rien n'échoue tout de suite, tout se casse plus tard, en
 * construisant une requête dessus, avec un message qui accuse l'adresse sans dire ce qui
 * lui manque.
 *
 * On complète donc ce qui manque plutôt que de refuser : `https` par défaut, espaces
 * retirés, barre oblique finale enlevée.
 */
object AdresseServeur {

    /** Rend une adresse utilisable, ou `null` si rien de sensé ne peut en être tiré. */
    fun normaliser(saisie: String): String? {
        val propre = saisie.trim()
        if (propre.isEmpty()) return null

        // `https` par défaut — sauf en boucle locale, où le défaut sensé est `http`.
        //
        // Un serveur de développement sur `127.0.0.1` parle en clair : lui imposer `https`
        // produit une erreur TLS, un message qui décrit la conséquence et cache la cause.
        // L'exception s'arrête à la boucle locale : un serveur sur un réseau privé peut
        // légitimement être en `https` avec son propre certificat, et rétrograder son
        // adresse serait un service qu'on ne rend à personne.
        val avecSchema =
            if (propre.contains("://")) propre
            else (if (estEnBoucleLocale(propre)) "http://" else "https://") + propre

        // Une barre finale double les séparateurs des chemins construits ensuite.
        val sansBarre = avecSchema.removeSuffix("/")

        val uri = try {
            URI(sansBarre)
        } catch (_: Exception) {
            return null
        }
        val hote = uri.host ?: return null
        if (hote.isEmpty()) return null
        val schema = uri.scheme ?: return null
        if (schema != "http" && schema != "https") return null
        return sansBarre
    }

    /**
     * L'hôte désigne-t-il cette machine ? On coupe au premier « : » ou « / » pour ignorer
     * un port ou un chemin.
     */
    private fun estEnBoucleLocale(saisie: String): Boolean {
        val hote = saisie.split(':', '/').firstOrNull()?.lowercase() ?: return false
        return hote == "localhost" || hote == "127.0.0.1" || hote == "[::1]" || hote == "::1"
    }

    /**
     * L'adresse telle qu'on l'enregistre et l'affiche : normalisée, ou la saisie brute si
     * elle ne mène à rien — mieux vaut réafficher ce qui a été tapé que de le perdre.
     */
    fun pourAffichage(saisie: String): String = normaliser(saisie) ?: saisie.trim()

    /** L'hôte d'une adresse, ou `null` si elle n'en porte pas. Sert à l'ancre de confiance. */
    fun hote(adresse: String): String? =
        try {
            URI(adresse).host?.lowercase()?.ifEmpty { null }
        } catch (_: Exception) {
            null
        }

    /** Le schéma d'une adresse, en minuscules. */
    fun schema(adresse: String): String? =
        try {
            URI(adresse).scheme?.lowercase()
        } catch (_: Exception) {
            null
        }
}
