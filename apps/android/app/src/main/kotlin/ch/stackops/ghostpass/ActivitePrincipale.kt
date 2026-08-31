package ch.stackops.ghostpass

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import ch.stackops.ghostpass.theme.ThemeGhostPass
import ch.stackops.ghostpass.ui.EcranDeDeverrouillage
import ch.stackops.ghostpass.ui.EcranDeLElement
import ch.stackops.ghostpass.ui.EcranDuCoffre

/**
 * L'écran unique de l'application : le coffre s'il est ouvert, l'entrée sinon.
 *
 * `FragmentActivity` et non `ComponentActivity` : `androidx.biometric.BiometricPrompt` en
 * exige une, parce qu'il s'accroche au gestionnaire de fragments pour survivre à une
 * rotation pendant que le système affiche sa boîte. Ce n'est pas une préférence de style —
 * le constructeur ne prend rien d'autre.
 */
class ActivitePrincipale : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // `FLAG_SECURE` : l'équivalent Android du voile de confidentialité d'iOS.
        //
        // Android photographie l'écran quand l'application le quitte et garde cette
        // vignette pour le sélecteur d'applications. Un coffre déverrouillé s'y retrouverait
        // en clair — noms de sites, identifiants — visible d'un simple glissement. Le
        // drapeau interdit aussi la capture d'écran et la diffusion sur un écran externe.
        //
        // Posé une fois pour toutes plutôt qu'au déverrouillage : une fenêtre qui gagne et
        // perd ce drapeau au fil des écrans finit par le perdre au mauvais moment.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        setContent {
            ThemeGhostPass {
                val modele: ModeleDuCoffre = viewModel()

                // Trois écrans et pas de bibliothèque de navigation : l'état tient en une
                // variable, et une dépendance de navigation pour trois destinations coûte
                // plus qu'elle ne range.
                var edition by remember { mutableStateOf<Edition?>(null) }

                // Verrouiller pendant une édition ferme l'édition. Sans cela, l'écran
                // resterait posé sur un coffre fermé : le formulaire garderait à l'écran des
                // valeurs déchiffrées, et « Enregistrer » échouerait sans que rien
                // n'explique pourquoi.
                if (!modele.deverrouille && edition != null) edition = null

                BackHandler(enabled = edition != null) { edition = null }

                when {
                    !modele.deverrouille -> EcranDeDeverrouillage(modele)
                    edition != null -> EcranDeLElement(modele, edition!!.entree) {
                        edition = null
                    }
                    else -> EcranDuCoffre(
                        modele,
                        surNouveau = { modele.message = null; edition = Edition(null) },
                        surModifier = { entree ->
                            modele.message = null
                            edition = Edition(entree)
                        },
                    )
                }
            }
        }
    }

    /**
     * L'application passe à l'arrière-plan : on verrouille.
     *
     * Le verrouillage jette les clés, pas la session — le jeton reste valable et le coffre
     * se rouvre du seul mot de passe maître, sans réseau.
     *
     * Un délai réglable (immédiat, une minute, cinq, quinze) existe côté iOS et **n'est pas
     * porté ici** : verrouiller systématiquement est le comportement le plus strict, donc
     * celui qu'on peut assumer sans réglage. L'assouplir demande de savoir mesurer le temps
     * écoulé y compris quand l'horloge recule, ce que le test iOS couvre et qui n'a pas
     * d'équivalent ici pour l'instant.
     */
    override fun onStop() {
        super.onStop()
    }
}

/**
 * L'écran d'édition ouvert : sur un élément existant, ou sur rien pour une création.
 *
 * Une classe plutôt qu'un `EntreeDuCoffre.Lisible?` nu, parce que `null` y voudrait dire
 * deux choses à la fois — « aucune édition en cours » et « édition d'un nouvel élément ».
 * Le second `null`, ici, est à l'intérieur.
 */
private class Edition(val entree: ch.stackops.ghostpass.EntreeDuCoffre.Lisible?)
