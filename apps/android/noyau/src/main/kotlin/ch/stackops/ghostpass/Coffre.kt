package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.masterPasswordHash

/**
 * Ce qu'une lecture du coffre produit : les lignes, et ce que les registres portaient.
 *
 * Les lignes contiennent **aussi celles qui ne se sont pas ouvertes** (§5). Les registres,
 * eux, sont retirés de la liste : ils ne sont pas des éléments de l'utilisateur, et les
 * laisser apparaître donnerait des lignes fantômes au nom illisible.
 */
data class LectureDuCoffre(
    val entrees: List<EntreeDuCoffre> = emptyList(),
    val dossiersVides: List<String> = emptyList(),
    val favoris: Set<String> = emptySet(),
    val partages: List<PartageEnCours> = emptyList(),
    val couleursDEquipe: Map<String, String> = emptyMap(),
    /** L'identité serveur de chaque registre, par nom — pour le réécrire au bon endroit. */
    val identifiantsDeRegistres: Map<String, String> = emptyMap(),
) {
    /** Les lignes qui se sont ouvertes. */
    val lisibles: List<EntreeDuCoffre.Lisible>
        get() = entrees.filterIsInstance<EntreeDuCoffre.Lisible>()

    /** Combien de lignes n'ont pas pu être ouvertes. Zéro, normalement. */
    val nombreDIllisibles: Int
        get() = entrees.count { it is EntreeDuCoffre.Illisible }
}

/**
 * Le coffre : ouverture de session, déchiffrement, lecture.
 *
 * **Aucune cryptographie ici.** Chaque opération sensible traverse la frontière UniFFI
 * vers le cœur Rust ; cette classe traduit des types, assemble du JSON, et ordonne. C'est
 * la règle §1 du brief, et c'est elle qui rend ces portages possibles : il n'existe qu'une
 * implémentation d'Argon2id, de l'enveloppe symétrique et du scellement, et elle est
 * partagée par le web, iOS et Android.
 */
class Coffre {

    private var compte: Account? = null
    private var client: ClientApi? = null
    private var jeton: String? = null

    /** Le coffre est-il ouvert ? */
    val estOuvert: Boolean get() = compte != null

    /**
     * Le jeton de session courant, pour que l'appelant puisse l'enregistrer.
     *
     * Exposé en lecture seule : le jeton ouvre le compte côté serveur, et il n'a pas à
     * circuler ailleurs que vers le stockage chiffré de l'appareil.
     */
    val jetonCourant: String? get() = jeton

    /** La session, une fois ouverte — de quoi rouvrir le coffre sans réseau. */
    data class Session(
        val adresseServeur: String,
        val email: String,
        val kdfParams: String,
        val encryptedUserKey: String,
        val encryptedPrivateKey: String,
    )

    private var session: Session? = null

    /**
     * Ouvre une session contre un serveur GhostPass.
     *
     * Quatre étapes, dont deux seulement touchent le réseau :
     *
     *  1. pré-login — le serveur rend les paramètres KDF du compte, **verbatim** ;
     *  2. le cœur en dérive l'empreinte d'authentification (le mot de passe maître ne
     *     quitte jamais l'appareil) ;
     *  3. connexion — le serveur rend le jeton et les enveloppes chiffrées ;
     *  4. le cœur déverrouille le compte à partir de ces enveloppes.
     *
     * L'étape 4 utilise les `kdfParams` de la **réponse de connexion**, pas ceux du
     * pré-login : le pré-login rend des paramètres par défaut pour un email inconnu, pour
     * ne pas révéler quels comptes existent. S'en servir pour déverrouiller ferait échouer
     * la dérivation d'un compte dont les paramètres diffèrent du défaut.
     */
    fun ouvrirUneSession(
        adresseSaisie: String,
        email: String,
        motDePasse: String,
        codeTotp: String? = null,
    ): Session {
        val adresse = AdresseServeur.normaliser(adresseSaisie) ?: throw ErreurApi.AdresseInvalide()
        val api = ClientApi(adresse)

        val kdf = api.prelogin(email).kdfParams
        val empreinte = masterPasswordHash(motDePasse, email, kdf)
        val connexion = api.connexion(email, empreinte, codeTotp)

        val ouvert = Account.unlock(
            motDePasse,
            email,
            connexion.kdfParams,
            connexion.encryptedUserKey,
            connexion.encryptedPrivateKey,
        )

        compte = ouvert
        client = api
        jeton = connexion.token
        val s = Session(
            adresseServeur = adresse,
            email = email,
            kdfParams = connexion.kdfParams,
            encryptedUserKey = connexion.encryptedUserKey,
            encryptedPrivateKey = connexion.encryptedPrivateKey,
        )
        session = s
        return s
    }

