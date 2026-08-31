package ch.stackops.ghostpass

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import ch.stackops.ghostpass.theme.ThemeGhostPass
import ch.stackops.ghostpass.ui.EcranDeDeverrouillage
import ch.stackops.ghostpass.ui.EcranDuCoffre

/**
 * L'écran unique de l'application : le coffre s'il est ouvert, l'entrée sinon.
 */
class ActivitePrincipale : ComponentActivity() {

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
                if (modele.deverrouille) {
                    EcranDuCoffre(modele)
                } else {
                    EcranDeDeverrouillage(modele)
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
