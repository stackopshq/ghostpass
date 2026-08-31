package ch.stackops.ghostpass

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Ouvrir une session par SSO depuis l'application.
 *
 * Le contrat est `docs/sso-mobile.md` (branche `main` du serveur), et le pendant iOS est
 * `apps/ios/Ghostpass/Services/SsoMobile.swift`. Ce qu'il faut retenir ici :
 *
 * **Le PKCE couvre le saut application ↔ serveur**, et non application ↔ fournisseur
 * d'identité. C'est délibéré, et pour deux raisons qui se cumulent :
 *
 *  - l'IdP est Cloudflare Access for SaaS, qui n'enregistre aucun client OIDC public :
 *    chaque application reçoit un `client_secret`, donc l'application ne peut pas mener
 *    l'échange elle-même ;
 *  - sur Android comme sur iOS, **n'importe quelle application peut revendiquer un schéma
 *    d'URL personnalisé**. Le retour destiné à GhostPass est donc interceptable. S'il
 *    portait un jeton de session, l'intercepteur aurait le compte ; il ne porte qu'un code,
 *    qui ne vaut rien sans le vérificateur que seule cette application détient.
 *
 * Le SSO **authentifie ; il n'ouvre pas le coffre**. Celui-ci reste scellé sous le mot de
 * passe maître, demandé ensuite. Les confondre est la première erreur de conception d'un
 * client à connaissance nulle.
 *
 * ## Ce qui n'est pas de la cryptographie réécrite
 *
 * SHA-256 et le tirage aléatoire viennent de la plateforme (`MessageDigest`,
 * `SecureRandom`), comme ils viennent de CryptoKit côté iOS. Ce n'est pas une
 * implémentation du produit : c'est un condensé normalisé par la RFC 7636, dont le vecteur
 * de référence est dans [SsoMobileTest]. Le cœur Rust n'expose pas SHA-256 nu, et le lui
 * faire exposer pour ce seul usage coûterait plus qu'il ne protège.
 */
object SsoMobile {

    /**
     * Le schéma de retour, tel que le serveur l'a en liste blanche
     * (`SSO_MOBILE_REDIRECT_URIS`, défaut `ch.stackops.ghostpass://sso`).
     *
     * §8 du brief préfère un App Link vérifié (`https://`) quand l'instance le permet : lui
     * seul est réellement exclusif. Ce n'est **pas** ce qui est fait ici, et c'est un écart
     * assumé — la liste blanche du serveur est réglée sur ce schéma, et un App Link
     * exigerait de publier un `assetlinks.json` sur chaque instance auto-hébergée. C'est
     * précisément le genre d'exigence qu'un produit auto-hébergeable ne peut pas poser.
     *
     * Ce qui rend l'écart acceptable est le PKCE : un code intercepté est inerte.
     */
    const val SCHEMA = "ch.stackops.ghostpass"
    const val ADRESSE_DE_RETOUR = "$SCHEMA://sso"

    // ─── PKCE ───

    /** Un vérificateur et son défi, liés par SHA-256. */
    class Pkce private constructor(val verificateur: String) {
        /** `base64url(sha256(vérificateur))`, sans remplissage. */
        val defi: String = defiPour(verificateur)

        companion object {
            /** Tire un vérificateur aléatoire de 32 octets. */
            fun tirer(): Pkce = Pkce(chaineAleatoire(32))

            /** Utilisable avec un vérificateur imposé, pour éprouver contre la RFC 7636. */
            fun avec(verificateur: String): Pkce = Pkce(verificateur)
        }
    }

    /**
     * `base64url(sha256(v))` sans remplissage.
     *
     * SHA-256 rend 32 octets, soit exactement **43 caractères** en base64url — la longueur
     * que le serveur exige. Laisser le remplissage `=` en ferait 44 et le `start`
     * refuserait, ce qui est le bon comportement : un défi mal formé doit échouer là où il
     * arrive, pas trois étapes plus loin.
     */
    fun defiPour(verificateur: String): String =
        base64url(MessageDigest.getInstance("SHA-256").digest(verificateur.toByteArray(Charsets.UTF_8)))

    /**
     * Une chaîne aléatoire en base64url.
     *
     * `SecureRandom` et rien d'autre : tout le dispositif repose sur l'imprévisibilité de
     * cette valeur, et retomber sur un aléa faible serait pire que s'arrêter.
     */
    fun chaineAleatoire(octets: Int): String =
        base64url(ByteArray(octets).also { SecureRandom().nextBytes(it) })

    private fun base64url(donnees: ByteArray): String =
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(donnees)

    // ─── L'ouverture du flux ───