    /**
     * Rouvre un coffre déjà connu, **sans réseau**, avec le seul mot de passe maître.
     *
     * C'est ce qui rend le verrouillage supportable : verrouiller jette les clés, pas la
     * session. Le jeton reste valable et n'a pas à être redemandé.
     */
    fun rouvrirHorsLigne(session: Session, motDePasse: String, jetonConnu: String?) {
        compte = Account.unlock(
            motDePasse,
            session.email,
            session.kdfParams,
            session.encryptedUserKey,
            session.encryptedPrivateKey,
        )
        client = ClientApi(session.adresseServeur)
        jeton = jetonConnu
        this.session = session
    }

    /**
     * Ouvre une **session** par SSO — et laisse le coffre fermé.
     *
     * C'est la distinction que `docs/sso-mobile.md` répète et qu'il faut tenir : **le SSO
     * authentifie ; il n'ouvre pas le coffre.** Celui-ci reste scellé sous le mot de passe
     * maître, qui sera demandé ensuite. Les confondre est la première erreur de conception
     * d'un client à connaissance nulle — et elle serait invisible ici, puisque tout
     * marcherait jusqu'au premier déchiffrement.
     *
     * `compte` n'est donc pas posé. L'appelant enchaîne sur [rouvrirHorsLigne] avec la
     * session rendue, exactement comme après un verrouillage : un seul chemin de
     * déverrouillage, pas deux.
     */
    fun ouvrirUneSessionParSso(
        adresseSaisie: String,
        code: String,
        verificateur: String,
    ): Session {
        val adresse = AdresseServeur.normaliser(adresseSaisie) ?: throw ErreurApi.AdresseInvalide()
        val api = ClientApi(adresse)
        val reponse = api.echangerLeCodeSso(code, verificateur)

        // Le serveur rend l'adresse qu'il a vérifiée chez le fournisseur d'identité. La
        // prendre de lui plutôt que de la demander est le point : l'utilisateur n'a rien
        // saisi, et lui faire taper son adresse ici permettrait d'en saisir une autre.
        if (reponse.email.isEmpty()) throw ErreurApi.ReponseIllisible()

        client = api
        jeton = reponse.token
        val s = Session(
            adresseServeur = adresse,
            email = reponse.email,
            kdfParams = reponse.kdfParams,
            encryptedUserKey = reponse.encryptedUserKey,
            encryptedPrivateKey = reponse.encryptedPrivateKey,
        )
        session = s
        return s
    }

    /**
     * Rouvre le coffre **sans mot de passe maître**, à partir de l'enveloppe d'appareil.
     *
     * C'est le mécanisme d'`docs/adr/0002` : la clé du coffre (l'USK) a été enveloppée par
     * un secret aléatoire, et ce secret vit sous une clé de l'`AndroidKeyStore` liée à
     * l'authentification. L'appelant a déjà obtenu le secret en clair — c'est lui qui a
     * traversé la biométrie ; ici on ne fait plus qu'ouvrir.
     *
     * **Aucune cryptographie n'est écrite ici non plus.** L'enveloppe et son ouverture sont
     * `wrap_user_key_for_passkey` / `unlock_with_passkey` du cœur Rust, déjà écrites,
     * déjà éprouvées, et partagées avec le déverrouillage par passkey du web. Le seul
     * écart est la provenance du secret : une passkey côté web, le KeyStore ici. Le cœur
     * ne fait pas la différence, et c'est bien qu'il ne la fasse pas — c'est ce qui évite
     * d'inventer un second format d'enveloppe pour Android.
     *
     * @param secret le secret d'enveloppe en base64, sorti du KeyStore.
     * @param uskEnveloppee l'`EncString` rendue par [envelopperLaCle].
     */
    fun rouvrirParEnveloppe(session: Session, secret: String, uskEnveloppee: String, jetonConnu: String?) {
        compte = Account.withPasskey(secret, uskEnveloppee, session.encryptedPrivateKey)
        client = ClientApi(session.adresseServeur)
        jeton = jetonConnu
        this.session = session
    }

