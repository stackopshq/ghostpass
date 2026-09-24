package ch.stackops.ghostpass

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ch.stackops.ghostpass.ui.oublierLesIcones

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

    /**
     * Le jeton qui autorise les requêtes d'icônes. `null` tant qu'on ne l'a pas.
     *
     * Sans lui, [IconeDeSite.url] ne fabrique **aucune** URL, et la pastille reste une
     * initiale : c'est le point, et pas une précaution. Une URL sans jeton tirerait une
     * requête vouée au 401 par élément de la liste, et la seule trace visible serait
     * l'initiale — c'est-à-dire le repli prévu pour « ce site n'a pas d'icône ». Le contrat
     * rompu porterait l'apparence d'un cas nominal, sur tous les éléments à la fois.
     */
    var jetonDIcone by mutableStateOf<String?>(null)
        private set

    /** L'adresse du serveur, pour y accrocher les URL d'icônes. */
    val serveurDesIcones: String get() = coffre.adresseDuServeur ?: serveurEnregistre

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
                // Les coffres d'équipe se chargent avec le coffre personnel, **et leur
                // contenu avec eux**. Sans cela, quelqu'un dont les mots de passe vivent en
                // équipe voit une liste vide et conclut que l'application ne marche pas.
                chargerLesCoffresDEquipe()
                rafraichirLeJetonDIcone()
            } catch (e: Exception) {
                horsLigne = true
                // Le coffre reste affiché tel qu'il est : une erreur de réseau ne doit pas
                // vider une liste déjà lue. Le message ne se pose que si l'on n'a vraiment
                // rien à montrer — sinon il crie à côté d'une liste parfaitement utilisable.
                message = if (lecture.entrees.isEmpty()) messageLisible(e) else null
            }
        }
    }

    /**
     * Redemande le jeton d'icône, **à chaque rafraîchissement** et non à son expiration.
     *
     * Le serveur le signe avec `ICON_TOKEN_SECRET` si l'exploitant l'a posé ; sinon il tire
     * sa clé au démarrage, et tous les jetons meurent au redémarrage **sans avoir expiré**.
     * Se fier à `expiresAt` laisserait les icônes muettes jusqu'à douze heures — et muettes
     * veut dire « une liste d'initiales », qui est aussi ce qu'on voit quand tout va bien.
     *
     * Un échec ne dit rien à l'utilisateur : la liste reste lisible, et une bannière pour
     * des logos serait du bruit. En revanche il ne faut **pas** garder l'ancien jeton : un
     * jeton invalide fait tirer une requête par élément visible, toutes rejetées, pour le
     * même résultat à l'écran.
     */
    private suspend fun rafraichirLeJetonDIcone() {
        jetonDIcone = withContext(Dispatchers.IO) { coffre.jetonDIcone() }
    }

    // ─── Le SSO (§8, docs/sso-mobile.md) ───

    /** Ce qu'on garde entre l'ouverture du navigateur et le retour. */
    private class SsoEnCours(
        val adresse: String,
        val pkce: SsoMobile.Pkce,
        val etat: String,
    )

    /**
     * Le vérificateur PKCE et l'état, **en mémoire de ce processus uniquement**.
     *
     * Ils ne s'écrivent nulle part, et c'est le point : « le code intercepté ne vaut rien
     * sans le vérificateur, qui ne quitte jamais l'application ». L'écrire sur le disque le
     * ferait sortir de cette phrase.
     *
     * Conséquence assumée : si le système tue le processus pendant que l'onglet est ouvert,
     * le retour ne trouve plus rien et l'utilisateur doit recommencer. C'est le bon
     * arbitrage — recommencer coûte dix secondes, persister coûterait la garantie.
     */
    private var ssoEnCours: SsoEnCours? = null

    /**
     * Compté plutôt que booléen : l'écran doit réagir **à chaque** session ouverte par SSO,
     * et un booléen déjà vrai ne redéclencherait rien.
     */
    var identitesVerifiees by mutableStateOf(0)
        private set

    /**
     * Ouvre le flux SSO dans un onglet de navigateur.
     *
     * On interroge d'abord `/api/auth/sso/status` : une instance sans SSO répond `false`, et
     * ouvrir un navigateur sur un `404` laisserait l'utilisateur devant une page d'erreur
     * qu'il ne peut pas interpréter.
     */
    fun demarrerLeSso(contexte: Context, serveurSaisi: String) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                val adresse = AdresseServeur.normaliser(serveurSaisi)
                    ?: throw ErreurApi.AdresseInvalide()
                val actif = withContext(Dispatchers.IO) { ClientApi(adresse).statutSso() }
                if (!actif) {
                    message = "Ce serveur n'a pas d'authentification unique configurée."
                    return@launch
                }
                val pkce = SsoMobile.Pkce.tirer()
                val etat = SsoMobile.chaineAleatoire(16)
                ssoEnCours = SsoEnCours(adresse, pkce, etat)
                // Le schéma de retour suit l'identifiant du paquet, jamais une constante
                // écrite à côté : une variante suffixée ne recevrait pas le retour, et le
                // navigateur se refermerait sans rien dire.
                OngletSecurise.ouvrir(
                    contexte,
                    SsoMobile.adresseDeDepart(
                        adresse, pkce.defi, etat, paquet = getApplication<Application>().packageName),
                )
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Le retour du navigateur.
     *
     * L'état est vérifié par [SsoMobile.codeDuRetour] **avant** que quoi que ce soit d'autre
     * du retour ne soit lu, et l'échange n'a lieu qu'ensuite. Le mot de passe maître reste
     * à demander : le SSO authentifie, il n'ouvre pas le coffre.
     */
    fun terminerLeSso(url: String) {
        val encours = ssoEnCours
        if (encours == null) {
            // Un retour sans demande en cours : soit le processus a été tué, soit ce retour
            // ne vient pas de nous. Dans les deux cas, il n'y a pas de vérificateur, donc
            // rien à échanger — et le dire vaut mieux qu'un écran qui ne bouge pas.
            message = "Cette authentification n'a pas été demandée depuis cet appareil. " +
                "Recommencez."
            return
        }
        ssoEnCours = null
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                val code = SsoMobile.codeDuRetour(url, encours.etat).getOrThrow()
                val session = withContext(Dispatchers.IO) {
                    coffre.ouvrirUneSessionParSso(encours.adresse, code, encours.pkce.verificateur)
                }
                withContext(Dispatchers.IO) {
                    stockage.enregistrer(session, coffre.jetonCourant.orEmpty())
                }
                identitesVerifiees += 1
                message = "Identité vérifiée. Entrez votre mot de passe maître pour ouvrir " +
                    "le coffre."
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    // ─── Les liens de second facteur (§9) ───

    /**
     * Le lien `otpauth:` reçu du système, **retenu jusqu'à ce qu'un écran sache l'afficher**.
     *
     * C'est la première des trois règles du §9, et celle qui se remarque à l'usage : on
     * scanne un QR code, le système réveille l'application, qui demande d'abord le mot de
     * passe maître. Jeter le lien à ce moment-là fait qu'on déverrouille pour rien —
     * l'utilisateur se retrouve devant son coffre sans savoir ce qui vient de se passer, et
     * doit rescanner.
     *
     * Il vit dans le modèle et non dans l'activité : le modèle survit à une rotation, et une
     * rotation pendant la saisie du mot de passe maître est exactement le moment où l'on
     * perdrait le lien.
     */
    var lienEnAttente by mutableStateOf<String?>(null)
        private set

    /**
     * Retient un lien venu du dehors, **s'il est de ceux qu'on sait traiter** — et **dit
     * pourquoi** quand il ne l'est pas.
     *
     * Retenir un lien qu'on ne saura pas ouvrir ferait apparaître un formulaire vide après
     * le déverrouillage, ce qui est pire que ne rien faire. Mais le refuser *en silence*
     * n'est pas mieux : l'utilisateur vient de scanner un QR code et de choisir GhostPass
     * pour l'ouvrir. Une application qui s'ouvre et ne réagit pas se lit comme une panne, et
     * il rescannera.
     *
     * D'où les trois états de [LienOtpauth.Lecture] plutôt qu'un booléen. Celui de l'export
     * d'application a son message à lui : il dit **quoi faire**, là où l'autre dirait
     * seulement que ça ne va pas — et c'est le cas de quelqu'un qui a fait exactement le
     * geste qu'on lui a appris.
     */
    fun retenirLeLien(uri: String?) {
        if (uri == null) return
        when (LienOtpauth.lire(uri)) {
            is LienOtpauth.Lecture.SecondFacteur -> {
                lienEnAttente = uri
                message = null
            }
            LienOtpauth.Lecture.ExportDApplication ->
                message = "Ce QR code est un export d'application d'authentification, qui " +
                    "porte plusieurs comptes à la fois. GhostPass ne sait pas le lire : " +
                    "exportez les comptes un par un."
            LienOtpauth.Lecture.AutreChose ->
                message = "Ce lien n'est pas un second facteur utilisable — il lui manque " +
                    "un secret, ou il n'est pas de type « totp »."
        }
    }

    /**
     * Rend le lien retenu et l'oublie.
     *
     * L'oubli est ce qui empêche l'écran d'édition de se rouvrir à chaque recomposition —
     * et, plus important, de se rouvrir après que l'utilisateur l'a annulé. Un formulaire
     * qui revient tout seul se lit comme un refus de la décision qu'on vient de prendre.
     */
    fun consommerLeLien(): String? {
        val lien = lienEnAttente
        lienEnAttente = null
        return lien
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

    // ─── Les coffres d'équipe ───

    /** Les organisations, invitations comprises. Vide tant qu'on n'a pas regardé. */
    var organisations by mutableStateOf<List<Organisation>>(emptyList())
        private set

    /**
     * Pourquoi telle organisation ne s'est pas ouverte, par identifiant.
     *
     * **Une organisation qui échoue ne vide pas l'écran** : elle garde sa place, dit
     * pourquoi, et les autres s'affichent. C'est la même règle que pour un élément
     * illisible, à l'échelle au-dessus.
     */
    var echecsDOrganisation by mutableStateOf<Map<String, EchecDOrganisation>>(emptyMap())
        private set

    /** L'organisation ouverte, ou `null` quand on regarde le coffre personnel. */
    var organisationOuverte by mutableStateOf<Coffre.CoffreDOrganisation?>(null)
        private set

    var collectionOuverte by mutableStateOf<CollectionDOrganisation?>(null)
        private set

    private var lectureDeCollection by mutableStateOf(LectureDuCoffre())

    /**
     * Les organisations ouvertes, par identifiant — **toutes**, et gardées ouvertes.
     *
     * Elles l'étaient une à la fois tant que l'organisation était un lieu où l'on entrait.
     * Depuis que l'accueil montre leur contenu, il n'y a plus d'« organisation courante » :
     * n'importe quelle ligne de la liste peut avoir besoin de sa clé pour se réécrire, et
     * refermer après lecture obligerait à rouvrir — donc à redemander l'Org Key au serveur —
     * à chaque enregistrement.
     *
     * Cette table est **le seul propriétaire** de ces coffres ouverts : c'est elle qui les
     * referme, au verrouillage et à la déconnexion. Ouvrir deux fois la même organisation
     * ferait vivre deux clés pour une seule équipe, et n'en rendrait qu'une.
     */
    private var coffresOuverts by mutableStateOf<Map<String, Coffre.CoffreDOrganisation>>(
        emptyMap(),
    )

    /**
     * Ce que les équipes apportent à l'accueil : une lecture par collection, chacune déjà
     * **marquée** de son [Appartenance].
     *
     * Le marquage se fait ici, à la lecture, et non à l'affichage : l'origine sert ensuite à
     * router l'écriture, et une marque posée par l'écran ne serait pas là quand le modèle en
     * a besoin.
     */
    var partagesDEquipe by mutableStateOf<List<LectureDuCoffre>>(emptyList())
        private set

    /**
     * **Le coffre, en une seule liste.**
     *
     * C'est le modèle d'iOS (`VaultStore.chargerLesCoffresDEquipe`), et le défaut qu'il
     * corrige est le plus grave qu'ait connu ce portage : quelqu'un dont tous les mots de
     * passe vivent en organisation — le compte de Clara — ouvrait l'application et voyait
     * « aucun élément ». Ses données étaient là, derrière une navigation qu'il ne
     * connaissait pas. Aucune erreur, et l'apparence exacte d'une perte de données.
     *
     * Une seule liste, et **chaque ligne dit d'où elle vient**.
     */
    val coffreComplet: LectureDuCoffre
        get() = Coffre.fusionner(lecture, partagesDEquipe)

    /**
     * Ce que l'écran affiche : le coffre fondu, ou la collection dans laquelle on est entré.
     *
     * Une seule propriété plutôt que deux chemins dans l'écran : les règles d'affichage —
     * une ligne illisible garde sa place, les registres se masquent — sont les mêmes, et
     * deux chemins finiraient par ne plus les appliquer pareil.
     */
    val lectureAffichee: LectureDuCoffre
        get() = if (collectionOuverte == null) coffreComplet else lectureDeCollection

    /**
     * Le membre a-t-il le **droit** d'écrire là où un nouvel élément irait ?
     *
     * C'est la permission effective que le serveur établit, par collection. Elle sert à
     * l'affichage — une collection en lecture seule le dit sur sa pastille — parce que
     * découvrir qu'on n'avait pas le droit après avoir tout saisi est le pire moment.
     */
    val peutEcrire: Boolean
        get() = collectionOuverte?.permission?.peutEcrire ?: true

    /**
     * Peut-on modifier **cet élément-là** ?
     *
     * La question se posait autrefois à l'écran — « dans quoi suis-je entré ? » — et cette
     * réponse-là est morte avec la fusion : depuis que l'accueil mêle les deux origines, il
     * n'y a plus d'écran d'équipe où l'on serait entré, et répondre « oui » parce qu'aucune
     * collection n'est ouverte proposerait « Modifier » sur un élément d'équipe en lecture
     * seule. L'échec arriverait après la saisie.
     *
     * La réponse juste voyage donc avec l'élément, dans son [OrigineDuCoffre].
     *
     * Le paramètre est **nullable** pour la création : un élément qui n'existe pas encore
     * n'a pas d'origine, et il ira là où l'on regarde.
     */
    fun peutModifier(entree: EntreeDuCoffre.Lisible?): Boolean =
        when (val origine = entree?.origine) {
            is OrigineDuCoffre.Equipe -> origine.appartenance.peutEcrire
            else -> peutEcrire
        }

    /** L'étiquette d'une collection, telle qu'elle voyagera avec chacune de ses lignes. */
    private fun appartenanceDe(
        ouvert: Coffre.CoffreDOrganisation,
        collection: CollectionDOrganisation,
    ) = Appartenance(
        organisation = ouvert.organisation.id,
        collection = collection.id,
        nomEquipe = ouvert.organisation.nom,
        nomCollection = collection.nom,
        // La permission **effective sur cette collection**, et non le rôle dans
        // l'organisation : un membre ordinaire peut n'avoir que la lecture ici et l'écriture
        // ailleurs.
        peutEcrire = collection.permission.peutEcrire,
    )

    /**
     * Va chercher les organisations **et leur contenu**, pour que l'accueil les montre.
     *
     * Le pendant de `VaultStore.chargerLesCoffresDEquipe()` côté iOS. Charger la liste des
     * organisations sans leur contenu était le défaut de fond : les éléments d'équipe
     * étaient traités comme un supplément d'affichage — une pastille sur laquelle il fallait
     * savoir appuyer — plutôt que comme le contenu du coffre.
     *
     * **Trois échecs distincts, et aucun ne vide l'écran :**
     *
     *  - la liste des organisations échoue : une instance sans organisations répond `404`,
     *    et faire échouer tout l'écran pour cela rendrait l'application inutilisable sur les
     *    instances les plus simples. Le coffre personnel s'affiche seul ;
     *  - une organisation ne s'ouvre pas : elle est notée dans [echecsDOrganisation], garde
     *    sa place et dit pourquoi. Les autres équipes et le coffre personnel restent là ;
     *  - une collection ne se lit pas : même règle, à l'échelle en dessous.
     *
     * Ce qu'on ne fait **pas** : effacer [partagesDEquipe] avant de recharger. Une liste
     * vidée puis remplie clignote, et si le rechargement échoue elle reste vide — ce qui
     * ramènerait exactement le défaut qu'on corrige ici. On remplace d'un coup, à la fin.
     */
    fun chargerLesCoffresDEquipe() {
        viewModelScope.launch {
            val liste = try {
                withContext(Dispatchers.IO) { coffre.organisations() }
            } catch (_: Exception) {
                organisations = emptyList()
                return@launch
            }
            organisations = liste

            val ouverts = coffresOuverts.toMutableMap()
            val echecs = echecsDOrganisation.toMutableMap()
            val lectures = mutableListOf<LectureDuCoffre>()

            for (organisation in liste) {
                val ouvert = ouverts[organisation.id] ?: withContext(Dispatchers.IO) {
                    coffre.ouvrirLOrganisation(organisation)
                }.fold(
                    onSuccess = { it },
                    onFailure = { erreur ->
                        echecs[organisation.id] = (erreur as? Coffre.EchecDOuverture)?.motif
                            ?: EchecDOrganisation.Reseau(erreur.message ?: "erreur inconnue")
                        null
                    },
                )
                if (ouvert == null) continue
                ouverts[organisation.id] = ouvert
                echecs -= organisation.id

                for (collection in ouvert.collections) {
                    try {
                        val brute = withContext(Dispatchers.IO) {
                            coffre.elementsDeCollection(ouvert, collection.id)
                        }
                        lectures += Coffre.marquerCommeDEquipe(
                            brute,
                            appartenanceDe(ouvert, collection),
                        )
                    } catch (e: Exception) {
                        echecs[organisation.id] =
                            EchecDOrganisation.Reseau(e.message ?: "collection illisible")
                    }
                }
            }
            coffresOuverts = ouverts
            echecsDOrganisation = echecs
            partagesDEquipe = lectures
        }
    }

    /** Entre dans une organisation pour n'en voir qu'elle, et ouvre sa première collection. */
    fun ouvrirUneOrganisation(organisation: Organisation) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                // Déjà ouverte pour l'accueil : on réutilise **la même** clé. En rouvrir une
                // seconde en ferait vivre deux pour une seule équipe, dont une que personne
                // ne rendrait.
                val deja = coffresOuverts[organisation.id]
                val resultat = if (deja != null) {
                    Result.success(deja)
                } else {
                    withContext(Dispatchers.IO) { coffre.ouvrirLOrganisation(organisation) }
                }
                resultat.onSuccess { ouvert ->
                    coffresOuverts = coffresOuverts + (organisation.id to ouvert)
                    organisationOuverte = ouvert
                    echecsDOrganisation = echecsDOrganisation - organisation.id
                    val premiere = ouvert.collections.firstOrNull()
                    if (premiere == null) {
                        collectionOuverte = null
                        lectureDeCollection = LectureDuCoffre()
                    } else {
                        ouvrirUneCollection(premiere)
                    }
                }.onFailure { erreur ->
                    val motif = (erreur as? Coffre.EchecDOuverture)?.motif
                        ?: EchecDOrganisation.Reseau(erreur.message ?: "erreur inconnue")
                    // On note l'échec **sans** fermer ce qui est affiché : les autres
                    // organisations et le coffre personnel restent utilisables.
                    echecsDOrganisation = echecsDOrganisation + (organisation.id to motif)
                }
            } finally {
                occupe = false
            }
        }
    }

    fun ouvrirUneCollection(collection: CollectionDOrganisation) {
        val ouvert = organisationOuverte ?: return
        viewModelScope.launch {
            occupe = true
            try {
                collectionOuverte = collection
                lectureDeCollection = withContext(Dispatchers.IO) {
                    // Marquée ici aussi, et ce n'est pas une redite : l'origine décide de la
                    // **route d'écriture**. Une ligne lue par ce chemin-ci et laissée sans
                    // marque se réécrirait par l'API personnelle — elle sortirait de
                    // l'équipe en silence, ce qui est précisément ce que l'origine empêche.
                    Coffre.marquerCommeDEquipe(
                        coffre.elementsDeCollection(ouvert, collection.id),
                        appartenanceDe(ouvert, collection),
                    )
                }
                message = null
            } catch (e: Exception) {
                lectureDeCollection = LectureDuCoffre()
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Revient à l'accueil — qui contient **aussi** les équipes.
     *
     * On ne referme plus l'organisation ici. C'est [coffresOuverts] qui possède les coffres
     * ouverts, et l'accueil affiche leur contenu : la refermer en sortant de sa collection
     * rendrait une clé dont la liste a encore besoin pour se réécrire. Les clés se rendent
     * au verrouillage et à la déconnexion, par [rendreLesClesDEquipe].
     */
    fun revenirAuCoffrePersonnel() {
        organisationOuverte = null
        collectionOuverte = null
        lectureDeCollection = LectureDuCoffre()
    }

    /**
     * Rend toutes les Org Keys au cœur.
     *
     * Les laisser derrière ferait qu'un écran verrouillé garde de quoi déchiffrer une équipe
     * entière. C'est la contrepartie de les avoir gardées ouvertes.
     */
    private fun rendreLesClesDEquipe() {
        coffresOuverts.values.forEach { it.close() }
        coffresOuverts = emptyMap()
        partagesDEquipe = emptyList()
        revenirAuCoffrePersonnel()
    }

    /** Accepte une invitation, puis relit la liste : l'organisation devient lisible. */
    fun accepterLInvitation(organisation: Organisation) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) { coffre.accepterLOrganisation(organisation.id) }
                echecsDOrganisation = echecsDOrganisation - organisation.id
                // Le contenu accepté rejoint l'accueil, il n'attend pas qu'on entre quelque
                // part : c'est tout l'objet de la fusion.
                chargerLesCoffresDEquipe()
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    // ─── Le partage de lien (§4) ───

    /** Le lien prêt à être remis, ou `null`. Effacé dès que l'écran le referme. */
    var lienDePartage by mutableStateOf<String?>(null)

    /**
     * Une destination étrangère qu'il faut montrer à l'utilisateur avant de lui remettre la
     * clé.
     *
     * Tant que ceci n'est pas nul, **aucun lien n'est affiché**. C'est ce qui fait tenir la
     * règle : une fois le lien montré, il est trop tard pour demander.
     */
    var destinationAConfirmer by mutableStateOf<Coffre.Partage.ADemander?>(null)
        private set

    /**
     * Partage le secret d'un élément.
     *
     * Le secret dépend du genre, et une carte n'en a pas **un** : numéro, date et code sont
     * trois champs, et n'en envoyer qu'un donnerait au destinataire quelque chose
     * d'inutilisable en lui laissant croire qu'il a tout. On refuse plutôt que de choisir à
     * sa place.
     */
    fun partager(entree: EntreeDuCoffre.Lisible, heures: Int, consultations: Int) {
        val secret = when (val d = entree.element.data) {
            is ContenuDElement.Connexion -> d.valeur.password
            is ContenuDElement.NoteSecrete -> d.valeur.content
            is ContenuDElement.Carte -> null
        }
        if (secret.isNullOrEmpty()) {
            message = "Cet élément n'a pas de secret unique à partager."
            return
        }
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                val approuves = stockage.domainesApprouves(serveurEnregistre)
                val resultat = withContext(Dispatchers.IO) {
                    coffre.partager(secret, heures, consultations, entree.element.name, approuves)
                }
                when (resultat) {
                    is Coffre.Partage.Pret -> terminerLePartage(resultat.lien, resultat.inscription)
                    is Coffre.Partage.ADemander -> destinationAConfirmer = resultat
                    is Coffre.Partage.Refuse -> message = resultat.raison
                }
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * L'utilisateur accepte la destination.
     *
     * `memoriser` retient l'hôte **pour ce serveur-là**, jamais globalement : approuver
     * `ghostbit.example.com` pour l'instance de son entreprise ne doit rien autoriser sur
     * l'instance d'un tiers.
     */
    fun confirmerLaDestination(memoriser: Boolean) {
        val attente = destinationAConfirmer ?: return
        destinationAConfirmer = null
        if (memoriser) stockage.approuver(serveurEnregistre, attente.hote)
        terminerLePartage(attente.lien, attente.inscription)
    }

    /**
     * L'utilisateur refuse : **le partage est révoqué**.
     *
     * Il existe déjà côté serveur à cet instant — c'est le serveur qui vient de le créer.
     * L'oublier laisserait derrière soi un secret publié que personne ne surveille.
     */
    fun refuserLaDestination() {
        val attente = destinationAConfirmer ?: return
        destinationAConfirmer = null
        val jetonDeSuppression = attente.cree.deleteToken
        viewModelScope.launch {
            occupe = true
            try {
                if (jetonDeSuppression != null) {
                    withContext(Dispatchers.IO) {
                        coffre.revoquerUnPartage(attente.cree.id, jetonDeSuppression)
                    }
                    message = "Partage annulé et révoqué."
                } else {
                    // Ne peut pas arriver : `Coffre.partager` refuse d'emblée une
                    // destination étrangère sans jeton, précisément pour ne pas poser une
                    // question dont une des réponses serait impossible à tenir.
                    message = "Partage annulé, mais ce serveur ne permet pas de le révoquer."
                }
            } catch (e: Exception) {
                message = "Le partage n'a pas pu être révoqué : ${messageLisible(e)}"
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Inscrit le partage au registre, puis montre le lien.
     *
     * L'inscription est nulle quand le serveur n'a pas rendu de jeton de révocation : sans
     * jeton et sans route pour l'employer, une ligne au registre serait un vœu. Le lien,
     * lui, est remis dans les deux cas — il fonctionne.
     */
    private fun terminerLePartage(lien: String, inscription: PartageEnCours?) {
        lienDePartage = lien
        if (inscription == null) return
        ecrireUnRegistre(
            Registres.PARTAGES,
            Json.encodeToString(
                ListSerializer(PartageEnCours.serializer()), lecture.partages + inscription),
        )
    }

    /** Révoque un partage déjà inscrit au registre, et l'en retire. */
    fun revoquerUnPartage(partage: PartageEnCours) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) {
                    coffre.revoquerUnPartage(partage.id, partage.deleteToken)
                }
                ecrireUnRegistre(
                    Registres.PARTAGES,
                    Json.encodeToString(
                        ListSerializer(PartageEnCours.serializer()),
                        lecture.partages.filterNot { it.id == partage.id },
                    ),
                )
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    // ─── La corbeille ───

    /** Ce que la corbeille contient. Vide tant qu'on ne l'a pas ouverte. */
    var corbeille by mutableStateOf(LectureDuCoffre())
        private set

    /**
     * **Un sélecteur du système est ouvert, et le verrouillage automatique doit attendre.**
     *
     * Un sélecteur de fichiers est une activité d'une *autre* application : la nôtre passe
     * par `onStop` au moment même où l'utilisateur va choisir son fichier. Avec le réglage
     * par défaut — « Immédiatement » — le coffre se referme pendant qu'il cherche, et au
     * retour l'écran d'import a disparu au profit du mot de passe maître.
     *
     * Le défaut est total : **l'import ne peut alors jamais aboutir**, et rien ne dit
     * pourquoi. On ne voit pas un échec, on voit un coffre qui se reverrouille tout seul.
     * Mesuré ici, sur l'émulateur, avec un vrai fichier — et c'est exactement ce que le
     * commentaire d'`ImportView.swift` décrit côté iOS.
     *
     * L'exemption est **armée au lancement du sélecteur, pas à l'ouverture de l'écran**.
     * C'est la précision qu'iOS a dû ajouter après coup : posée sur l'apparition de la vue,
     * elle désarmait le verrouillage pendant qu'on lisait la page, avant même d'avoir
     * appuyé. Une exemption doit durer exactement ce qu'elle protège.
     */
    var unSelecteurEstOuvert by mutableStateOf(false)

    /**
     * L'écran de santé est ouvert.
     *
     * Il vit dans le modèle, comme la corbeille, et non dans la composition : le
     * verrouillage automatique doit pouvoir le refermer. Un écran de santé resté posé sur un
     * coffre fermé garderait à l'écran les noms des éléments faibles — c'est-à-dire la liste
     * exacte de ce qu'il faut attaquer en premier.
     */
    var santeOuverte by mutableStateOf(false)

    var corbeilleOuverte by mutableStateOf(false)
        private set

    fun ouvrirLaCorbeille() {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                corbeille = withContext(Dispatchers.IO) { coffre.lireLaCorbeille() }
                corbeilleOuverte = true
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    fun fermerLaCorbeille() {
        corbeilleOuverte = false
        corbeille = LectureDuCoffre()
    }

    fun restaurer(id: String) = agirSurLaCorbeille { coffre.restaurer(id) }

    /** Détruit pour de bon. Irréversible, et l'écran demande deux fois. */
    fun purger(id: String) = agirSurLaCorbeille { coffre.purger(id) }

    private fun agirSurLaCorbeille(action: () -> Unit) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                withContext(Dispatchers.IO) { action() }
                corbeille = withContext(Dispatchers.IO) { coffre.lireLaCorbeille() }
                rafraichir()
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    // ─── Les registres en écriture (§2) ───

    /**
     * Écrit un registre, en le **remplaçant** s'il existe déjà.
     *
     * L'identité vient de la dernière lecture. Sans elle, chaque écriture créerait un
     * nouveau registre du même nom : un seul serait lu, et l'autre resterait à contredire le
     * premier chez le prochain client — sans qu'aucune erreur ne soit levée nulle part.
     */
    private fun ecrireUnRegistre(nom: String, contenu: String) {
        viewModelScope.launch {
            occupe = true
            try {
                withContext(Dispatchers.IO) {
                    coffre.ecrireUnRegistre(nom, contenu, lecture.identifiantsDeRegistres[nom])
                }
                rafraichir()
            } catch (e: Exception) {
                message = messageLisible(e)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Met un élément en favori, ou l'en retire.
     *
     * Le registre porte des **identifiants d'éléments**, pas des noms : un élément renommé
     * reste favori, et deux éléments homonymes ne se confondent pas.
     */
    fun basculerLeFavori(id: String) {
        val favoris = lecture.favoris.toMutableSet()
        if (!favoris.add(id)) favoris.remove(id)
        ecrireUnRegistre(
            Registres.FAVORIS,
            Json.encodeToString(ListSerializer(String.serializer()), favoris.sorted()),
        )
    }

    /**
     * Retient un dossier **vide**.
     *
     * Le registre ne porte que ceux-là : un dossier qu'un élément habite se déduit de
     * l'élément, et l'inscrire deux fois donnerait deux sources pour la même vérité. On
     * retire donc du registre tout dossier qui vient d'être peuplé — c'est fait à chaque
     * écriture, plus bas.
     */
    fun ajouterUnDossierVide(nom: String) {
        val propre = nom.trim().trim('/')
        if (propre.isEmpty()) return
        if (propre in dossiersHabites() || propre in lecture.dossiersVides) return
        ecrireLesDossiersVides(lecture.dossiersVides + propre)
    }

    fun retirerUnDossierVide(nom: String) {
        ecrireLesDossiersVides(lecture.dossiersVides - nom)
    }

    private fun ecrireLesDossiersVides(dossiers: List<String>) {
        // Les dossiers devenus habités sortent du registre : c'est la règle « les dossiers
        // **vides** seulement » (§2), et sans ce filtre le registre grossirait indéfiniment
        // de dossiers qui n'ont plus rien à y faire.
        val vides = dossiers.toSortedSet() - dossiersHabites()
        ecrireUnRegistre(
            Registres.DOSSIERS,
            Json.encodeToString(ListSerializer(String.serializer()), vides.toList()),
        )
    }

    /** Les dossiers qu'au moins un élément habite. Ils se déduisent, ils ne s'inscrivent pas. */
    private fun dossiersHabites(): Set<String> =
        lecture.lisibles.mapNotNull { it.element.folder?.trim()?.ifEmpty { null } }.toSet()

    /** Tous les dossiers à montrer : ceux qu'on habite, plus ceux qu'on garde vides. */
    val dossiers: List<String>
        get() = (dossiersHabites() + lecture.dossiersVides).sorted()

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
    /**
     * Où part une écriture : le coffre personnel, ou une collection d'équipe précise.
     *
     * **Elle ne se déduit plus de l'écran.** Tant que l'accueil ne montrait que le coffre
     * personnel, « ce qu'on regarde » suffisait à router. Depuis la fusion, ce repère a
     * disparu : une ligne d'équipe se modifie depuis l'accueil, où aucune organisation n'est
     * ouverte. Router sur l'écran enregistrerait par `/api/vault/items`, ce qui créerait une
     * **copie privée** au lieu de mettre à jour l'original — l'équipe ne verrait jamais la
     * modification, et son auteur croirait l'avoir faite.
     */
    private sealed interface Destination {
        data object Personnelle : Destination

        data class Equipe(
            val ouvert: Coffre.CoffreDOrganisation,
            val collection: String,
        ) : Destination
    }

    /**
     * La destination d'une écriture, d'après l'**origine** de l'élément.
     *
     * @param entree `null` pour une création : elle n'a pas encore d'origine, et suit donc
     *   ce qu'on regarde — créer depuis l'accueil crée dans le coffre personnel, comme sur
     *   iOS.
     * @throws ErreurApi.Reseau si l'élément vient d'une équipe dont la clé n'est plus
     *   ouverte. **On refuse d'écrire plutôt que de retomber sur le coffre personnel** : le
     *   repli silencieux produirait exactement la copie privée décrite ci-dessus, sans
     *   qu'aucune erreur ne le dise. Un refus visible coûte un rafraîchissement ; le repli
     *   coûte la modification de quelqu'un d'autre.
     */
    private fun destinationDe(entree: EntreeDuCoffre.Lisible?): Destination {
        val appartenance = (entree?.origine as? OrigineDuCoffre.Equipe)?.appartenance
        if (appartenance != null) {
            val ouvert = coffresOuverts[appartenance.organisation]
                ?: throw ErreurApi.Reseau(
                    "Le coffre d'équipe « ${appartenance.nomEquipe} » n'est plus ouvert. " +
                        "Rafraîchissez la liste avant d'enregistrer.",
                )
            return Destination.Equipe(ouvert, appartenance.collection)
        }
        if (entree != null) return Destination.Personnelle
        val ouvert = organisationOuverte
        val collection = collectionOuverte
        return if (ouvert != null && collection != null) {
            Destination.Equipe(ouvert, collection.id)
        } else {
            Destination.Personnelle
        }
    }

    /**
     * Dépose une liste d'éléments importés dans le coffre **personnel**.
     *
     * Toujours le coffre personnel, jamais la collection ouverte : un import venu d'un
     * fichier n'a rien qui désigne une équipe, et le déposer là où l'écran se trouve
     * publierait chez des collègues deux cents mots de passe privés. Le silence de cette
     * erreur serait total — l'import réussirait, et l'utilisateur ne verrait que sa propre
     * liste.
     *
     * **Une entrée qui échoue n'arrête pas les autres**, et le compte rendu dit combien
     * sont passées. Un import de deux cents lignes qui s'interromprait à la troisième
     * laisserait un coffre à moitié rempli sans dire où il s'est arrêté ; continuer et
     * compter permet de rejouer le fichier — les doublons se voient, une absence non.
     */
    // ─── L'accès d'urgence ───

    sealed interface EtatDesUrgences {
        data object EnLecture : EtatDesUrgences
        data class Lu(
            val confies: List<LienDUrgenceDto>,
            val recus: List<LienDUrgenceDto>,
        ) : EtatDesUrgences
        data class Indisponible(val cause: String) : EtatDesUrgences
    }

    var liensDUrgence by mutableStateOf<EtatDesUrgences>(EtatDesUrgences.EnLecture)

    /** Le coffre d'un donneur, ouvert. `null` tant qu'on n'en a ouvert aucun. */
    var coffreDUrgenceOuvert by mutableStateOf<Coffre.CoffreDUrgenceOuvert?>(null)
        private set

    fun lireLesLiensDUrgence() {
        viewModelScope.launch {
            liensDUrgence = EtatDesUrgences.EnLecture
            liensDUrgence = try {
                val liens = withContext(Dispatchers.IO) { coffre.liensDUrgence() }
                EtatDesUrgences.Lu(liens.asGrantor, liens.asGrantee)
            } catch (e: Exception) {
                EtatDesUrgences.Indisponible(e.message ?: "Le serveur n'a pas répondu.")
            }
        }
    }

    fun inviterUnContactDUrgence(
        email: String,
        role: String,
        joursDAttente: Int,
        surFin: (Boolean) -> Unit,
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) {
                    coffre.inviterUnContactDUrgence(email, role, joursDAttente)
                }
            }
            occupe = false
            resultat.exceptionOrNull()?.let {
                // Le message du serveur est repris tel quel : « utilisateur introuvable » et
                // « contact déjà invité » demandent deux gestes différents, et un message
                // unique les rendrait indiscernables.
                message = it.message ?: "L'invitation a échoué."
            }
            if (resultat.isSuccess) lireLesLiensDUrgence()
            surFin(resultat.isSuccess)
        }
    }

    fun agirSurUnLienDUrgence(id: String, action: String) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.agirSurUnLienDUrgence(id, action) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message }
            // **On relit toujours**, même après un échec : le serveur arbitre les états, et
            // un écran qui garderait le sien après un refus montrerait un bouton qui ne
            // marche plus.
            lireLesLiensDUrgence()
        }
    }

    fun revoquerUnLienDUrgence(id: String) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.revoquerUnLienDUrgence(id) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message }
            lireLesLiensDUrgence()
        }
    }

    fun ouvrirUnCoffreDUrgence(id: String) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.ouvrirUnCoffreDUrgence(id) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let {
                // Le serveur refuse par 403 tant que le délai court : son message dit
                // « délai en cours ou non demandé », ce qui est exactement l'information
                // utile. On ne la remplace pas par « erreur ».
                message = it.message ?: "Le coffre n'a pas pu être ouvert."
            }
            coffreDUrgenceOuvert = resultat.getOrNull()
        }
    }

    fun fermerLeCoffreDUrgence() {
        coffreDUrgenceOuvert = null
    }

    fun reprendreLeCompte(
        ouvert: Coffre.CoffreDUrgenceOuvert,
        nouveauMotDePasse: String,
        surFin: (Boolean) -> Unit,
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.reprendreLeCompte(ouvert, nouveauMotDePasse) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message ?: "La reprise a échoué." }
            if (resultat.isSuccess) {
                message = "Compte repris. Communiquez le nouveau mot de passe à son titulaire."
            }
            surFin(resultat.isSuccess)
        }
    }

    // ─── La clé de récupération ───

    /**
     * Crée une clé de récupération, et la rend **une seule fois**.
     *
     * Elle n'est écrite nulle part : ni dans le modèle, ni dans le stockage, ni dans un
     * journal. L'écran la montre, et c'est tout — c'est ce qui fait que personne d'autre ne
     * peut s'en servir, et c'est ce qui rend cet écran irremplaçable.
     */
    fun creerUneCleDeRecuperation(surFin: (String?) -> Unit) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.creerUneCleDeRecuperation() }
            }
            occupe = false
            resultat.exceptionOrNull()?.let {
                // Une clé affichée que le serveur n'a pas reçue est pire qu'aucune clé :
                // quelqu'un la noterait soigneusement, et elle ne servirait à rien le jour
                // venu. `Coffre` enregistre donc avant de rendre, et l'échec arrive ici.
                message = it.message ?: "La clé de récupération n'a pas été enregistrée."
            }
            surFin(resultat.getOrNull())
        }
    }

    /**
     * Réinitialise le mot de passe maître avec la clé de récupération.
     *
     * **Rien n'est déverrouillé ici.** Le serveur invalide toutes les sessions, et
     * l'utilisateur se reconnecte ensuite avec le nouveau mot de passe.
     */
    fun recupererLeCompte(
        serveur: String,
        email: String,
        cleDeRecuperation: String,
        nouveauMotDePasse: String,
        surFin: (Boolean) -> Unit,
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) {
                    coffre.recuperer(serveur, email, cleDeRecuperation, nouveauMotDePasse)
                }
            }
            occupe = false
            if (resultat.isFailure) {
                // **Un seul message pour les deux cas.** Le serveur répond de la même façon
                // pour une clé fausse et pour un compte sans kit — avec des leurres — afin
                // de ne pas révéler quels comptes existent. Les distinguer à l'écran
                // annulerait cette protection.
                message = "Clé de récupération refusée."
            }
            surFin(resultat.isSuccess)
        }
    }

    // ─── Le journal du compte ───

    /**
     * Trois états là encore, et pour la même raison qu'au second facteur.
     *
     * **Un journal qu'on n'a pas pu lire n'est pas un journal vide.** Les aplatir sur une
     * liste vide dirait « rien ne s'est passé sur ce compte » à quelqu'un dont on n'a rien
     * lu — sur le seul écran capable de révéler une intrusion, c'est le pire des replis
     * silencieux.
     */
    sealed interface EtatDuJournal {
        data object EnLecture : EtatDuJournal
        data class Lu(
            val connexions: List<ConnexionDto>,
            val actions: List<ActionDto>,
        ) : EtatDuJournal
        data class Indisponible(val cause: String) : EtatDuJournal
    }

    var journal by mutableStateOf<EtatDuJournal>(EtatDuJournal.EnLecture)

    fun lireLeJournal() {
        viewModelScope.launch {
            journal = EtatDuJournal.EnLecture
            journal = try {
                val (connexions, actions) = withContext(Dispatchers.IO) {
                    coffre.connexionsDuCompte() to coffre.actionsDuCompte()
                }
                EtatDuJournal.Lu(connexions, actions)
            } catch (e: Exception) {
                EtatDuJournal.Indisponible(e.message ?: "Le serveur n'a pas répondu.")
            }
        }
    }

    // ─── Le second facteur du compte ───

    /**
     * Trois états, jamais deux — et c'est la correction qu'iOS a dû faire.
     *
     * Là-bas, `actif` valant `nil` disait deux choses à la fois : « je charge » et « j'ai
     * échoué ». La roue tournait donc indéfiniment dès que le serveur refusait la route, et
     * l'écran ne disait rien. Ici les trois cas sont des types distincts, et le compilateur
     * ne laisse pas les confondre.
     */
    sealed interface EtatDuSecondFacteur {
        data object EnLecture : EtatDuSecondFacteur
        data class Lu(val actif: Boolean) : EtatDuSecondFacteur
        data class Indisponible(val cause: String) : EtatDuSecondFacteur
    }

    var secondFacteur by mutableStateOf<EtatDuSecondFacteur>(EtatDuSecondFacteur.EnLecture)

    fun lireLeSecondFacteur() {
        viewModelScope.launch {
            secondFacteur = EtatDuSecondFacteur.EnLecture
            secondFacteur = try {
                val actif = withContext(Dispatchers.IO) { coffre.secondFacteurActif() }
                if (actif == null) {
                    // 404 : l'instance est plus ancienne que la fonctionnalité. Ce n'est pas
                    // une panne, et le dire ainsi évite d'envoyer chercher un problème de
                    // réseau qui n'existe pas.
                    EtatDuSecondFacteur.Indisponible(
                        "Ce serveur ne propose pas encore le second facteur.",
                    )
                } else {
                    EtatDuSecondFacteur.Lu(actif)
                }
            } catch (e: Exception) {
                EtatDuSecondFacteur.Indisponible(e.message ?: "Le serveur n'a pas répondu.")
            }
        }
    }

    fun preparerLeSecondFacteur(
        motDePasse: String,
        surFin: (ConfigurationDuSecondFacteur?) -> Unit,
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.preparerLeSecondFacteur(motDePasse) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message }
            surFin(resultat.getOrNull())
        }
    }

    fun confirmerLeSecondFacteur(code: String, surFin: (Boolean) -> Unit) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.confirmerLeSecondFacteur(code) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message }
            if (resultat.isSuccess) secondFacteur = EtatDuSecondFacteur.Lu(true)
            surFin(resultat.isSuccess)
        }
    }

    fun retirerLeSecondFacteur(motDePasse: String, code: String, surFin: (Boolean) -> Unit) {
        viewModelScope.launch {
            occupe = true
            message = null
            val resultat = runCatching {
                withContext(Dispatchers.IO) { coffre.retirerLeSecondFacteur(motDePasse, code) }
            }
            occupe = false
            resultat.exceptionOrNull()?.let { message = it.message }
            if (resultat.isSuccess) secondFacteur = EtatDuSecondFacteur.Lu(false)
            surFin(resultat.isSuccess)
        }
    }

    fun importerDesElements(
        elements: List<ElementDuCoffre>,
        surFin: (Int) -> Unit = {},
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            var deposes = 0
            val echecs = ArrayList<String>()
            try {
                for (element in elements) {
                    try {
                        withContext(Dispatchers.IO) { coffre.creer(element) }
                        deposes++
                    } catch (e: Exception) {
                        echecs.add(element.name)
                    }
                }
                relireApres()
            } finally {
                occupe = false
            }
            if (echecs.isNotEmpty()) {
                message = "Non déposés : " + echecs.take(5).joinToString(", ") +
                    if (echecs.size > 5) " et ${echecs.size - 5} autres." else "."
            }
            surFin(deposes)
        }
    }

    fun enregistrerUnElement(
        entree: EntreeDuCoffre.Lisible?,
        element: ElementDuCoffre,
        surFin: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                val destination = destinationDe(entree)
                withContext(Dispatchers.IO) {
                    when (destination) {
                        is Destination.Equipe -> if (entree == null) {
                            coffre.creerDansCollection(
                                destination.ouvert, destination.collection, element,
                            )
                        } else {
                            coffre.mettreAJourDansCollection(
                                destination.ouvert, destination.collection, entree, element,
                            )
                        }
                        Destination.Personnelle -> if (entree == null) {
                            coffre.creer(element)
                        } else {
                            coffre.mettreAJour(entree.id, element)
                        }
                    }
                }
                relireApres()
                surFin(true)
            } catch (e: Exception) {
                message = messageLisible(e)
                surFin(false)
            } finally {
                occupe = false
            }
        }
    }

    /**
     * Ce qu'on relit après une écriture.
     *
     * Depuis l'accueil, [rafraichir] relit le coffre personnel **et** les équipes : une
     * modification d'équipe faite depuis la liste fondue doit y revenir, et ne relire que le
     * personnel la ferait disparaître de l'écran jusqu'au prochain passage.
     */
    private fun relireApres() {
        val collection = collectionOuverte
        if (collection != null) ouvrirUneCollection(collection) else rafraichir()
    }

    /**
     * Supprime l'élément qu'on regarde.
     *
     * **Les deux suppressions ne font pas la même chose**, et l'écran doit le dire : dans le
     * coffre personnel, le serveur marque la ligne et la range à la corbeille ; dans une
     * collection d'équipe, il l'efface. Le même mot, le même verbe HTTP, et un filet d'un
     * côté seulement.
     *
     * Le paramètre est l'**entrée lisible** et non un identifiant : une ligne qu'on n'a
     * jamais su ouvrir ne peut donc pas être détruite depuis ici.
     */
    fun supprimerUnElement(entree: EntreeDuCoffre.Lisible, surFin: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            occupe = true
            message = null
            try {
                // Routée sur l'origine, comme l'enregistrement — et l'enjeu est le même à
                // l'envers : supprimer par l'API personnelle un élément qui n'y est pas
                // rendrait un `404`, ou pire, effacerait un homonyme.
                val destination = destinationDe(entree)
                withContext(Dispatchers.IO) {
                    when (destination) {
                        is Destination.Equipe -> coffre.supprimerDansCollection(
                            destination.ouvert, destination.collection, entree,
                        )
                        Destination.Personnelle -> coffre.supprimer(entree.id)
                    }
                }
                relireApres()
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
        // Les clés d'organisation vivent en mémoire du cœur : les rendre fait partie du
        // verrouillage, au même titre que la clé du coffre. Les laisser derrière ferait
        // qu'un écran verrouillé garde de quoi déchiffrer une équipe entière.
        rendreLesClesDEquipe()
        organisations = emptyList()
        echecsDOrganisation = emptyMap()
        // Les icônes chargées nomment les sites du coffre, et le jeton ouvre la route qui
        // les nomme : les deux partent avec les clés.
        oublierLesIcones()
        jetonDIcone = null
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
            // Et les équipes avec : une déconnexion qui laisse les Org Keys ouvertes est un
            // verrouillage moins complet que le verrouillage.
            rendreLesClesDEquipe()
            organisations = emptyList()
            echecsDOrganisation = emptyMap()
            oublierLesIcones()
            jetonDIcone = null
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
        // Le SSO parle par ses propres refus, qui disent des choses différentes : « ce
        // retour n'est pas le vôtre » n'est pas « ce compte n'existe pas ».
        is SsoMobile.ErreurDeRetour -> e.message ?: "L'authentification a échoué."
        is ErreurApi.AdresseInvalide ->
            "Adresse de serveur invalide. Exemple : ghostpass.example.com"
        is ErreurApi.Reseau ->
            "Serveur injoignable. Vérifiez l'adresse et votre connexion."
        is Coffre.CleDOrganisationPerimee -> e.message!!
        is ErreurApi.CoffreVerrouille ->
            "Le coffre est verrouillé. Déverrouillez-le avant d'écrire."
        is ErreurApi.Http -> e.message ?: "Erreur serveur."
        is uniffi.ghost_crypto_ffi.GhostCryptoException ->
            "Mot de passe maître incorrect."
        else -> e.message ?: "Une erreur est survenue."
    }
}
