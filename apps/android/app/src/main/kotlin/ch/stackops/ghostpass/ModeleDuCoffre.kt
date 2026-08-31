package ch.stackops.ghostpass

import android.app.Application
import android.os.Build
import androidx.fragment.app.FragmentActivity
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

    /** L'enveloppe d'appareil d'ADR-0002 : ce qui rend le raccourci biométrique possible. */
    private val enveloppe = EnveloppeDeLAppareil(application)

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

    // ─── La biométrie (ADR-0002) ───

    /**
     * L'appareil peut-il porter le raccourci ?
     *
     * Deux conditions, et les séparer importe pour le message : le KeyStore doit savoir
     * tenir la politique (API 28), **et** une empreinte doit être enrôlée. La seconde est
     * la plus fréquente, et c'est celle qui produirait autrement une erreur de
     * cryptographie là où la phrase juste est « votre téléphone n'a pas d'empreinte ».
     */
    val biometriePossible: Boolean
        get() = enveloppe.possible && Biometrie.disponible(getApplication())

    /** Une enveloppe est-elle posée sur cet appareil ? */
    var biometrieActivee by mutableStateOf(false)
        private set

    init {
        biometrieActivee = enveloppe.activee
    }

    /**
     * Pose l'enveloppe. **Exige que le coffre soit déjà ouvert** — on n'enveloppe pas une
     * clé qu'on n'a pas.
     *
     * C'est le seul moment où l'utilisateur consent explicitement, et c'est pourquoi la clé
     * du KeyStore est régénérée ici : la politique appliquée est celle du code
     * d'aujourd'hui, pas celle du jour de la première activation.
     */
    fun activerLaBiometrie(activite: FragmentActivity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        val chiffreur = try {
            enveloppe.preparerLActivation()
        } catch (e: Exception) {
            message = "Cet appareil n'a pas pu préparer la clé : ${e.message}"
            return
        }
        Biometrie.demander(
            activite,
            titre = "Activer le déverrouillage biométrique",
            sousTitre = "GhostPass gardera la clé de votre coffre sous votre empreinte.",
            chiffreur = chiffreur,
            surSucces = { authentifie ->
                try {
                    enveloppe.activer(authentifie, coffre)
                    biometrieActivee = true
                    message = null
                } catch (e: Exception) {
                    enveloppe.oublier()
                    biometrieActivee = false
                    message = "L'activation a échoué : ${e.message}"
                }
            },
            surEchec = { texte -> if (texte != null) message = texte },
        )
    }

    /** Retire l'enveloppe. Le mot de passe maître redevient le seul chemin. */
    fun desactiverLaBiometrie() {
        enveloppe.oublier()
        biometrieActivee = false
    }

    /**
     * Rouvre le coffre par la biométrie, **sans réseau et sans mot de passe maître**.
     *
     * C'est le chemin qu'emprunte le service de remplissage quand le système le lie alors
     * que l'interface n'a jamais été ouverte, et c'est la raison d'être de tout l'ADR.
     *
     * @param surFin appelé dans tous les cas, avec le succès — le remplissage a besoin de
     *   savoir qu'il peut se replier sur le mot de passe maître.
     */
    fun deverrouillerParBiometrie(activite: FragmentActivity, surFin: (Boolean) -> Unit = {}) {
        val session = stockage.session()
        if (session == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            surFin(false)
            return
        }
        val dechiffreur = enveloppe.preparerLOuverture()
        if (dechiffreur == null) {
            // Soit rien n'était posé, soit la clé a été invalidée par un nouvel enrôlement
            // — et dans ce second cas [EnveloppeDeLAppareil] vient d'effacer le matériel.
            // Les deux mènent au même endroit : le mot de passe maître.
            biometrieActivee = false
            surFin(false)
            return
        }
        Biometrie.demander(
            activite,
            titre = "Déverrouiller GhostPass",
            sousTitre = session.email,
            chiffreur = dechiffreur,
            surSucces = { authentifie ->
                try {
                    enveloppe.ouvrir(authentifie, coffre, session, stockage.jeton())
                    deverrouille = true
                    message = null
                    rafraichir()
                    surFin(true)
                } catch (e: Exception) {
                    message = messageLisible(e)
                    surFin(false)
                }
            },
            surEchec = { texte ->
                if (texte != null) message = texte
                surFin(false)
            },
        )
    }

    // ─── Écrire dans le coffre ───

    /**
     * Crée ou remplace un élément, puis relit le coffre.
     *
     * @param id `null` pour une création, l'identité serveur pour une modification. Les
     *   séparer en deux méthodes ferait écrire deux fois la même traduction d'erreur ; les
     *   confondre côté serveur ferait un `POST` là où l'utilisateur croyait modifier, donc
     *   un doublon silencieux. D'où un paramètre explicite plutôt qu'une devinette sur un
     *   identifiant vide.
     */
    fun enregistrerUnElement(id: String?, element: ElementDuCoffre, surFin: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) {
                    if (id == null) coffre.creer(element) else coffre.mettreAJour(id, element)
                }
                rafraichir()
                surFin(true)
            } catch (e: Exception) {
                message = messageLisible(e)
                surFin(false)
            } finally {
                occupe = false
            }
        }
    }

    /** Met un élément à la corbeille du serveur. Il n'est pas détruit ; il sort de la liste. */
    fun supprimerUnElement(id: String, surFin: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) { coffre.supprimer(id) }
                rafraichir()
                surFin(true)
            } catch (e: Exception) {
                message = messageLisible(e)
                surFin(false)
            } finally {
                occupe = false
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
            // L'enveloppe part avec le reste. La laisser derrière ferait qu'une empreinte
            // rouvrirait le coffre d'un compte dont on vient de se déconnecter.
            enveloppe.oublier()
            biometrieActivee = false
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
        is ErreurApi.CoffreVerrouille ->
            "Le coffre est verrouillé. Déverrouillez-le avant d'écrire."
        is ErreurApi.Http -> e.message ?: "Erreur serveur."
        is uniffi.ghost_crypto_ffi.GhostCryptoException ->
            "Mot de passe maître incorrect."
        else -> e.message ?: "Une erreur est survenue."
    }
}
