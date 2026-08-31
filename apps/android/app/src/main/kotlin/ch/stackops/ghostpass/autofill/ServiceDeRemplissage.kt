package ch.stackops.ghostpass.autofill

import android.app.assist.AssistStructure
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.View
import android.view.autofill.AutofillId
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.RapprochementDeSite

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
 * ## État : la structure est là, le contenu ne l'est pas
 *
 * Ce service sait analyser une structure de vues, y trouver les champs d'identifiant et de
 * mot de passe, en déduire le domaine, et rendre une réponse. **Il ne lit pas encore le
 * coffre** : cela demande de déverrouiller le compte depuis un processus qui n'est pas
 * l'application, donc de lire le mot de passe maître sous contrôle biométrique — la
 * décision d'`docs/adr/0001` pour iOS, dont l'équivalent Android (KeyStore et
 * `BiometricPrompt`) est explicitement laissé à décider au §11 du brief. Le câbler avant
 * cette décision reviendrait à la prendre en passant.
 *
 * Ce qui est écrit ici est donc ce qui peut l'être sans elle, et l'ossature est éprouvée
 * par [ch.stackops.ghostpass.RapprochementDeSite] sur la JVM du poste.
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

        val cibles = listOfNotNull(champs.identifiant, champs.motDePasse).toTypedArray()
        reponse.setAuthentication(cibles, null, presentation)

        rappel.onSuccess(reponse.build())
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
}