    /**
     * Enveloppe la clé du coffre sous un secret, pour la persister (ADR-0002).
     *
     * Rend l'`EncString` à écrire sur l'appareil. Le secret, lui, ne s'écrit pas ici : il
     * part sous la clé du KeyStore, chez l'appelant.
     */
    fun envelopperLaCle(secret: String): String {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        return c.wrapUserKeyForPasskey(secret)
    }

    /** Verrouille : les clés partent, la session reste. */
    fun verrouiller() {
        compte?.close()
        compte = null
    }

    /** Ferme la session pour de bon. */
    fun fermerLaSession() {
        val j = jeton
        val c = client
        verrouiller()
        jeton = null
        session = null
        client = null
        if (j != null && c != null) c.deconnexion(j)
    }

    /** Va chercher les éléments et les lit. */
    fun lire(): LectureDuCoffre = relire(elementsDistants())

    /**
     * Les éléments **chiffrés**, tels que le serveur les rend.
     *
     * Séparé de [relire] pour que l'appelant puisse les mettre en cache avant de les
     * ouvrir : ce sont des octets que le serveur détient déjà, et les garder permet
     * d'afficher le coffre quand le réseau manque.
     */
    fun elementsDistants(): List<ElementChiffre> {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.elements(j)
    }

    /** Ouvre et ordonne une liste d'éléments chiffrés, d'où qu'elle vienne. */
    fun relire(elements: List<ElementChiffre>): LectureDuCoffre = lecture(elements, compte)

    /**
     * Écrit un nouvel élément, et **relit ce que le serveur a rangé**.
     *
     * Ce détour n'est pas de la prudence gratuite. Le serveur ne sait pas ce que contiennent
     * les deux blobs : il ne peut donc rien valider, et un blob tronqué en chemin serait
     * accepté sans un mot. La faute ne se verrait qu'à la lecture suivante, sur un autre
     * appareil, sous la forme d'une ligne illisible — et personne ne saurait dire quand
     * elle est devenue illisible. On rouvre ici ce qu'on vient d'écrire : si l'aller-retour
     * ne rend pas l'élément, l'écriture échoue tout de suite, à l'endroit qui l'a causée.
     */
    fun creer(element: ElementDuCoffre): EntreeDuCoffre.Lisible {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val (cle, donnees) = sceller(element, c)
        val range = api.creerUnElement(j, cle, donnees)
        return EntreeDuCoffre.Lisible(range.id, ouvrir(range, c), range.updatedAt)
    }

    /** Remplace un élément existant, et relit de même. */
    fun mettreAJour(id: String, element: ElementDuCoffre): EntreeDuCoffre.Lisible {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val (cle, donnees) = sceller(element, c)
        val range = api.remplacerUnElement(j, id, cle, donnees)
        return EntreeDuCoffre.Lisible(range.id, ouvrir(range, c), range.updatedAt)
    }

    /**
     * Écrit un registre à nom réservé (§2).
     *
     * Un registre est un élément comme un autre : une note sécurisée dont le contenu est du
     * JSON, sous un nom commençant par un **octet NUL**. Rien ici n'est spécial sauf le nom —
     * et c'est le nom qui fait tout, puisque aucun clavier ne produit de NUL et qu'aucun nom
     * d'utilisateur ne peut donc usurper un registre.
     *
     * `idExistant` décide entre créer et remplacer. Le deviner serait coûteux dans les deux
     * sens : créer alors qu'il existe donnerait **deux** registres du même nom, dont un
     * seul serait lu — et l'autre resterait à contredire le premier chez le prochain client.
     * L'appelant le tient de `LectureDuCoffre.identifiantsDeRegistres`, qui existe pour ça.
     */
    fun ecrireUnRegistre(nom: String, contenu: String, idExistant: String?): EntreeDuCoffre.Lisible {
        require(nom.startsWith(Registres.PREFIXE)) {
            "« $nom » ne commence pas par le préfixe réservé : ce serait un élément " +
                "ordinaire, visible dans la liste de l'utilisateur"
        }
        val element = elementDeRegistre(nom, contenu)
        return if (idExistant == null) creer(element) else mettreAJour(idExistant, element)
    }

    // ─── Les coffres d'équipe ───

