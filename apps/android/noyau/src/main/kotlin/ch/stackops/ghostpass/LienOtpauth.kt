package ch.stackops.ghostpass

/**
 * Les liens `otpauth:` — l'étiquette qu'ils portent, et ce qu'on accepte d'eux.
 *
 * Port de `apps/ios/Ghostpass/Services/Totp.swift` (`etiquette`, `parse`, `depuisUnQrCode`),
 * avec les vecteurs d'`apps/ios/Tests/ContractTests.swift`, classe `EtiquetteOtpauthTests`,
 * repris **tels quels** dans [LienOtpauthTest]. Un vecteur qui change en traduisant est un
 * défaut, pas une adaptation.
 *
 * Pourquoi ce fichier vit dans `:noyau` : il n'a besoin d'aucune API Android, donc il
 * s'éprouve sur la JVM du poste en une seconde. Le service de remplissage, l'écran
 * d'édition et l'activité qui reçoit l'intention y lisent tous la même règle — trois copies
 * en divergeraient.
 *
 * ## Ce que le brief dit et que le code d'iOS ne fait pas
 *
 * Le test d'iOS s'appelle « seul un lien de TOTP est retenu ». Le code ne vérifie pas le
 * type : `depuisUnQrCode` écarte `otpauth-migration://`, exige le préfixe `otpauth://` et un
 * secret non vide — et rien d'autre. Un `otpauth://hotp/…?secret=…` passe donc, des deux
 * côtés. C'est porté à l'identique **parce que le porter à l'identique est la consigne**, et
 * signalé ici plutôt que corrigé d'un seul côté : deux clients qui accepteraient des liens
 * différents se comporteraient différemment sur le même QR code.
 */
object LienOtpauth {

    /** Ce qu'un lien dit du service et du compte. `null` veut dire « le lien n'en dit rien ». */
    data class Etiquette(val service: String? = null, val compte: String? = null)

    private const val PREFIXE = "otpauth://"
    private const val PREFIXE_EXPORT = "otpauth-migration://"

    /**
     * Le lien est-il un lien de second facteur que nous savons traiter ?
     *
     * Deux refus qui comptent, et le second est le plus facile à laisser passer :
     *
     *  - **l'export d'une application d'authentification** (`otpauth-migration://`) porte
     *    plusieurs comptes dans un protobuf compressé, que nous ne savons pas lire ;
     *  - **un lien sans secret** ne configure rien. L'accepter ouvrirait un formulaire vide
     *    en laissant croire qu'un code a été importé — l'utilisateur enregistrerait un
     *    élément sans second facteur et ne s'en apercevrait qu'au moment de s'en servir.
     */
    fun estUnLienDeTotp(uri: String): Boolean {
        val propre = uri.trim()
        if (propre.lowercase().startsWith(PREFIXE_EXPORT)) return false
        if (!propre.lowercase().startsWith(PREFIXE)) return false
        return !secret(propre).isNullOrEmpty()
    }

    /**
     * Le secret du lien, normalisé : sans espaces, en capitales.
     *
     * Le base32 est insensible à la casse et les applications qui l'affichent y mettent des
     * espaces pour le rendre lisible. Les garder ferait échouer le décodage, et l'erreur
     * apparaîtrait à la première génération de code — pas à l'enregistrement.
     */
    fun secret(uri: String): String? {
        val propre = uri.trim()
        if (!propre.lowercase().startsWith(PREFIXE)) return null
        val brut = parametre(propre, "secret") ?: return null
        val normalise = brut.filterNot { it.isWhitespace() }.uppercase()
        return normalise.ifEmpty { null }
    }

    /**
     * Le service et le compte que le lien annonce.
     *
     * **Le paramètre `issuer` l'emporte sur le chemin quand les deux se contredisent.** Un
     * service renommé met à jour le paramètre et laisse le chemin d'origine ; et le
     * paramètre n'a pas à être échappé, donc il ne peut pas être coupé par un deux-points
     * qui appartiendrait au nom.
     */
    fun etiquette(uri: String): Etiquette {
        val propre = uri.trim()
        if (!propre.lowercase().startsWith(PREFIXE)) return Etiquette()

        val emetteur = parametre(propre, "issuer")
        val chemin = chemin(propre)

        var service = emetteur
        var compte: String? = null
        val separateur = chemin.indexOf(':')
        if (separateur >= 0) {
            if (service == null) service = chemin.substring(0, separateur)
            compte = chemin.substring(separateur + 1)
        } else if (chemin.isNotEmpty()) {
            // Sans deux-points, le chemin est le compte.
            compte = chemin
        }
        return Etiquette(nettoyer(service), nettoyer(compte))
    }

    // ─── Analyse ───
    //
    // Écrite à la main plutôt que confiée à `java.net.URI`, pour la même raison que
    // `RapprochementDeSite.hote` : ce qui arrive ici vient de l'extérieur, souvent d'un QR
    // code, et `URI` lève sur des formes qu'il faut savoir refuser proprement plutôt que
    // laisser remonter une exception depuis un analyseur de la bibliothèque standard.

    /** Le chemin, **déjà déséchappé**, sans sa barre initiale. */
    private fun chemin(uri: String): String {
        val apresSchema = uri.substring(uri.indexOf("://") + 3)
        val avantRequete = apresSchema.substringBefore('?')
        val barre = avantRequete.indexOf('/')
        if (barre < 0) return ""
        return decoder(avantRequete.substring(barre + 1))
    }

    /** La valeur d'un paramètre de requête, déséchappée. */
    private fun parametre(uri: String, nom: String): String? {
        val requete = uri.substringAfter('?', "")
        if (requete.isEmpty()) return null
        for (couple in requete.split('&')) {
            val egal = couple.indexOf('=')
            if (egal < 0) continue
            if (decoder(couple.substring(0, egal)) == nom) {
                return decoder(couple.substring(egal + 1))
            }
        }
        return null
    }

    /**
     * Déséchappe les `%XX`, et **laisse les `+` tels quels**.
     *
     * `URLDecoder` traduirait `+` en espace, ce que fait un formulaire HTML et que ne fait
     * pas `URLComponents` côté iOS. Un secret base32 ne contient pas de `+`, mais un nom de
     * service peut en porter un — et il apparaîtrait alors avec une espace chez un client et
     * un `+` chez l'autre, sans que rien n'échoue.
     */
    private fun decoder(texte: String): String {
        if (!texte.contains('%')) return texte
        val octets = ArrayList<Byte>(texte.length)
        var i = 0
        while (i < texte.length) {
            val c = texte[i]
            if (c == '%' && i + 2 < texte.length) {
                val valeur = texte.substring(i + 1, i + 3).toIntOrNull(16)
                if (valeur != null) {
                    octets.add(valeur.toByte())
                    i += 3
                    continue
                }
            }
            // Un caractère non échappé se réencode en UTF-8 : le lien peut porter de
            // l'accentué en clair, et le recopier octet par octet le casserait.
            for (octet in c.toString().toByteArray(Charsets.UTF_8)) octets.add(octet)
            i++
        }
        return String(octets.toByteArray(), Charsets.UTF_8)
    }

    private fun nettoyer(valeur: String?): String? {
        val taille = valeur?.trim()
        return if (taille.isNullOrEmpty()) null else taille
    }
}
