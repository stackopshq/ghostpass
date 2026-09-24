package ch.stackops.ghostpass

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
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
import ch.stackops.ghostpass.ui.EcranDImport
import ch.stackops.ghostpass.ui.EcranDeLaSante
import ch.stackops.ghostpass.ui.EcranDeLaCleDeRecuperation
import ch.stackops.ghostpass.ui.EcranDuJournal
import ch.stackops.ghostpass.ui.EcranDuSecondFacteur
import ch.stackops.ghostpass.ui.EcranDesReglages
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

    /**
     * Les réglages sont tenus par l'activité, comme le modèle.
     *
     * [onStop] a besoin du délai de verrouillage, et il arrive hors de toute composition :
     * le lire depuis un `@Composable` demanderait de le recopier quelque part en
     * attendant.
     */
    private val reglages: Preferences by lazy { Preferences(this) }

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
            // Le thème suit le réglage, et « Système » suit l'appareil. La valeur est un
            // `mutableStateOf` : choisir « Sombre » repeint l'écran sur-le-champ, sans
            // redémarrage. Un réglage dont l'effet n'arrive qu'au prochain lancement se lit
            // comme un réglage cassé.
            ThemeGhostPass(
                sombre = when (reglages.apparence) {
                    Apparence.CLAIR -> false
                    Apparence.SOMBRE -> true
                    Apparence.SYSTEME -> isSystemInDarkTheme()
                },
            ) {
                // Trois écrans et pas de bibliothèque de navigation : l'état tient en une
                // variable, et une dépendance de navigation pour trois destinations coûte
                // plus qu'elle ne range.
                var edition by remember { mutableStateOf<Edition?>(null) }
                var reglagesOuverts by remember { mutableStateOf(false) }
                var importOuvert by remember { mutableStateOf(false) }
                var secondFacteurOuvert by remember { mutableStateOf(false) }
                var journalOuvert by remember { mutableStateOf(false) }
                var cleDeRecuperationOuverte by remember { mutableStateOf(false) }

                // Verrouiller pendant une édition ferme l'édition. Sans cela, l'écran
                // resterait posé sur un coffre fermé : le formulaire garderait à l'écran des
                // valeurs déchiffrées, et « Enregistrer » échouerait sans que rien
                // n'explique pourquoi.
                if (!modele.deverrouille && edition != null) edition = null
                // Et la santé de même : elle porte à l'écran la liste de ce qu'il faut
                // attaquer en premier, ce qui est exactement ce qu'un coffre verrouillé ne
                // doit plus montrer.
                if (!modele.deverrouille && modele.santeOuverte) modele.santeOuverte = false

                // Le lien retenu s'ouvre **dès que le coffre l'est**, et pas avant. C'est
                // la règle §9 : on retient, on n'écrit rien, et l'utilisateur voit un
                // formulaire pré-rempli qu'il doit valider.
                LaunchedEffect(modele.deverrouille, modele.lienEnAttente) {
                    if (modele.deverrouille && modele.lienEnAttente != null) {
                        val lien = modele.consommerLeLien()
                        if (lien != null) edition = Edition(entree = null, lien = lien)
                    }
                }

                BackHandler(
                    enabled = edition != null || modele.corbeilleOuverte ||
                        modele.santeOuverte || reglagesOuverts || importOuvert ||
                        secondFacteurOuvert || journalOuvert || cleDeRecuperationOuverte,
                ) {
                    when {
                        edition != null -> edition = null
                        cleDeRecuperationOuverte -> cleDeRecuperationOuverte = false
                        journalOuvert -> journalOuvert = false
                        secondFacteurOuvert -> secondFacteurOuvert = false
                        importOuvert -> importOuvert = false
                        reglagesOuverts -> reglagesOuverts = false
                        modele.santeOuverte -> modele.santeOuverte = false
                        else -> modele.fermerLaCorbeille()
                    }
                }

                // Les réglages ne portent aucun secret du coffre : ils survivent donc au
                // verrouillage, contrairement à la santé. Mais on n'y entre que le coffre
                // ouvert, puisqu'on n'y arrive que par son menu.
                if (!modele.deverrouille && reglagesOuverts) reglagesOuverts = false
                // L'import, lui, porte à l'écran le contenu d'un fichier de mots de passe
                // en clair : il ne survit pas au verrouillage.
                if (!modele.deverrouille && importOuvert) importOuvert = false
                // Le second facteur montre un secret TOTP en clair : il ne survit pas non
                // plus au verrouillage.
                if (!modele.deverrouille && secondFacteurOuvert) secondFacteurOuvert = false
                if (!modele.deverrouille && journalOuvert) journalOuvert = false
                // La clé de récupération est **le** secret de cet écran : elle ne survit
                // pas au verrouillage. Quelqu'un qui repose son téléphone la clé affichée
                // devra la recréer, ce qui est le bon inconvénient.
                if (!modele.deverrouille && cleDeRecuperationOuverte) {
                    cleDeRecuperationOuverte = false
                }

                when {
                    !modele.deverrouille -> EcranDeDeverrouillage(modele)
                    reglagesOuverts -> EcranDesReglages(modele, reglages) {
                        reglagesOuverts = false
                    }
                    importOuvert -> EcranDImport(modele) { importOuvert = false }
                    secondFacteurOuvert -> EcranDuSecondFacteur(modele) {
                        secondFacteurOuvert = false
                    }
                    journalOuvert -> EcranDuJournal(modele) { journalOuvert = false }
                    cleDeRecuperationOuverte -> EcranDeLaCleDeRecuperation(modele) {
                        cleDeRecuperationOuverte = false
                    }
                    modele.corbeilleOuverte -> EcranDeLaCorbeille(modele) {
                        modele.fermerLaCorbeille()
                    }
                    // La santé passe **avant** l'édition : on y désigne un élément à
                    // corriger, et l'ouvrir doit refermer la santé plutôt que l'empiler.
                    // L'inverse laisserait derrière soi un écran qui parle d'un coffre
                    // qu'on vient de modifier.
                    modele.santeOuverte && edition == null -> EcranDeLaSante(
                        modele,
                        surOuvrir = { entree ->
                            modele.santeOuverte = false
                            modele.message = null
                            edition = Edition(entree)
                        },
                        surFermer = { modele.santeOuverte = false },
                    )
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
                        surSante = { modele.santeOuverte = true },
                        surReglages = { reglagesOuverts = true },
                        surImport = { modele.message = null; importOuvert = true },
                        surSecondFacteur = {
                            modele.message = null
                            secondFacteurOuvert = true
                        },
                        surJournal = { modele.message = null; journalOuvert = true },
                        surCleDeRecuperation = {
                            modele.message = null
                            cleDeRecuperationOuverte = true
                        },
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
     * L'application passe à l'arrière-plan : on verrouille, ou on note l'heure.
     *
     * Le verrouillage jette les clés, pas la session — le jeton reste valable et le coffre
     * se rouvre du seul mot de passe maître, sans réseau.
     *
     * **Le délai réglable est désormais porté**, et ce commentaire disait avant pourquoi il
     * ne l'était pas : « l'assouplir demande de savoir mesurer le temps écoulé y compris
     * quand l'horloge recule ». La réponse tient en un nom — `SystemClock.elapsedRealtime()`
     * compte depuis le démarrage de l'appareil, veille comprise, et ne peut pas reculer.
     * `System.currentTimeMillis()` aurait eu exactement le défaut redouté : reculer sa
     * montre de dix minutes aurait rallongé le délai d'autant.
     *
     * Le repli est le comportement strict. Délai nul — le défaut — verrouille ici même, et
     * le coffre ne survit à rien.
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
        if (isChangingConfigurations) return
        // Un sélecteur du système est une activité d'une autre application : on passe par
        // ici au moment même où l'utilisateur va choisir son fichier. Verrouiller alors
        // rendrait l'import impossible, et sans rien dire (voir `unSelecteurEstOuvert`).
        if (modele.unSelecteurEstOuvert) return
        val delai = reglages.verrouillage.delaiMs
        if (delai == null) {
            modele.verrouiller()
            quitteA = null
        } else {
            quitteA = SystemClock.elapsedRealtime()
        }
    }

    /**
     * L'instant du départ, sur l'horloge **monotone** de l'appareil.
     *
     * `null` veut dire « rien à attendre » : soit on a verrouillé en partant, soit on n'est
     * jamais parti. Le distinguer de zéro compte — zéro est un instant valable, celui du
     * démarrage de l'appareil.
     */
    private var quitteA: Long? = null

    /**
     * On revient : le délai est-il écoulé ?
     *
     * Le contrôle est ici et pas dans un minuteur, et c'est délibéré. Un minuteur posé au
     * départ devrait survivre à une application qu'Android peut suspendre ou tuer à tout
     * moment, et **son silence se lirait comme un coffre encore ouvert**. Regarder l'heure
     * au retour ne peut pas échouer de cette façon : si le processus a été tué, le coffre
     * est fermé de toute manière, faute de clés en mémoire.
     */
    override fun onStart() {
        super.onStart()
        // **L'exemption se rend au retour, quoi qu'il se soit passé.** Elle est posée ici
        // et non dans le rappel du sélecteur, parce qu'un sélecteur peut ne jamais
        // répondre — l'utilisateur le quitte par le bouton retour, ou le système le tue.
        // Une exemption qui survivrait à cela laisserait un coffre qui ne se verrouille
        // plus jamais tout seul, et personne ne s'en apercevrait.
        modele.unSelecteurEstOuvert = false
        val depart = quitteA ?: return
        quitteA = null
        val delai = reglages.verrouillage.delaiMs ?: return modele.verrouiller()
        if (SystemClock.elapsedRealtime() - depart >= delai) modele.verrouiller()
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
