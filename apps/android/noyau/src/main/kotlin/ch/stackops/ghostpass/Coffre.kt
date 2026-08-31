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
    fun lecture(elements: List<ElementChiffre>, compte: Account?): LectureDuCoffre {
        val compteOuvert = compte
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
                ouvrir(chiffre, compteOuvert)
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