    /**
     * Les organisations dont l'utilisateur est membre, **y compris les invitations**.
     *
     * Une invitation en attente n'a pas de contenu lisible : la montrer comme vide serait
     * faux, et l'omettre pire encore. C'est l'écran qui dira qu'elle attend.
     */
    fun organisations(): List<Organisation> {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.organisations(j).map(Organisation::depuis).sortedBy { it.nom.lowercase() }
    }

    /** Une organisation ouverte : son Org Key en mémoire, et ses collections. */
    class CoffreDOrganisation(
        val organisation: Organisation,
        val collections: List<CollectionDOrganisation>,
        internal val org: uniffi.ghost_crypto_ffi.Org,
    ) : AutoCloseable {
        override fun close() = org.close()
    }

    /**
     * Ouvre une organisation : récupère l'Org Key scellée et la fait ouvrir par le cœur.
     *
     * **`openOrg` vérifie que la clé provient bien de la clé publique annoncée.** Sans cette
     * vérification, un serveur actif pourrait substituer une Org Key de son choix et lire
     * ensuite tout ce que le membre écrirait dans l'organisation. C'est le cœur qui la fait ;
     * on ne fait que lui passer les deux valeurs.
     *
     * Rend un [EchecDOrganisation] plutôt que de lever : **une organisation qui ne s'ouvre
     * pas ne doit pas vider l'écran**, et les autres doivent s'afficher quand même.
     */
    fun ouvrirLOrganisation(organisation: Organisation): Result<CoffreDOrganisation> {
        val compteOuvert = compte ?: return Result.failure(ErreurApi.CoffreVerrouille())
        val api = client ?: return Result.failure(ErreurApi.Reseau("Aucun serveur configuré."))
        val j = jeton ?: return Result.failure(ErreurApi.Reseau("Aucune session ouverte."))

        if (organisation.etat == EtatDAppartenance.Invite) {
            return Result.failure(EchecDOuverture(EchecDOrganisation.InvitationEnAttente))
        }
        val appartenance = try {
            api.appartenance(j, organisation.id)
        } catch (e: Exception) {
            return Result.failure(
                EchecDOuverture(EchecDOrganisation.Reseau(e.message ?: "serveur injoignable")))
        }
        val scellee = appartenance.encryptedOrgKey
        val clePubliqueDeLAdmin = appartenance.sealedByPublicKey
        if (scellee.isNullOrEmpty() || clePubliqueDeLAdmin.isNullOrEmpty()) {
            return Result.failure(EchecDOuverture(EchecDOrganisation.AucuneCleRemise))
        }

        val org = try {
            compteOuvert.openOrg(clePubliqueDeLAdmin, scellee)
        } catch (e: Exception) {
            return Result.failure(
                EchecDOuverture(EchecDOrganisation.CleRefusee(e.message ?: "sceau refusé")))
        }
        val role = RoleDOrganisation.depuis(appartenance.role).takeIf {
            it != RoleDOrganisation.Inconnu
        } ?: organisation.role
        val collections = try {
            api.collectionsDOrganisation(j, organisation.id).map {
                CollectionDOrganisation(
                    id = it.id,
                    nom = it.name.ifBlank { it.id },
                    permission = PermissionDeCollection.depuis(it.permission, role),
                )
            }
        } catch (e: Exception) {
            org.close()
            return Result.failure(
                EchecDOuverture(EchecDOrganisation.Reseau(e.message ?: "serveur injoignable")))
        }
        return Result.success(CoffreDOrganisation(organisation, collections, org))
    }

    /**
     * Les éléments d'une collection, lus **sous l'Org Key**.
     *
     * La même [lectureSous] que le coffre personnel : une ligne qu'on ne sait pas ouvrir
     * garde sa place et dit pourquoi.
     */
    fun elementsDeCollection(ouvert: CoffreDOrganisation, collection: String): LectureDuCoffre {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val elements = api.elementsDeCollection(j, ouvert.organisation.id, collection)
        return lectureSous(elements) { chiffre -> ouvrirSousOrg(chiffre, ouvert.org) }
    }

    /** Accepte une invitation. Le contenu ne devient lisible qu'ensuite. */
    fun accepterLOrganisation(id: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.accepterLOrganisation(j, id)
    }

