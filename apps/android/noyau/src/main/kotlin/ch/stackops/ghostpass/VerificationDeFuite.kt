package ch.stackops.ghostpass

import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Vérification de fuite auprès de Have I Been Pwned, **en k-anonymat**.
 *
 * Transposition de `apps/web/src/lib/breach.ts` et de `apps/ios/Ghostpass/Services/Breach.swift`.
 * Seuls les **cinq premiers caractères** du SHA-1 du mot de passe partent sur le réseau ; le
 * mot de passe — et même son empreinte complète — ne quitte jamais l'appareil. Le service
 * renvoie tous les suffixes connus pour ce préfixe, et la comparaison se fait ici.
 *
 * ## C'est le seul endroit de l'application qui parle à un tiers
 *
 * L'appel n'a donc **jamais lieu tout seul**. Il faut que quelqu'un demande explicitement la
 * vérification, sur un bouton. Un écran de santé qui interrogerait HIBP à son ouverture
 * ferait sortir de l'appareil un préfixe par mot de passe sans que personne ne l'ait voulu,
 * et le ferait en silence — exactement ce qu'un gestionnaire de mots de passe ne doit pas se
 * permettre.
 *
 * SHA-1 est cassé pour signer, mais l'API de HIBP est indexée ainsi et une empreinte n'est
 * ici qu'une clef de recherche. Rien de tout cela ne touche au coffre : le chiffrement reste
 * l'affaire du cœur Rust.
 */
object VerificationDeFuite {

    const val HOTE = "https://api.pwnedpasswords.com"

    /** La coupure du k-anonymat : cinq caractères partent, trente-cinq restent. */
    const val LONGUEUR_DU_PREFIXE = 5

    class Indisponible(cause: String) : Exception(cause)

    /**
     * L'empreinte coupée en deux — ce qui part, et ce qui reste.
     *
     * Elle est rendue plutôt que cachée dans l'appel réseau, et c'est **ce qui rend la
     * garantie éprouvable**. Une promesse de k-anonymat enfouie dans une fonction qui ouvre
     * une connexion ne se vérifie qu'en regardant passer les octets ; sortie ici, elle se
     * vérifie en trois lignes de test, et un jour où quelqu'un enverrait l'empreinte entière
     * par mégarde, le test le dirait.
     */
    data class Empreinte(val prefixe: String, val suffixe: String) {
        val entiere: String get() = prefixe + suffixe
    }

    fun empreinte(motDePasse: String): Empreinte {
        val octets = MessageDigest.getInstance("SHA-1").digest(motDePasse.toByteArray(Charsets.UTF_8))
        // Majuscules : le service rend ses suffixes ainsi, et une comparaison sur des
        // minuscules ne correspondrait **jamais**. L'écran dirait alors « aucun mot de passe
        // connu des fuites » — un repli silencieux, et le plus rassurant de tous.
        val hexa = octets.joinToString("") { "%02X".format(it) }
        return Empreinte(hexa.take(LONGUEUR_DU_PREFIXE), hexa.drop(LONGUEUR_DU_PREFIXE))
    }

    /**
     * Le nombre d'apparitions de ce mot de passe dans des fuites connues — 0 s'il n'y figure
     * pas.
     *
     * @throws Indisponible quand le service ne répond pas. **On ne rend pas 0 dans ce cas**,
     *   et c'est la décision qui compte ici : 0 veut dire « vérifié, rien trouvé », et le
     *   rendre après un échec réseau afficherait « aucun mot de passe connu des fuites » à
     *   quelqu'un dont on n'a rien vérifié du tout. C'est le `catch` qui retombe sur un état
     *   d'apparence normale — celui qui rassure tout en rendant la garantie invisible.
     */
    fun compteDeFuites(motDePasse: String, lecteur: (String) -> String = ::telecharger): Int {
        if (motDePasse.isEmpty()) return 0
        val empreinte = empreinte(motDePasse)
        val corps = lecteur("$HOTE/range/${empreinte.prefixe}")
        for (ligne in corps.lineSequence()) {
            val morceaux = ligne.trim().split(':')
            if (morceaux.size != 2) continue
            if (!morceaux[0].equals(empreinte.suffixe, ignoreCase = true)) continue
            return morceaux[1].trim().toIntOrNull() ?: 0
        }
        return 0
    }

    private fun telecharger(adresse: String): String {
        val connexion = try {
            URL(adresse).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw Indisponible(e.message ?: "connexion impossible")
        }
        return try {
            connexion.requestMethod = "GET"
            // Le service ajoute alors des entrées factices : la **taille** de la réponse
            // cesse de renseigner sur le nombre de correspondances réelles. Sans cet
            // en-tête, un observateur du réseau apprendrait quelque chose de la longueur du
            // paquet, ce qui viderait le k-anonymat d'une partie de son sens.
            connexion.setRequestProperty("Add-Padding", "true")
            connexion.connectTimeout = 15_000
            connexion.readTimeout = 15_000
            val statut = connexion.responseCode
            if (statut !in 200..299) throw Indisponible("le service a répondu $statut")
            connexion.inputStream.bufferedReader().readText()
        } catch (e: Indisponible) {
            throw e
        } catch (e: Exception) {
            throw Indisponible(e.message ?: "lecture impossible")
        } finally {
            connexion.disconnect()
        }
    }

    /**
     * Les mots de passe compromis parmi ces lignes de coffre.
     *
     * **Un appel par mot de passe distinct**, et non par élément : deux comptes qui
     * partagent le même mot de passe ne valent qu'une requête, et le service n'apprend rien
     * de plus. Faire l'inverse doublerait le trafic pour rien — et, sur un coffre où la
     * réutilisation est justement le problème qu'on cherche, dirait au service combien de
     * fois chaque préfixe revient.
     */
    fun compromis(
        entrees: List<EntreeDuCoffre>,
        lecteur: (String) -> String = ::telecharger,
    ): List<EntreeDuCoffre.Lisible> {
        val lisibles = entrees
            .filterIsInstance<EntreeDuCoffre.Lisible>()
            .filterNot { it.element.estUnRegistre }
        val distincts = lisibles
            .mapNotNull { it.element.identifiants?.password }
            .filter { it.isNotEmpty() }
            .toSet()
        val comptes = distincts.associateWith { compteDeFuites(it, lecteur) }
        return lisibles.filter { (comptes[it.element.identifiants?.password] ?: 0) > 0 }
    }
}
