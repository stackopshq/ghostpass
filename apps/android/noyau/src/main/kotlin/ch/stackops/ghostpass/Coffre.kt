package ch.stackops.ghostpass

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import uniffi.ghost_crypto_ffi.Account
import uniffi.ghost_crypto_ffi.GhostCryptoException
import uniffi.ghost_crypto_ffi.masterPasswordHash
import uniffi.ghost_crypto_ffi.recover

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

    // ─── Les icônes des sites ───

    /** L'adresse du serveur de la session ouverte, pour y accrocher les URL d'icônes. */
    val adresseDuServeur: String? get() = session?.adresseServeur

    /**
     * Demande un jeton d'icône. `null` si le serveur refuse ou ne connaît pas la route.
     *
     * L'échec ne remonte pas en exception : une instance plus ancienne que le relais
     * d'icônes répond `404`, ce qui n'est pas une panne, et une bannière d'erreur pour des
     * logos serait du bruit. Sans jeton, la liste reste parfaitement lisible avec ses
     * initiales — voir [IconeDeSite.url], qui ne fabrique alors aucune URL.
     */
    fun jetonDIcone(): String? {
        val api = client ?: return null
        val j = jeton ?: return null
        return try {
            api.jetonDIcone(j).token.ifEmpty { null }
        } catch (_: ErreurApi) {
            null
        }
    }

    // ─── Le second facteur du compte ───

    /**
     * Le second facteur est-il actif ?
     *
     * **`null` veut dire « ce serveur ne propose pas la fonction »**, et non « non ». Le
     * serveur répond alors 404, ce qui n'est pas une panne : l'instance est simplement plus
     * ancienne que la fonctionnalité. Les aplatir sur `false` ferait proposer d'activer un
     * second facteur qui n'existe pas là-bas, et l'échec surviendrait après que
     * l'utilisateur a saisi son mot de passe maître.
     */
    fun secondFacteurActif(): Boolean? {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return try {
            api.secondFacteurActif(j)
        } catch (e: ErreurApi.Http) {
            if (e.statut == 404) null else throw e
        }
    }

    /**
     * Prépare un second facteur : le serveur rend le secret et l'URI `otpauth`.
     *
     * Le mot de passe maître **ne traverse pas** : le cœur Rust en dérive l'empreinte
     * d'authentification, et c'est elle qui part. C'est la même empreinte qu'à la connexion,
     * et le serveur ne peut rien en faire d'autre que la comparer.
     */
    fun preparerLeSecondFacteur(motDePasse: String): ConfigurationDuSecondFacteur {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val s = session ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val empreinte = masterPasswordHash(motDePasse, s.email, s.kdfParams)
        return api.preparerLeSecondFacteur(j, empreinte)
    }

    fun confirmerLeSecondFacteur(code: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.confirmerLeSecondFacteur(j, code)
    }

    fun retirerLeSecondFacteur(motDePasse: String, code: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val s = session ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val empreinte = masterPasswordHash(motDePasse, s.email, s.kdfParams)
        api.retirerLeSecondFacteur(j, empreinte, code)
    }

    // ─── L'accès d'urgence ───

    /**
     * Confie la lecture de son coffre à un contact, sous condition de délai.
     *
     * **C'est le seul endroit du produit où la clé d'un coffre est scellée vers un tiers.**
     * Tout le reste est scellé pour soi-même, ou pour une organisation dont on est membre.
     * Ici la clé du coffre part, enveloppée vers la clé publique du contact, et le serveur
     * la garde sans pouvoir l'ouvrir.
     *
     * La clé publique vient du **serveur**, pas de l'utilisateur : c'est ce qui rend
     * l'opération possible sans échange hors bande, et c'est aussi ce qui en fixe la limite.
     * Un serveur malveillant pourrait annoncer sa propre clé et lire le coffre. Le modèle de
     * menace l'assume — c'est la même hypothèse que pour les coffres d'équipe — et c'est la
     * raison pour laquelle l'écran nomme le contact et son rôle en toutes lettres avant de
     * demander confirmation : ce qu'on ne peut pas empêcher par la cryptographie, on le rend
     * au moins visible.
     */
    fun inviterUnContactDUrgence(email: String, role: String, joursDAttente: Int) {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val contact = api.clePubliqueAnnoncee(j, email)
        val scelle = c.sealUserKeyFor(contact.publicKey)
        api.inviterUnContactDUrgence(j, email, role, joursDAttente, scelle)
    }

    fun liensDUrgence(): LiensDUrgenceDto {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.liensDUrgence(j)
    }

    fun agirSurUnLienDUrgence(id: String, action: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.agirSurUnLienDUrgence(j, id, action)
    }

    fun revoquerUnLienDUrgence(id: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.revoquerUnLienDUrgence(j, id)
    }

    /**
     * Le coffre d'un donneur, ouvert par l'enveloppe qu'il nous avait scellée.
     *
     * **Les registres sont écartés**, comme partout ailleurs : ce sont des données de
     * l'application, et les montrer ici ferait apparaître des lignes au nom illisible dans
     * le coffre de quelqu'un d'autre — au moment précisément le moins propice aux questions.
     *
     * Les lignes qui ne s'ouvrent pas **gardent leur place**, elles. C'est la règle §5, et
     * elle vaut ici plus qu'ailleurs : un contact qui hérite d'un coffre doit savoir qu'il
     * existe des éléments qu'il ne peut pas lire — typiquement ceux d'une équipe, scellés
     * sous une Org Key dont il n'est pas membre. Leur absence se lirait « il n'y avait que
     * ça », et personne ne saurait jamais qu'il manque quelque chose.
     */
    fun ouvrirUnCoffreDUrgence(id: String): CoffreDUrgenceOuvert {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val acces = api.accesDUrgence(j, id)
        val coffre = c.openEmergency(acces.grantorPublicKey, acces.sealedUserKey)
        val entrees = acces.items.mapNotNull { chiffre ->
            val element = try {
                ouvrirEnUrgence(chiffre, coffre)
            } catch (e: Exception) {
                return@mapNotNull EntreeDuCoffre.Illisible(
                    chiffre.id, RaisonDIllisibilite.CleManquante, chiffre.updatedAt,
                )
            }
            if (element.estUnRegistre) null
            else EntreeDuCoffre.Lisible(chiffre.id, element, chiffre.updatedAt)
        }
        return CoffreDUrgenceOuvert(
            lien = id,
            role = acces.role,
            donneur = acces.grantorEmail,
            kdfParams = acces.grantorKdfParams,
            entrees = entrees.sortedWith(
                compareBy(String.CASE_INSENSITIVE_ORDER) {
                    (it as? EntreeDuCoffre.Lisible)?.element?.name ?: ""
                },
            ),
            coffre = coffre,
        )
    }

    /**
     * Reprise : impose un nouveau mot de passe maître au donneur.
     *
     * **Cela l'exclut de son propre coffre** tant qu'il ne l'apprend pas. Le serveur révoque
     * en outre toutes ses sessions. C'est l'opération la plus lourde du produit, et l'écran
     * qui la déclenche doit le dire avant, pas après.
     *
     * Le calcul est fait par le cœur, qui rechiffre la clé du coffre sous le nouveau mot de
     * passe : le contact n'apprend rien de plus qu'il ne savait déjà, puisqu'il lisait
     * le coffre.
     */
    fun reprendreLeCompte(ouvert: CoffreDUrgenceOuvert, nouveauMotDePasse: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val remise = RepriseDUrgence.depuisLeCoeur(
            ouvert.coffre.takeover(ouvert.donneur, ouvert.kdfParams, nouveauMotDePasse),
        )
        api.reprendreLeCompte(
            j, ouvert.lien, remise.empreinteDuMotDePasse, remise.cleUtilisateur,
        )
    }

    /** Un coffre d'urgence ouvert : ce qu'on y lit, et de quoi le reprendre. */
    class CoffreDUrgenceOuvert(
        val lien: String,
        val role: String,
        val donneur: String,
        val kdfParams: String,
        val entrees: List<EntreeDuCoffre>,
        val coffre: uniffi.ghost_crypto_ffi.EmergencyVault,
    )

    // ─── La clé de récupération ───

    /**
     * Crée une clé de récupération et l'enregistre auprès du serveur.
     *
     * **La clé rendue ici ne s'écrit nulle part.** Le serveur n'en reçoit qu'une preuve
     * re-hachée et la clé du coffre enveloppée pour elle ; l'application ne la garde pas.
     * C'est ce qui fait que personne d'autre ne peut s'en servir — et ce qui rend l'écran
     * qui l'affiche irremplaçable, puisqu'il n'y aura pas de seconde fois.
     *
     * Le cœur Rust fabrique le tout : `Account.createRecovery()` rend un JSON dont les noms
     * de champs sont ceux de serde. **Ils ne se traduisent pas** — `recovery_auth_hash` et
     * non `recoveryAuthHash` —, et un champ renommé ici ne casserait aucune compilation : il
     * arriverait vide au serveur, qui enregistrerait un kit inutilisable. On ne s'en
     * apercevrait que le jour où quelqu'un a oublié son mot de passe.
     */
    fun creerUneCleDeRecuperation(): String {
        val c = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val kit = KitDeRecuperation.depuisLeCoeur(c.createRecovery())
        // Enregistré **avant** d'être rendu : une clé affichée que le serveur n'a pas reçue
        // est pire qu'aucune clé. Quelqu'un la noterait soigneusement, et elle ne servirait
        // à rien le jour venu.
        api.enregistrerLaRecuperation(j, kit.preuve, kit.cleUtilisateurEnveloppee)
        return kit.cle
    }

    /** La clé de récupération ne s'écrit nulle part ; cet objet ne la garde pas non plus. */
    fun recuperer(
        adresseServeur: String,
        email: String,
        cleDeRecuperation: String,
        nouveauMotDePasse: String,
    ) {
        val adresse = AdresseServeur.normaliser(adresseServeur)
            ?: throw ErreurApi.AdresseInvalide()
        val api = ClientApi(adresse)
        val enveloppes = api.enveloppesDeRecuperation(email)
        // `recover` est une **fonction libre** du binding, pas une méthode d'`Account` : il
        // n'y a aucun compte ouvert au moment où on l'appelle.
        val resultat = recover(
            cleDeRecuperation.trim(), email, nouveauMotDePasse,
            enveloppes.kdfParams, enveloppes.encryptedUserKeyRecovery,
            enveloppes.encryptedPrivateKey,
        )
        val remise = RemiseDeRecuperation.depuisLeCoeur(resultat.reset())
        api.recuperer(
            email, remise.preuve, remise.empreinteDuMotDePasse, remise.cleUtilisateur,
        )
    }

    // ─── Le journal du compte ───

    /** Les connexions enregistrées, les plus récentes telles que le serveur les ordonne. */
    fun connexionsDuCompte(): List<ConnexionDto> {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.connexionsDuCompte(j)
    }

    /** Les actions sensibles enregistrées sur le compte. */
    fun actionsDuCompte(): List<ActionDto> {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.actionsDuCompte(j)
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
        /**
         * L'Org Key scellée **telle qu'elle était à l'ouverture**.
         *
         * Elle ne sert qu'à une chose, et cette chose est la plus silencieuse de tout le
         * partage d'équipe : détecter qu'un administrateur a **fait tourner la clé** pendant
         * que cette session était ouverte. Voir [Coffre.exigerLaCleCourante].
         */
        internal val cleALOuverture: String,
    ) : AutoCloseable {
        override fun close() = org.close()
    }

    /** La clé d'organisation a tourné depuis l'ouverture : il faut la rouvrir avant d'écrire. */
    class CleDOrganisationPerimee : ErreurApi(
        "La clé de ce coffre d'équipe a changé depuis son ouverture. Rouvrez-le avant " +
            "d'enregistrer : votre modification serait illisible pour les autres membres.",
    )

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
        return Result.success(
            CoffreDOrganisation(organisation, collections, org, cleALOuverture = scellee))
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

    /**
     * **Refuse d'écrire si l'Org Key a tourné depuis l'ouverture.**
     *
     * C'est le piège le plus coûteux de l'écriture d'équipe, et il ne produit aucune erreur
     * chez celui qui le commet. Un administrateur retire un membre : la clé tourne, les
     * éléments sont ré-enveloppés vers la nouvelle. Une session ouverte avant la rotation
     * détient encore l'ancienne. Si elle enregistre, elle scelle **sous une génération
     * retirée** : le serveur accepte, l'écran affiche « enregistré », et l'élément est
     * illisible pour tous ceux qui n'ont que la nouvelle clé — y compris son auteur, à sa
     * prochaine ouverture.
     *
     * On compare donc l'Org Key scellée que le serveur rend **maintenant** avec celle qui a
     * servi à ouvrir. Une seule requête, avant chaque écriture : c'est peu cher pour la
     * seule vérification qui distingue « scellé sous la bonne clé » de « scellé sous une
     * clé qui l'était ».
     *
     * Ce contrôle n'est pas une course parfaite — la rotation peut survenir entre la
     * vérification et l'envoi. Il ferme la fenêtre des minutes, pas celle des
     * millisecondes, et c'est la fenêtre qui existe en pratique.
     */
    private fun exigerLaCleCourante(ouvert: CoffreDOrganisation) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val actuelle = api.appartenance(j, ouvert.organisation.id).encryptedOrgKey
        if (actuelle != ouvert.cleALOuverture) throw CleDOrganisationPerimee()
    }

    /**
     * Crée un élément dans une collection d'équipe, **scellé sous l'Org Key courante**.
     *
     * Comme pour le coffre personnel, on relit ce que le serveur a rangé : il ne sait pas ce
     * que contiennent les deux blobs, donc il ne peut rien valider, et un blob tronqué en
     * chemin ne se verrait qu'à la lecture suivante — chez quelqu'un d'autre.
     */
    fun creerDansCollection(
        ouvert: CoffreDOrganisation,
        collection: String,
        element: ElementDuCoffre,
    ): EntreeDuCoffre.Lisible {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        exigerLaCleCourante(ouvert)
        val (cle, donnees) = scellerSousOrg(element, ouvert.org)
        val range = api.creerUnElementDOrganisation(
            j, ouvert.organisation.id, collection, cle, donnees)
        return EntreeDuCoffre.Lisible(range.id, ouvrirSousOrg(range, ouvert.org), range.updatedAt)
    }

    /**
     * Remplace un élément d'équipe.
     *
     * **Le paramètre est l'entrée lisible, pas un identifiant.** C'est une garantie de type,
     * et elle porte la seconde règle : une entrée qu'on n'a **jamais su ouvrir** ne peut pas
     * être passée ici, donc ne peut pas être écrasée. Enregistrer par-dessus détruirait un
     * contenu que personne n'a lu — la seule façon de perdre pour de bon ce qui n'était que
     * temporairement inaccessible, par exemple en attendant qu'un administrateur remette la
     * bonne clé.
     *
     * Un identifiant nu aurait suffi au serveur. C'est précisément pour cela qu'on ne le
     * prend pas.
     */
    fun mettreAJourDansCollection(
        ouvert: CoffreDOrganisation,
        collection: String,
        entree: EntreeDuCoffre.Lisible,
        element: ElementDuCoffre,
    ): EntreeDuCoffre.Lisible {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        exigerLaCleCourante(ouvert)
        val (cle, donnees) = scellerSousOrg(element, ouvert.org)
        val range = api.remplacerUnElementDOrganisation(
            j, ouvert.organisation.id, collection, entree.id, cle, donnees)
        return EntreeDuCoffre.Lisible(range.id, ouvrirSousOrg(range, ouvert.org), range.updatedAt)
    }

    /**
     * Détruit un élément d'équipe. **Il n'y a pas de corbeille ici.**
     *
     * Même garantie de type que ci-dessus, et pour une raison plus forte encore : détruire
     * une ligne qu'on n'a jamais su lire, c'est jeter ce dont on ignore le contenu, sans
     * filet pour le rattraper.
     */
    fun supprimerDansCollection(
        ouvert: CoffreDOrganisation,
        collection: String,
        entree: EntreeDuCoffre.Lisible,
    ) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.supprimerUnElementDOrganisation(j, ouvert.organisation.id, collection, entree.id)
    }

    // ─── L'administration d'organisation ───

    /**
     * Les membres de l'organisation. **Réservé à l'administrateur** : un autre rôle reçoit
     * un 403, qui remonte tel quel plutôt que d'être traduit en liste vide — « je ne peux
     * pas voir » et « il n'y a personne » sont deux phrases différentes.
     */
    fun membresDe(ouvert: CoffreDOrganisation): List<MembreDto> {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.membresDOrganisation(j, ouvert.organisation.id)
    }

    /** Ce qu'une invitation exige avant d'être posée. */
    sealed interface Invitation {
        /**
         * **La clé publique du destinataire, telle que le serveur l'annonce — à confirmer.**
         *
         * Rien ne l'authentifie. Sceller l'Org Key vers elle sans contrôle, c'est laisser le
         * serveur désigner qui recevra la clé de l'équipe : la faute du §4, vue du côté de
         * l'émetteur. Un serveur actif qui substitue sa propre clé lit tout ce que l'équipe
         * écrira ensuite, et l'invité verrait seulement une organisation qui ne s'ouvre pas
         * — ce qui ressemble à une erreur ordinaire.
         *
         * On ne peut pas le vérifier depuis le client ; on peut refuser de le faire en
         * silence. [clePubliqueAnnoncee] doit être repassée à [poserLInvitation], et le nom
         * du champ voyage avec la valeur jusqu'à l'écran.
         */
        data class AConfirmer(
            val email: String,
            val userId: String,
            val clePubliqueAnnoncee: String,
        ) : Invitation

        /** Aucun compte pour cet email, ou le serveur refuse de le dire. */
        data class Inconnu(val email: String) : Invitation
    }

    /**
     * Première moitié d'une invitation : demander au serveur qui est cet email.
     *
     * **Elle ne scelle rien et n'écrit rien.** La séparation en deux temps est le seul
     * endroit où une confirmation humaine peut se glisser, et elle doit se glisser avant le
     * scellement — après, la clé est partie.
     */
    fun preparerUneInvitation(email: String): Invitation {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        val trouve = try {
            api.clePubliqueAnnoncee(j, email)
        } catch (e: ErreurApi.Http) {
            if (e.statut == 404) return Invitation.Inconnu(email) else throw e
        }
        return Invitation.AConfirmer(email, trouve.userId, trouve.publicKey)
    }

    /**
     * Seconde moitié : sceller l'Org Key vers la clé confirmée, et poser l'invitation.
     *
     * **Le paramètre est l'[Invitation.AConfirmer] et non un email.** Même idiome que les
     * écritures d'équipe : le type interdit d'inviter sans être passé par la préparation,
     * donc sans que la clé annoncée ait pu être montrée. Un email nu aurait suffi au
     * serveur — c'est pour cela qu'on ne le prend pas.
     *
     * La clé est scellée par le cœur (`sealOrgKeyForMember`), de façon authentifiée : le
     * destinataire vérifiera qu'elle vient bien de la clé publique de l'admin. Cette
     * moitié-là du contrôle existe déjà ; c'est l'autre qui manque.
     */
    fun poserLInvitation(
        ouvert: CoffreDOrganisation,
        invitation: Invitation.AConfirmer,
        role: RoleDOrganisation,
    ) {
        val compteOuvert = compte ?: throw ErreurApi.CoffreVerrouille()
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        exigerLaCleCourante(ouvert)
        val scellee = compteOuvert.sealOrgKeyForMember(ouvert.org, invitation.clePubliqueAnnoncee)
        api.ajouterUnMembre(
            j, ouvert.organisation.id, invitation.email, versLeServeur(role), scellee)
    }

    /**
     * Accorde à un groupe une permission sur une collection.
     *
     * ─── Pourquoi un groupe, et pas le rôle du membre ───
     *
     * Le serveur expose aussi `PATCH /api/orgs/:id/members/:userId` pour changer un rôle.
     * **Cette route est hors d'atteinte de ce client** : `HttpURLConnection` — la pile HTTP
     * d'Android comme de la JVM — refuse le verbe `PATCH` par un
     * `ProtocolException: Invalid HTTP method: PATCH`, mesuré et non déduit. Il n'y a pas de
     * contournement honnête côté client : le détour classique par réflexion sur le champ
     * privé `method` casse selon la version, et poser un en-tête de substitution suppose un
     * greffon que le serveur n'a pas.
     *
     * On expose donc l'octroi qui existe réellement, plutôt qu'un changement de rôle qui
     * échouerait au moment de s'en servir. Le manque est écrit dans `docs/android.md`.
     */
    fun accorderSurUneCollection(
        ouvert: CoffreDOrganisation,
        groupe: String,
        collection: String,
        permission: PermissionDeCollection,
    ) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.accorderAuGroupe(
            j, ouvert.organisation.id, groupe, collection, permission.versLeServeur())
    }

    /** Crée un groupe, et rend son identifiant. */
    fun creerUnGroupe(ouvert: CoffreDOrganisation, nom: String): String {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        return api.creerUnGroupe(j, ouvert.organisation.id, nom)
    }

    /** Place un membre dans un groupe. */
    fun ajouterAuGroupe(ouvert: CoffreDOrganisation, groupe: String, utilisateur: String) {
        val api = client ?: throw ErreurApi.Reseau("Aucun serveur configuré.")
        val j = jeton ?: throw ErreurApi.Reseau("Aucune session ouverte.")
        api.ajouterAuGroupe(j, ouvert.organisation.id, groupe, utilisateur)
    }

    /**
     * Le nom que le serveur attend pour un rôle.
     *
     * [RoleDOrganisation.Inconnu] ne s'envoie pas : on refuse plutôt que d'inventer. Le
     * traduire en `readonly` — le défaut sûr **en lecture** — serait ici un défaut
     * silencieux en **écriture**, puisqu'on poserait un rôle que personne n'a demandé.
     */
    private fun versLeServeur(role: RoleDOrganisation): String = when (role) {
        RoleDOrganisation.Admin -> "admin"
        RoleDOrganisation.Membre -> "member"
        RoleDOrganisation.LectureSeule -> "readonly"
        RoleDOrganisation.Inconnu ->
            throw ErreurApi.Reseau("Rôle inconnu : cette version ne sait pas l'attribuer.")
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

        /**
         * Refusé sans appel : rétrogradation de schéma, ou lien sans jeton de révocation.
         *
         * Le refus porte un **motif**, et non la phrase qui l'explique. Il en portait une :
         * ce module est du Kotlin de la JVM, sans accès aux ressources Android, et cette
         * phrase-là serait restée en français dans une application en anglais. Le motif, lui,
         * ne dépend d'aucune langue ; c'est `EcranDuCoffre` qui lui associe un texte.
         */
        data class Refuse(val motif: MotifDeRefus) : Partage

        /** Les deux façons dont un lien de partage peut être refusé d'emblée. */
        enum class MotifDeRefus {
            /** Le serveur a rendu un lien en clair alors qu'il est joint en HTTPS. */
            RETROGRADATION_DE_SCHEMA,

            /** Lien vers un autre domaine, sans jeton de révocation : impossible à reprendre. */
            SANS_JETON_DE_REVOCATION,
        }
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
            return Partage.Refuse(Partage.MotifDeRefus.RETROGRADATION_DE_SCHEMA)
        }
        if (cree.deleteToken == null) {
            // Une destination étrangère sans jeton de révocation : on ne pourrait pas
            // reprendre le partage si l'utilisateur refusait. On refuse donc d'emblée
            // plutôt que de poser une question dont une des réponses est impossible à tenir.
            return Partage.Refuse(Partage.MotifDeRefus.SANS_JETON_DE_REVOCATION)
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
        fun ouvrir(chiffre: ElementChiffre, compte: Account): ElementDuCoffre =
            CodecDElement.lire(compte.decryptItem(enveloppeDe(chiffre)))

        /**
         * L'enveloppe que le cœur attend, construite **une seule fois**.
         *
         * Les noms sont ceux de serde — `encrypted_key`, `encrypted_data` — et le passage du
         * camelCase du DTO à ce snake_case est exactement l'endroit qui dérive. Il en
         * existait deux copies, une par clé d'ouverture, et le commentaire d'à côté disait
         * déjà que « le second à diverger serait celui qu'on regarde le moins ». L'accès
         * d'urgence en aurait ajouté une troisième, ouverte par une clé qu'on n'emploie
         * qu'une fois dans la vie d'un compte — c'est-à-dire précisément celle dont personne
         * ne verrait qu'elle a cessé de marcher.
         */
        private fun enveloppeDe(chiffre: ElementChiffre): String = json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            buildJsonObject {
                put("encrypted_key", chiffre.encryptedKey)
                put("encrypted_data", chiffre.encryptedData)
            },
        )

        /**
         * La même ouverture, **par le coffre d'urgence** d'un donneur.
         *
         * `EmergencyVault` porte la même méthode qu'`Account` : c'est la clé qui change, pas
         * le format. Rien de spécifique n'est donc à écrire ici — et c'est voulu.
         */
        fun ouvrirEnUrgence(
            chiffre: ElementChiffre,
            coffre: uniffi.ghost_crypto_ffi.EmergencyVault,
        ): ElementDuCoffre = CodecDElement.lire(coffre.decryptItem(enveloppeDe(chiffre)))

        /**
         * La même ouverture, **sous l'Org Key** d'une organisation.
         *
         * L'enveloppe se construit à l'identique — c'est la clé qui change, pas le format.
         * Elle passe donc par [enveloppeDe], et il n'en existe plus qu'une construction.
         */
        fun ouvrirSousOrg(
            chiffre: ElementChiffre,
            org: uniffi.ghost_crypto_ffi.Org,
        ): ElementDuCoffre = CodecDElement.lire(org.decryptItem(enveloppeDe(chiffre)))

        /**
         * Le scellement **sous l'Org Key**, pendant exact de [ouvrirSousOrg].
         *
         * Il vit à côté de son inverse pour la même raison que celui du coffre personnel :
         * deux conversions camelCase / snake_case écrites à deux endroits finissent par
         * diverger, et la seconde à diverger est celle qu'on regarde le moins.
         */
        fun scellerSousOrg(
            element: ElementDuCoffre,
            org: uniffi.ghost_crypto_ffi.Org,
        ): Pair<String, String> {
            val scelle = org.encryptItem(CodecDElement.ecrire(element))
            val objet = json.parseToJsonElement(scelle) as kotlinx.serialization.json.JsonObject
            val cle = (objet["encrypted_key"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                ?: throw ErreurApi.ReponseIllisible()
            val donnees =
                (objet["encrypted_data"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    ?: throw ErreurApi.ReponseIllisible()
            return cle to donnees
        }

        /**
         * Marque toutes les lignes d'une lecture comme venant d'une collection d'équipe.
         *
         * **Les illisibles aussi.** Une ligne d'équipe qu'on n'a pas su ouvrir doit rester
         * reconnaissable comme telle : sans marque, elle se lirait comme un élément personnel
         * abîmé, et l'on chercherait le défaut dans le mauvais coffre.
         */
        fun marquerCommeDEquipe(
            lecture: LectureDuCoffre,
            appartenance: Appartenance,
        ): LectureDuCoffre = lecture.copy(
            entrees = lecture.entrees.map { entree ->
                when (entree) {
                    is EntreeDuCoffre.Lisible ->
                        entree.copy(origine = OrigineDuCoffre.Equipe(appartenance))
                    is EntreeDuCoffre.Illisible ->
                        entree.copy(origine = OrigineDuCoffre.Equipe(appartenance))
                }
            },
        )

        /**
         * **Fond le coffre personnel et les collections d'équipe en une seule liste.**
         *
         * C'est le modèle d'iOS, et le défaut qu'il corrige est le plus grave qu'ait connu ce
         * portage : quelqu'un dont tout le contenu vit dans une organisation ouvrait
         * l'application, voyait « aucun élément », et concluait que ses données avaient
         * disparu. Elles étaient là — ailleurs, derrière une navigation qu'il ne connaissait
         * pas. Aucune erreur, et l'apparence exacte d'une perte de données.
         *
         * Le tri est fait sur le **nom, sans tenir compte de la casse** : deux listes
         * concaténées donneraient tous les éléments personnels puis tous ceux d'équipe, ce qui
         * se lit comme deux listes accolées plutôt que comme un coffre.
         *
         * Les registres et les dossiers ne viennent que du coffre personnel : une collection
         * d'équipe n'en porte pas, et les fusionner ferait apparaître les dossiers d'une équipe
         * comme les siens.
         */
        fun fusionner(
            personnel: LectureDuCoffre,
            equipes: List<LectureDuCoffre>,
        ): LectureDuCoffre {
            if (equipes.isEmpty()) return personnel
            val toutes = personnel.entrees + equipes.flatMap { it.entrees }
            return personnel.copy(entrees = toutes.sortedWith(PAR_NOM))
        }

        /**
         * L'ordre de la liste fondue : par nom, insensible à la casse.
         *
         * Une ligne illisible n'a **pas** de nom — le nom vit dans le chiffré, et en
         * inventer un serait mentir. Elle se range donc en fin de liste plutôt qu'en tête,
         * où une chaîne vide l'aurait mise : la première place attire l'œil, et ce n'est pas
         * là qu'on veut ce qu'on ne sait pas lire.
         */
        internal val PAR_NOM: Comparator<EntreeDuCoffre> =
            compareBy<EntreeDuCoffre> { it !is EntreeDuCoffre.Lisible }
                .thenBy(String.CASE_INSENSITIVE_ORDER) {
                    (it as? EntreeDuCoffre.Lisible)?.element?.name ?: ""
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