    /**
     * L'adresse d'ouverture, telle que le serveur l'attend.
     *
     * Le `state` est **opaque et tiré par l'application** : le serveur le range tel quel
     * pendant dix minutes dans `auth_ephemeral`. Y glisser une adresse de courriel ou un
     * identifiant de compte y écrirait une donnée personnelle dans un réceptacle qui n'est
     * pas prévu pour en porter — le serveur ne peut pas l'en empêcher.
     */
    fun adresseDeDepart(serveur: String, defi: String, etat: String): String {
        val base = serveur.removeSuffix("/")
        return base + "/api/auth/sso/mobile/start" +
            "?code_challenge=" + encoder(defi) +
            "&code_challenge_method=S256" +
            "&state=" + encoder(etat) +
            "&redirect_uri=" + encoder(ADRESSE_DE_RETOUR)
    }

    // ─── Le retour, et sa lecture ───

    /** Ce qui peut mal tourner au retour du navigateur. */
    sealed interface EchecDeRetour {
        /**
         * L'état rendu n'est pas celui qu'on a envoyé.
         *
         * Ce retour ne répond pas à *notre* demande, et l'accepter reviendrait à ouvrir une
         * session qu'un tiers a lancée. **Vérifié en premier** : un retour qui n'est pas le
         * nôtre ne mérite pas qu'on lise ce qu'il transporte.
         */
        data object EtatInattendu : EchecDeRetour

        /** Le retour ne porte pas de code. C'est **l'unique** critère d'échec restant. */
        data class SansCode(val motif: String?) : EchecDeRetour
    }

    /**
     * Lit le retour du navigateur.
     *
     * **L'échec est l'absence de `code`, pas la présence d'`error`.** Un client qui teste
     * `error` et poursuit sinon appellerait l'échange avec un code vide, et lirait le refus
     * du serveur comme une panne réseau plutôt que comme un rejet d'authentification. Le
     * serveur, lui, renvoie toujours par le schéma de l'application — une page d'erreur y
     * laisserait l'utilisateur bloqué dans une fenêtre qui ne se referme pas.
     */
    fun codeDuRetour(url: String, etatAttendu: String): Result<String> {
        val parametres = parametres(url)
        fun valeur(nom: String): String? = parametres[nom]?.ifEmpty { null }

        if (valeur("state") != etatAttendu) {
            return Result.failure(ErreurDeRetour(EchecDeRetour.EtatInattendu))
        }
        val code = valeur("code")
            ?: return Result.failure(ErreurDeRetour(EchecDeRetour.SansCode(valeur("error"))))
        return Result.success(code)
    }

    /** Une exception porteuse d'un [EchecDeRetour], pour tenir dans un `Result`. */
    class ErreurDeRetour(val echec: EchecDeRetour) : Exception(message(echec)) {
        companion object {
            fun message(echec: EchecDeRetour): String = when (echec) {
                EchecDeRetour.EtatInattendu ->
                    "La réponse ne correspond pas à la demande. Réessayez."
                is EchecDeRetour.SansCode -> when (echec.motif) {
                    // Le serveur ne crée jamais de compte par SSO : le coffre est scellé
                    // sous le mot de passe maître, donc un compte provisionné à la volée
                    // n'aurait rien à ouvrir — l'utilisateur verrait un coffre vide et
                    // croirait avoir perdu ses données.
                    "not_provisioned" ->
                        "Cette adresse n'a pas de compte GhostPass sur ce serveur."
                    else -> "L'authentification a échoué."
                }
            }
        }
    }

    /**
     * Les paramètres de requête d'une URL de retour, déséchappés.
     *
     * Écrit à la main pour la même raison que [LienOtpauth] : ce qui arrive ici vient du
     * dehors, et `java.net.URI` lève sur des formes qu'il vaut mieux refuser proprement.
     */
    private fun parametres(url: String): Map<String, String> {
        val requete = url.substringAfter('?', "").substringBefore('#')
        if (requete.isEmpty()) return emptyMap()
        val resultat = LinkedHashMap<String, String>()
        for (couple in requete.split('&')) {
            val egal = couple.indexOf('=')
            if (egal < 0) continue
            resultat[decoder(couple.substring(0, egal))] = decoder(couple.substring(egal + 1))
        }
        return resultat
    }

    private fun encoder(valeur: String): String =
        java.net.URLEncoder.encode(valeur, "UTF-8").replace("+", "%20")

    private fun decoder(valeur: String): String =
        try {
            java.net.URLDecoder.decode(valeur, "UTF-8")
        } catch (_: Exception) {
            valeur
        }
}
