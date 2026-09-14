package ch.stackops.ghostpass

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import ch.stackops.ghostpass.theme.ThemeGhostPass
import ch.stackops.ghostpass.ui.EcranDeDeverrouillage
import ch.stackops.ghostpass.ui.BoitesDePartage
import ch.stackops.ghostpass.ui.EcranDeLElement
import ch.stackops.ghostpass.ui.EcranDeLaCorbeille
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

    /**
     * Le modèle est tenu par l'activité, et non seulement par la composition.
     *
     * [onNewIntent] arrive hors de toute composition : un lien reçu alors que l'application
     * est déjà ouverte doit pouvoir être rangé quelque part tout de suite. Le récupérer
     * depuis un `@Composable` demanderait de le stocker en attendant — c'est-à-dire de
     * réécrire ici ce que le modèle fait déjà.
     */
    private val modele: ModeleDuCoffre by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Le lien du lancement à froid. `onNewIntent` ne le donnera pas : il ne concerne
        // que les intentions reçues par une activité déjà vivante.
        recevoir(intent?.dataString)

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
                // Trois écrans et pas de bibliothèque de navigation : l'état tient en une
                // variable, et une dépendance de navigation pour trois destinations coûte
                // plus qu'elle ne range.
                var edition by remember { mutableStateOf<Edition?>(null) }

                // Verrouiller pendant une édition ferme l'édition. Sans cela, l'écran
                // resterait posé sur un coffre fermé : le formulaire garderait à l'écran des
                // valeurs déchiffrées, et « Enregistrer » échouerait sans que rien
                // n'explique pourquoi.
                if (!modele.deverrouille && edition != null) edition = null

                // Le lien retenu s'ouvre **dès que le coffre l'est**, et pas avant. C'est
                // la règle §9 : on retient, on n'écrit rien, et l'utilisateur voit un
                // formulaire pré-rempli qu'il doit valider.
                LaunchedEffect(modele.deverrouille, modele.lienEnAttente) {
                    if (modele.deverrouille && modele.lienEnAttente != null) {
                        val lien = modele.consommerLeLien()
                        if (lien != null) edition = Edition(entree = null, lien = lien)
                    }
                }

                BackHandler(enabled = edition != null || modele.corbeilleOuverte) {
                    if (edition != null) edition = null else modele.fermerLaCorbeille()
                }

                when {
                    !modele.deverrouille -> EcranDeDeverrouillage(modele)
                    modele.corbeilleOuverte -> EcranDeLaCorbeille(modele) {
                        modele.fermerLaCorbeille()
                    }
                    edition != null -> EcranDeLElement(
                        modele,
                        edition!!.entree,
                        edition!!.lien,
                        // `key` : deux liens différents doivent ouvrir deux formulaires
                        // différents. Sans lui, Compose réutilise l'état de `rememberSaveable`
                        // de la feuille précédente, et le second lien n'arriverait jamais à
                        // l'écran — la leçon d'`EditTarget` côté iOS, où deux feuilles de
                        // même identité n'en font qu'une.
                        cle = edition!!.identite,
                        // Le droit se lit sur **l'élément**, pas sur l'écran d'où on
                        // l'ouvre. Depuis la fusion, un élément d'équipe s'ouvre le plus
                        // souvent depuis l'accueil, où aucune collection n'est « ouverte » :
                        // demander à l'écran répondrait « modifiable » pour tout, y compris
                        // pour une collection en lecture seule.
                        lectureSeule = !modele.peutModifier(edition!!.entree),
                    ) { edition = null }
                    else -> EcranDuCoffre(
                        modele,
                        surNouveau = { modele.message = null; edition = Edition(null) },
                        surModifier = { entree ->
                            modele.message = null
                            edition = Edition(entree)
                        },
                        surCorbeille = { modele.ouvrirLaCorbeille() },
                    )
                }

                // Les boîtes du partage sont posées **au-dessus de tout**, et pas dans un
                // écran : la destination doit se confirmer avant que la clé ne s'affiche, et
                // une boîte qui recouvre l'application ne se contourne ni par un retour
                // arrière ni par un changement d'écran.
                BoitesDePartage(modele)
            }
        }
    }

    /**
     * Un lien reçu alors que l'application est déjà ouverte.
     *
     * `launchMode="singleTask"` fait que le système ne crée pas une seconde activité : il
     * livre l'intention ici. Sans cette redéfinition, un QR code scanné sur une application
     * déjà lancée ramènerait GhostPass au premier plan **sans rien faire du lien** — le
     * défaut serait invisible au premier essai, quand l'application est fermée, et
     * n'apparaîtrait qu'au second.
     *
     * `setIntent` : `getIntent()` continuerait sinon de rendre celle du lancement, ce qui
     * compte pour tout ce qui la relira après une rotation.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recevoir(intent.dataString)
    }

    /**
     * Une adresse reçue du dehors, aiguillée vers ce qui sait la traiter.
     *
     * Deux schémas entrent par la même porte, et les confondre serait coûteux dans les deux
     * sens : un retour de SSO traité comme un lien de second facteur ouvrirait un formulaire
     * absurde, et un lien `otpauth` passé à l'échange enverrait un code inexistant au
     * serveur.
     */
    private fun recevoir(adresse: String?) {
        if (adresse == null) return
        if (adresse.startsWith(SsoMobile.adresseDeRetour(packageName))) {
            modele.terminerLeSso(adresse)
        } else {
            modele.retenirLeLien(adresse)
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
        // **Ce corps était vide.** Le commentaire ci-dessus annonçait le verrouillage depuis
        // le premier jour, `FLAG_SECURE` était posé juste au-dessus pour cacher la vignette
        // d'un coffre ouvert — et le coffre restait ouvert. Un téléphone posé, repris une
        // heure plus tard, rouvrait la liste sans rien demander.
        //
        // Rien ne le signalait : l'application marchait mieux ainsi, et c'est ce qui rend
        // ce genre d'absence coûteux. Trouvé le 2026-08-31 en lisant la documentation à
        // côté du code qu'elle décrit.
        //
        // `isChangingConfigurations` est la garde qui manque le plus souvent : une simple
        // rotation passe par `onStop`, et verrouiller là ferait perdre sa saisie à
        // quelqu'un qui a seulement tourné son téléphone. Le déverrouillage biométrique
        // rendrait la faute presque invisible, et parfaitement agaçante.
        if (!isChangingConfigurations) modele.verrouiller()
    }
}

/**
 * L'écran d'édition ouvert : sur un élément existant, sur un lien reçu, ou sur rien.
 *
 * Une classe plutôt qu'un `EntreeDuCoffre.Lisible?` nu, parce que `null` y voudrait dire
 * deux choses à la fois — « aucune édition en cours » et « édition d'un nouvel élément ».
 * Le second `null`, ici, est à l'intérieur.
 */
private class Edition(
    val entree: ch.stackops.ghostpass.EntreeDuCoffre.Lisible?,
    val lien: String? = null,
) {
    /**
     * Ce qui distingue deux éditions l'une de l'autre.
     *
     * Deux liens différents doivent donner deux identités différentes, sans quoi Compose
     * garde l'état du premier formulaire. C'est le défaut qu'iOS a rencontré avec ses
     * feuilles : « rien ne tombait, et l'écran disait simplement le contraire de la vérité ».
     */
    val identite: String = entree?.id ?: lien ?: "nouveau"
}
