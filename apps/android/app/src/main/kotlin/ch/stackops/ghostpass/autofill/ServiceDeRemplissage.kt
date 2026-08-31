package ch.stackops.ghostpass.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.RapprochementDeSite
import java.util.concurrent.atomic.AtomicInteger

/**
 * Le service de remplissage automatique (docs/android.md §6).
 *
 * C'est la fonction principale du produit, et la plus dépendante de la plateforme :
 * l'équivalent de l'extension `ASCredentialProvider` d'iOS. Comme elle, il est écrit dans
 * le langage natif — du Kotlin ici, du Swift là-bas — et comme elle, il partage la logique
 * de rapprochement avec l'application plutôt que d'en tenir une seconde copie
 * ([RapprochementDeSite], dans `:noyau`). Deux règles qui divergeraient donneraient des
 * suggestions différentes selon l'endroit d'où l'on regarde.
 *
 * **Rien ne se remplit sans interaction.** C'est la règle qu'applique déjà l'extension
 * iOS, et elle est plus forte ici qu'il n'y paraît : ce service voit passer *toutes* les
 * vues de *toutes* les applications qui demandent un remplissage. Servir une valeur sans
 * geste de l'utilisateur reviendrait à distribuer des mots de passe à qui déclare un champ
 * au bon moment. Chaque proposition passe donc par une entrée d'authentification que
 * l'utilisateur doit toucher, et qui ouvre l'application.
 *
 * ## Ce que ce service ne fait pas, et pourquoi
 *
 * **Il ne lit pas le coffre.** Non par prudence, mais parce qu'il ne le peut pas : une
 * `RemoteViews` est rendue par un autre processus et ne reçoit aucun événement, si bien
 * qu'il n'existe ici aucun moyen d'obtenir un geste. Toute la partie qui touche aux secrets
 * vit donc dans [ActiviteDeRemplissage], qui a un écran — la biométrie, l'ouverture du
 * coffre par l'enveloppe d'appareil (`docs/adr/0002`), le choix, et le `Dataset`.
 *
 * Ce partage est ce qui fait tenir la règle. Le service produit une entrée
 * d'authentification **sans valeur** ; le système la remplace par ce que l'activité rend,
 * et n'obtient donc rien tant que personne n'a rien touché.
 */
@RequiresApi(Build.VERSION_CODES.O)
class ServiceDeRemplissage : AutofillService() {

    override fun onFillRequest(
        requete: FillRequest,
        annulation: CancellationSignal,
        rappel: FillCallback,
    ) {
        val structure = requete.fillContexts.lastOrNull()?.structure
        if (structure == null) {
            rappel.onSuccess(null)
            return
        }

        val champs = champsDeSaisie(structure)
        if (champs.identifiant == null && champs.motDePasse == null) {
            // Aucun champ d'authentification : ce n'est pas un formulaire de connexion, et
            // rendre `null` est la bonne réponse — pas une réponse vide, qui ferait
            // apparaître une suggestion inerte.
            rappel.onSuccess(null)
            return
        }

        val reponse = FillResponse.Builder()

        // L'entrée d'authentification : elle **ne porte aucune valeur**. Toucher cette
        // ligne ouvre l'application, qui demandera le mot de passe maître puis rendra
        // l'identifiant choisi. C'est ce qui garantit qu'aucun secret ne traverse la
        // frontière sans que l'utilisateur l'ait voulu.
        val presentation = RemoteViews(packageName, R.layout.ligne_de_remplissage).apply {
            setTextViewText(R.id.titre, getString(R.string.remplissage_deverrouiller))
            setTextViewText(R.id.sous_titre, champs.domaine ?: getString(R.string.remplissage_ce_site))
        }

        // ─── Authentification **de jeu**, et non de réponse ───
        //
        // Mesuré sur émulateur, et l'écart ne se voit pas à la lecture du code : avec
        // `FillResponse.setAuthentication(...)`, le système attend en retour une
        // `FillResponse`, pas un `Dataset`. Rendre un `Dataset` produit
        // « invalid index (65535) » dans le journal, **aucune erreur visible**, et un champ
        // qui reste vide après que l'utilisateur a posé son doigt. Le seul symptôme est que
        // rien ne se remplit.
        //
        // L'authentification portée par le *jeu* est le bon niveau ici : l'activité rend
        // alors un `Dataset`, que le système applique directement. Elle épargne au passage
        // une seconde liste — celle du système, par-dessus la nôtre.
        //
        // `setValue(id, null, presentation)` : la valeur est nulle **exprès**. C'est ainsi
        // qu'on déclare quels champs ce jeu couvre sans rien porter de secret ; les valeurs
        // n'arrivent qu'après le geste de l'utilisateur.
        val cibles = listOfNotNull(champs.identifiant, champs.motDePasse)
        val jeu = Dataset.Builder(presentation)
        for (cible in cibles) {
            @Suppress("DEPRECATION")
            jeu.setValue(cible, null as AutofillValue?, presentation)
        }
        jeu.setAuthentication(intentionDAuthentification(champs))
        reponse.addDataset(jeu.build())

        rappel.onSuccess(reponse.build())
    }