    /** Porte un [EchecDOrganisation] dans un `Result`. */
    class EchecDOuverture(val motif: EchecDOrganisation) : Exception(message(motif)) {
        companion object {
            fun message(motif: EchecDOrganisation): String = when (motif) {
                EchecDOrganisation.InvitationEnAttente ->
                    "Vous n'avez pas encore accepté cette invitation."
                EchecDOrganisation.AucuneCleRemise ->
                    "Aucune clé ne vous a encore été remise pour ce coffre d'équipe."
                is EchecDOrganisation.CleRefusee ->
                    "La clé de ce coffre d'équipe n'a pas pu être ouverte."
                is EchecDOrganisation.Reseau -> motif.message
            }
        }
    }

    // ─── La corbeille ───

    /**
     * Ce que la corbeille contient, lu **comme le coffre**.
     *
     * La même fonction [lecture] : un élément qu'on ne sait pas ouvrir garde sa place ici
     * aussi. C'est même plus important qu'ailleurs — la corbeille est le dernier endroit où
     * l'on peut encore rattraper quelque chose, et une ligne qui y disparaîtrait serait
     * perdue sans que personne ne l'ait décidé.
     */
    fun lireLaCorbeille(): LectureDuCoffre {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return lecture(api.elementsDeLaCorbeille(j), compte)
    }

    /** Sort un élément de la corbeille. */
    fun restaurer(id: String) {
        compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.restaurerUnElement(j, id)
    }

    /**
     * Détruit un élément pour de bon.
     *
     * **Le coffre doit être ouvert**, alors que le serveur ne l'exigerait pas — le jeton
     * suffirait. C'est la même règle que pour la mise à la corbeille, et elle compte
     * davantage ici : détruire une ligne qu'on ne sait pas lire, c'est jeter ce dont on
     * ignore le contenu.
     */
    fun purger(id: String) {
        compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.purgerUnElement(j, id)
    }

    // ─── Le partage de lien (§4) ───

    /** Ce qu'une demande de partage produit. */
    sealed interface Partage {
        /** Le lien est prêt à être remis. [inscription] est nulle si rien n'est révocable. */
        data class Pret(val lien: String, val inscription: PartageEnCours?) : Partage

        /**
         * La destination n'est pas celle du serveur configuré : **à montrer et à confirmer**.
         *
         * Le partage existe déjà côté serveur à cet instant — c'est lui qui vient de le
         * créer. Un refus doit donc le **révoquer**, sans quoi on laisse derrière soi un
         * secret publié que personne ne surveille.
         */
        data class ADemander(
            val hote: String,
            val lien: String,
            val cree: PartageCree,
            val inscription: PartageEnCours?,
        ) : Partage

        /** Refusé sans appel : rétrogradation de schéma, ou lien sans hôte. */
        data class Refuse(val raison: String) : Partage
    }

    /**
     * Scelle un secret et crée un lien de partage.
     *
     * **L'enveloppe n'est pas celle du coffre** : `sealSend` du cœur produit de l'AES-256-GCM
     * à nonce de douze octets, parce que le format est arbitré par le **navigateur** qui
     * ouvrira le lien — WebCrypto offre AES-GCM et n'offre pas XChaCha20. Confondre les deux
     * a rendu le partage mobile impossible pendant plusieurs jours, le relais refusant
     * « expected 12 bytes after decode, got 24 ».
     *
     * Le contrôle de destination se fait **avant que la clé ne soit remise à l'utilisateur** :
     * une fois le lien affiché, il est trop tard pour demander.
     */
    fun partager(
        secret: String,
        heures: Int,
        consultations: Int,
        nom: String,
        approuves: Set<String>,
    ): Partage {
        compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val s = session ?: throw ErreurApi.Reseau("Aucune session ouverte.")

        val scelle = uniffi.ghost_crypto_ffi.sealSend(secret)
        val cree = api.creerUnPartage(j, scelle.ciphertext, scelle.nonce, heures, consultations)

        val lien = lienDePartage(cree, s.adresseServeur, scelle.key)

        val inscription = cree.deleteToken?.let { jetonDeSuppression ->
            PartageEnCours(
                id = cree.id,
                url = lien,
                deleteToken = jetonDeSuppression,
                name = nom,
                createdAt = System.currentTimeMillis() / 1000,
                expiresAt = secondesPlausibles(cree.expiresAt),
            )
        }

        if (DestinationDePartage.estDeConfiance(lien, s.adresseServeur, approuves)) {
            return Partage.Pret(lien, inscription)
        }
        if (!DestinationDePartage.demandeUneConfirmation(lien, s.adresseServeur, approuves)) {
            // Une rétrogradation de schéma ne se confirme pas, elle se refuse — et le
            // partage créé doit partir avec.
            revoquerSiPossible(cree)
            return Partage.Refuse(
                "Le serveur a rendu un lien en clair alors qu'il est joint en HTTPS. " +
                    "Le partage a été annulé.",
            )
        }
        if (cree.deleteToken == null) {
            // Une destination étrangère sans jeton de révocation : on ne pourrait pas
            // reprendre le partage si l'utilisateur refusait. On refuse donc d'emblée
            // plutôt que de poser une question dont une des réponses est impossible à tenir.
            return Partage.Refuse(
                "Le serveur a rendu un lien vers un autre domaine sans jeton de révocation : " +
                    "impossible de reprendre ce partage. Rien ne sera affiché.",
            )
        }
        return Partage.ADemander(AdresseServeur.hote(lien).orEmpty(), lien, cree, inscription)
    }

