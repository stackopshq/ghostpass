package ch.stackops.ghostpass

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * L'état du coffre tel que les écrans le voient.
 *
 * Le pendant de `VaultStore` côté iOS, réduit à ce que les trois jalons demandent :
 * ouverture de session, déverrouillage hors ligne, liste. Tout ce qui fait vraiment
 * quelque chose vit dans [Coffre], qui est éprouvé sur la JVM du poste — ici il ne reste
 * que le passage au fil d'exécution et la traduction des erreurs.
 */
class ModeleDuCoffre(application: Application) : AndroidViewModel(application) {

    private val coffre = Coffre()
    private val stockage = StockageDeSession(application)

    var occupe by mutableStateOf(false)
        private set
    var deverrouille by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
    var secondFacteurRequis by mutableStateOf(false)
        private set
    var lecture by mutableStateOf(LectureDuCoffre())
        private set

    /** La liste affichée vient-elle du cache plutôt que du serveur ? */
    var horsLigne by mutableStateOf(false)
        private set

    /** Une session est-elle déjà enregistrée sur cet appareil ? */
    val sessionEnregistree: Coffre.Session? get() = stockage.session()

    val emailEnregistre: String get() = sessionEnregistree?.email ?: ""
    val serveurEnregistre: String get() = sessionEnregistree?.adresseServeur ?: ""

    /**
     * Ouverture de session complète.
     *
     * Le réseau et le cœur travaillent hors du fil principal : la dérivation Argon2id
     * demande 64 MiB et trois passes, ce qui gèlerait l'interface pendant une seconde ou
     * plus sur un appareil modeste. Android tuerait l'application avant qu'elle n'ait fini.
     */
    fun ouvrirUneSession(serveur: String, email: String, motDePasse: String, codeTotp: String?) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                val session = withContext(Dispatchers.IO) {
                    coffre.ouvrirUneSession(serveur, email, motDePasse, codeTotp)
                }
                withContext(Dispatchers.IO) {
                    // Le jeton est déjà dans le coffre ; on le relit par la session pour
                    // l'écrire au stockage.
                    stockage.enregistrer(session, coffre.jetonCourant.orEmpty())
                }
                deverrouille = true
                secondFacteurRequis = false
                rafraichir()
            } catch (e: ErreurApi.SecondFacteurRequis) {
                // Le serveur ne réclame le second facteur qu'après validation du mot de
                // passe : le champ n'apparaît donc qu'une fois utile.
                secondFacteurRequis = true
                message = "Entrez le code à six chiffres de votre application d'authentification."
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /** Réouverture d'une session connue, avec le seul mot de passe maître, sans réseau. */
    fun deverrouillerHorsLigne(motDePasse: String) {
        val session = stockage.session() ?: return
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) {
                    coffre.rouvrirHorsLigne(session, motDePasse, stockage.jeton())
                }
                deverrouille = true
                rafraichir()
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Va chercher le coffre, et **montre le dernier connu si le réseau manque**.
     *
     * L'ordre compte : on affiche d'abord le cache, puis on remplace par ce que le serveur
     * rend. Un déverrouillage hors ligne montre donc le coffre au lieu d'une liste vide.
     * Une liste vide se lit « vous n'avez rien enregistré » — c'est faux, et c'est ce qui
     * fait recréer un identifiant qui existe déjà.
     *
     * [horsLigne] dit lequel des deux on regarde. Le taire laisserait croire que la liste
     * est à jour alors qu'elle date du dernier passage.
     */
    fun rafraichir() {
        viewModelScope.launch {
            if (lecture.entrees.isEmpty()) {
                val cache = withContext(Dispatchers.IO) { stockage.elementsEnCache() }
                if (cache != null) {
                    lecture = coffre.relire(cache)
                    horsLigne = true
                }
            }
            try {
                val elements = withContext(Dispatchers.IO) { coffre.elementsDistants() }
                withContext(Dispatchers.IO) { stockage.mettreEnCache(elements) }
                lecture = coffre.relire(elements)
                horsLigne = false
                message = null
            } catch (e: Exception) {
                horsLigne = true
                // Le coffre reste affiché tel qu'il est : une erreur de réseau ne doit pas
                // vider une liste déjà lue. Le message ne se pose que si l'on n'a vraiment
                // rien à montrer — sinon il crie à côté d'une liste parfaitement utilisable.
                message = if (lecture.entrees.isEmpty()) messageLisible(e) else null
            }
        }
    }

    fun verrouiller() {
        coffre.verrouiller()
        deverrouille = false
        lecture = LectureDuCoffre()
    }

    fun fermerLaSession() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { coffre.fermerLaSession() }
            stockage.oublier()
            deverrouille = false
            lecture = LectureDuCoffre()
        }
    }

    /**
     * Ce qu'on montre à l'utilisateur quand quelque chose échoue.
     *
     * Un message d'exception brut — « Failed to connect to /10.0.2.2:3111 » — ne dit rien à
     * qui a simplement tapé une adresse fausse. On nomme la cause quand on la connaît, et on
     * laisse passer le message du serveur quand il en a un : lui sait pourquoi il a refusé.
     */
    private fun messageLisible(e: Exception): String = when (e) {
        is ErreurApi.AdresseInvalide ->
            "Adresse de serveur invalide. Exemple : ghostpass.example.com"
        is ErreurApi.Reseau ->
            "Serveur injoignable. Vérifiez l'adresse et votre connexion."
        is ErreurApi.Http -> e.message ?: "Erreur serveur."
        is uniffi.ghost_crypto_ffi.GhostCryptoException ->
            "Mot de passe maître incorrect."
        else -> e.message ?: "Une erreur est survenue."
    }
}