    /**
     * L'intention que le système déclenchera quand l'utilisateur touchera la ligne.
     *
     * Trois détails qui ne se devinent pas, et dont deux échouent en silence :
     *
     *  - **`FLAG_MUTABLE`** est obligatoire. Le système ajoute lui-même ses extras à cette
     *    intention (la structure de vues, le client) avant de la lancer ; une intention
     *    immuable les perdrait. Depuis l'API 31, ne déclarer ni l'un ni l'autre lève à la
     *    construction — c'est le seul des trois qui se signale ;
     *  - **un code de requête différent à chaque fois**. `PendingIntent` réutilise
     *    l'instance existante quand le code et l'intention « se ressemblent », et deux
     *    intentions ne diffèrent pas par leurs extras : sans compteur, la seconde demande de
     *    remplissage rouvrirait l'écran avec les `AutofillId` de la première, donc
     *    écrirait dans les champs d'une page qu'on a quittée ;
     *  - **`FLAG_CANCEL_CURRENT`**, pour que l'intention précédente ne reste pas armée.
     *
     * Le domaine et les deux identifiants de champ voyagent en extras. Ce sont les seules
     * choses que le service sait, et aucune n'est un secret.
     */
    private fun intentionDAuthentification(champs: ChampsDeSaisie): android.content.IntentSender {
        val intention = Intent(this, ActiviteDeRemplissage::class.java).apply {
            putExtra(ActiviteDeRemplissage.EXTRA_DOMAINE, champs.domaine)
            putExtra(ActiviteDeRemplissage.EXTRA_ID_IDENTIFIANT, champs.identifiant)
            putExtra(ActiviteDeRemplissage.EXTRA_ID_MOT_DE_PASSE, champs.motDePasse)
        }
        var drapeaux = PendingIntent.FLAG_CANCEL_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            drapeaux = drapeaux or PendingIntent.FLAG_MUTABLE
        }
        return PendingIntent.getActivity(
            this, codeDeRequete.incrementAndGet(), intention, drapeaux).intentSender
    }

    /**
     * L'enregistrement d'un nouvel identifiant depuis une autre application.
     *
     * Non implémenté : comme le remplissage, il suppose un coffre ouvert hors de
     * l'application. Déclarer savoir le faire et ne rien faire serait pire que se taire —
     * le système proposerait « enregistrer dans GhostPass », l'utilisateur accepterait, et
     * rien ne serait enregistré. C'est la leçon du §9 du brief, appliquée ici : une
     * capacité déclarée mais non tenue coûte plus qu'une capacité absente.
     */
    override fun onSaveRequest(requete: SaveRequest, rappel: SaveCallback) {
        rappel.onFailure(getString(R.string.remplissage_enregistrement_indisponible))
    }

    /** Ce qu'on a trouvé dans la structure de vues. */
    private data class ChampsDeSaisie(
        val identifiant: AutofillId? = null,
        val motDePasse: AutofillId? = null,
        val domaine: String? = null,
    )

    /**
     * Parcourt la structure de vues à la recherche des champs d'authentification.
     *
     * Trois sources, dans l'ordre de fiabilité : les indices d'autofill déclarés par
     * l'application (`autofillHints`), le type de saisie, puis les indices textuels. Les
     * premières sont explicites ; les dernières devinent, et devinent parfois mal — d'où
     * l'ordre.
     */
    private fun champsDeSaisie(structure: AssistStructure): ChampsDeSaisie {
        var identifiant: AutofillId? = null
        var motDePasse: AutofillId? = null
        var domaine: String? = null

        fun visiter(noeud: AssistStructure.ViewNode) {
            noeud.webDomain?.takeIf { it.isNotEmpty() }?.let { if (domaine == null) domaine = it }

            val indices = noeud.autofillHints?.map { it.lowercase() } ?: emptyList()
            val estUnChamp = noeud.autofillId != null &&
                noeud.className?.contains("EditText") == true || indices.isNotEmpty()

            if (estUnChamp && noeud.autofillId != null) {
                val typeMotDePasse = (noeud.inputType and
                    android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0
                when {
                    indices.any { it == View.AUTOFILL_HINT_PASSWORD } || typeMotDePasse ->
                        if (motDePasse == null) motDePasse = noeud.autofillId
                    indices.any {
                        it == View.AUTOFILL_HINT_USERNAME ||
                            it == View.AUTOFILL_HINT_EMAIL_ADDRESS
                    } -> if (identifiant == null) identifiant = noeud.autofillId
                }
            }

            for (i in 0 until noeud.childCount) visiter(noeud.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) {
            structure.getWindowNodeAt(i).rootViewNode?.let { visiter(it) }
        }

        // Le nom du paquet sert de domaine quand la vue n'en déclare aucun — cas d'une
        // application native plutôt qu'une page web.
        val hote = domaine?.let { RapprochementDeSite.hote(it) }
        return ChampsDeSaisie(identifiant, motDePasse, hote?.ifEmpty { null })
    }

    private companion object {
        /** Voir [intentionDAuthentification] : c'est ce qui rend chaque intention distincte. */
        val codeDeRequete = AtomicInteger(0)
    }
}