    /** Révoque un partage. Sans jeton, il n'y a pas de route : on ne prétend pas le faire. */
    fun revoquerUnPartage(id: String, jetonDeSuppression: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.revoquerUnPartage(j, id, jetonDeSuppression)
    }

    private fun revoquerSiPossible(cree: PartageCree) {
        val jetonDeSuppression = cree.deleteToken ?: return
        runCatching { revoquerUnPartage(cree.id, jetonDeSuppression) }
    }

    /**
     * Met un élément à la corbeille.
     *
     * Le coffre doit être **ouvert** pour supprimer, alors que le serveur ne l'exigerait
     * pas : le jeton suffirait. C'est délibéré — supprimer une ligne qu'on ne sait pas lire
     * revient à jeter ce dont on ignore le contenu, et c'est exactement ce qui arriverait à
     * une ligne illisible de quelqu'un d'autre.
     */
    fun supprimer(id: String) {
        compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.mettreALaCorbeille(j, id)
    }

    companion object {
    /**
     * Déchiffre, récolte les registres, ordonne — et **garde ce qui ne s'est pas ouvert**.
     *
     * Le pivot du §5 est le `when` ci-dessous : là où iOS écrit
     * `guard let item = try? decrypt(dto) else { continue }`, on produit ici une
     * [EntreeDuCoffre.Illisible]. La ligne garde sa place et dit pourquoi.
     *
     * Fonction **pure**, comme son équivalent iOS (`VaultStore.lecture`, une méthode
     * statique) : elle prend les éléments et la clé, et rend une lecture. C'est ce qui la
     * rend éprouvable sans serveur, sans session et sans état — un test lui passe deux
     * comptes réels et vérifie ce qu'elle fait de ce qu'elle n'ouvre pas.
     *
     * @param compte la clé d'enveloppe, ou `null` si le coffre est verrouillé — auquel cas
     *   **toutes** les lignes deviennent illisibles, et aucune ne disparaît.
     */
    fun lecture(elements: List<ElementChiffre>, compte: Account?): LectureDuCoffre =
        lectureSous(elements, compte?.let { c -> { chiffre -> ouvrir(chiffre, c) } })

    /**
     * La même lecture, sous **n'importe quelle clé**.
     *
     * Le coffre personnel s'ouvre sous la clé de l'utilisateur, une collection d'équipe sous
     * l'Org Key. Les deux suivent exactement les mêmes règles — une ligne qu'on ne sait pas
     * ouvrir garde sa place, les registres se récoltent et se masquent — et les écrire deux
     * fois les ferait diverger.
     *
     * C'est même **plus** vrai côté équipe : l'élément a été scellé par quelqu'un d'autre, et
     * son absence se lirait « cette personne ne l'a pas encore créé ». iOS écartait en
     * silence des deux côtés ; ne réintroduisons pas le défaut par la porte des
     * organisations.
     *
     * @param ouvreur `null` quand aucune clé n'est disponible — **toutes** les lignes
     *   deviennent alors illisibles, et aucune ne disparaît.
     */
    fun lectureSous(
        elements: List<ElementChiffre>,
        ouvreur: ((ElementChiffre) -> ElementDuCoffre)?,
    ): LectureDuCoffre {
        val compteOuvert = ouvreur
        val entrees = mutableListOf<EntreeDuCoffre>()
        var dossiers = emptyList<String>()
        var favoris = emptySet<String>()
        var partages = emptyList<PartageEnCours>()
        var couleurs = emptyMap<String, String>()
        val idsDeRegistres = mutableMapOf<String, String>()

        for (chiffre in elements) {
            if (compteOuvert == null) {
                entrees += EntreeDuCoffre.Illisible(
                    chiffre.id, RaisonDIllisibilite.CleManquante, chiffre.updatedAt)
                continue
            }
            val element = try {
                compteOuvert(chiffre)
            } catch (e: GhostCryptoException) {
                // Le cœur a refusé l'enveloppe.
                entrees += EntreeDuCoffre.Illisible(
                    chiffre.id,
                    RaisonDIllisibilite.SceauRefuse(e.message ?: "enveloppe refusée"),
                    chiffre.updatedAt,
                )
                continue
            } catch (e: Exception) {
                // L'enveloppe s'est ouverte, mais son contenu a une forme inconnue. La
                // cryptographie a fonctionné : le dire, pour ne pas envoyer quelqu'un
                // chercher un problème de clé qui n'existe pas.
                entrees += EntreeDuCoffre.Illisible(
                    chiffre.id,
                    RaisonDIllisibilite.ContenuInconnu(e.message ?: "contenu illisible"),
                    chiffre.updatedAt,
                )
                continue
            }

            if (element.estUnRegistre) {
                idsDeRegistres[element.name] = chiffre.id
                when (element.name) {
                    Registres.DOSSIERS -> dossiers = Registres.listeDe(element)
                    Registres.FAVORIS -> favoris = Registres.listeDe(element).toSet()
                    Registres.PARTAGES -> partages = Registres.partagesDe(element)
                    Registres.COULEURS_DEQUIPE -> couleurs = Registres.couleursDe(element)
                    // Un registre d'une version plus récente, ou d'un autre produit de la
                    // suite : on ne sait pas le lire, mais on sait ne pas l'afficher.
                    else -> Unit
                }
                continue
            }
            entrees += EntreeDuCoffre.Lisible(chiffre.id, element, chiffre.updatedAt)
        }

        // Les lignes ouvertes s'ordonnent par nom, sans tenir compte de la casse. Les
        // illisibles n'ont pas de nom — les mettre en tête serait arbitraire, les cacher en
        // queue serait les enterrer. Elles gardent leur rang d'arrivée parmi les autres,
        // ce qui est la seule place qu'on puisse leur donner honnêtement.
        val ordonnees = entrees.sortedWith(
            compareBy(String.CASE_INSENSITIVE_ORDER) { entree ->
                when (entree) {
                    is EntreeDuCoffre.Lisible -> entree.element.name
                    is EntreeDuCoffre.Illisible -> ""
                }
            },
        )

        return LectureDuCoffre(
            entrees = ordonnees,
            dossiersVides = dossiers.sorted(),
            favoris = favoris,
            partages = partages,
            couleursDEquipe = couleurs,
            identifiantsDeRegistres = idsDeRegistres,
        )
    }

        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Garde un horodatage **seulement s'il ressemble à des secondes**.
         *
         * `contrat.json` fixe le registre des partages en secondes, sur dix chiffres jusqu'en
         * 2286. La valeur vient d'un service de partage tiers, par un relais qui ne fait que
         * la transmettre : rien dans ce dépôt n'en garantit l'unité.
         *
         * On préfère **ne rien inscrire** à inscrire une valeur mille fois trop grande. Une
         * date affichée en l'an 56 000 se remarque, mais une date affichée par un *autre*
         * client, à partir d'un registre partagé, se lit comme une donnée — et personne ne
         * saurait dire de quel côté est l'erreur. Convertir à la volée serait pire encore :
         * ce serait deviner l'unité d'un champ dont c'est justement l'unité qui est en jeu.
         */
        /**
         * L'élément que porte un registre.
         *
         * Isolé pour être **éprouvable sans serveur** : un test peut le sceller, le relire
         * par [lecture], et vérifier que ce qu'on écrit est bien ce qu'on lit. La forme —
         * une note sécurisée dont le contenu est du JSON — n'est pas arbitraire : c'est
         * celle que lisent les autres clients, et s'en écarter donnerait un registre que
         * seul Android saurait relire.
         */
        fun elementDeRegistre(nom: String, contenu: String): ElementDuCoffre = ElementDuCoffre(
            name = nom,
            notes = null,
            folder = null,
            data = ContenuDElement.NoteSecrete(Note(contenu)),
        )

        /**
         * Le lien d'un partage, fragment compris.
         *
         * Deux choses s'y décident, et les deux ont déjà coûté :
         *
         *  - **l'adresse**. Le serveur à relais en rend une, et la reconstruire depuis
         *    l'identifiant produirait un lien vers une machine qui ne connaît pas ce partage.
         *    Le serveur antérieur n'en rend pas, et là c'est l'inverse : la déduire est la
         *    seule chose juste à faire ;
         *  - **le fragment**. Le cœur rend du base64 standard ; une URL réclame la variante
         *    `base64url` sans remplissage. `contrat.json` le dit dans `share_envelope.transport`
         *    et prévient de l'erreur : n'accepter que le base64 standard échoue sur
         *    « Invalid padding », un message qui accuse le format et laisse croire à une clé
         *    corrompue.
         */
        fun lienDePartage(cree: PartageCree, adresseServeur: String, cle: String): String {
            val base = cree.url ?: DestinationDePartage.lienDeRepli(adresseServeur, cree.id)
            val fragment = cle.replace('+', '-').replace('/', '_').trimEnd('=')
            return "$base#$fragment"
        }

        fun secondesPlausibles(valeur: Long?): Long? {
            if (valeur == null) return null
            // 1e11 secondes ≈ l'an 5138 ; 1e11 millisecondes ≈ 1973. Au-delà, ce ne sont
            // pas des secondes.
            return if (valeur in 1..99_999_999_999L) valeur else null
        }

        /**
         * Le seul point où camelCase devient snake_case.
         *
         * L'API expose `encryptedKey` / `encryptedData`, à plat, avec un `id` ; le cœur
         * attend `{"encrypted_key":…,"encrypted_data":…}` et rien d'autre. Aucun des deux
         * ne se plaindrait de recevoir les noms de l'autre : `serde` rendrait simplement
         * « champ manquant », et un client qui construirait l'enveloppe ailleurs, autrement,
         * finirait par diverger. La conversion tient donc ici, une fois.
         */
        fun ouvrir(chiffre: ElementChiffre, compte: Account): ElementDuCoffre {
            val enveloppe = buildJsonObject {
                put("encrypted_key", chiffre.encryptedKey)
                put("encrypted_data", chiffre.encryptedData)
            }
            val clair = compte.decryptItem(json.encodeToString(
                kotlinx.serialization.json.JsonObject.serializer(), enveloppe))
            return CodecDElement.lire(clair)
        }

        /**
         * La même ouverture, **sous l'Org Key** d'une organisation.
         *
         * L'enveloppe se construit à l'identique — c'est la clé qui change, pas le format.
         * Deux constructions séparées finiraient par diverger sur le passage camelCase
         * vers snake_case, et le second à diverger serait celui qu'on regarde le moins.
         */
        fun ouvrirSousOrg(
            chiffre: ElementChiffre,
            org: uniffi.ghost_crypto_ffi.Org,
        ): ElementDuCoffre {
            val enveloppe = buildJsonObject {
                put("encrypted_key", chiffre.encryptedKey)
                put("encrypted_data", chiffre.encryptedData)
            }
            val clair = org.decryptItem(
                json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), enveloppe))
            return CodecDElement.lire(clair)
        }

        /** L'inverse : rend le couple `(encryptedKey, encryptedData)` à envoyer au serveur. */
        fun sceller(element: ElementDuCoffre, compte: Account): Pair<String, String> {
            val scelle = compte.encryptItem(CodecDElement.ecrire(element))
            val objet = json.parseToJsonElement(scelle) as kotlinx.serialization.json.JsonObject
            val cle = objet["encrypted_key"]?.let {
                (it as kotlinx.serialization.json.JsonPrimitive).content
            } ?: throw ErreurApi.ReponseIllisible()
            val donnees = objet["encrypted_data"]?.let {
                (it as kotlinx.serialization.json.JsonPrimitive).content
            } ?: throw ErreurApi.ReponseIllisible()
            return cle to donnees
        }
    }
}
