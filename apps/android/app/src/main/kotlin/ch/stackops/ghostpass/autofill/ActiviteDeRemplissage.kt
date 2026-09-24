package ch.stackops.ghostpass.autofill

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.service.autofill.Dataset
import android.widget.RemoteViews
import androidx.activity.compose.setContent
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.Identifiants
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.RapprochementDeSite
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.ThemeGhostPass
import ch.stackops.ghostpass.theme.carteDeVerre

/**
 * L'écran qui remplit — la moitié du remplissage automatique que le coffre rendait
 * impossible tant qu'ADR-0002 n'était pas prise.
 *
 * ## Pourquoi une activité, et pas le service
 *
 * [ServiceDeRemplissage] ne peut proposer que des lignes **sans valeur**. Il tourne quand le
 * système le lie, potentiellement sans que l'interface ait jamais été ouverte, et il n'a
 * aucun moyen d'obtenir un geste de l'utilisateur : une `RemoteViews` est rendue par un
 * autre processus et ne reçoit pas d'événements. C'est ici, dans une activité qui a l'écran,
 * que l'utilisateur s'authentifie puis **choisit** ce qui sera rempli.
 *
 * Ce partage n'est pas une contrainte subie : c'est ce qui fait tenir la règle « rien ne se
 * remplit sans interaction ». Le service voit passer *toutes* les vues de *toutes* les
 * applications qui demandent un remplissage ; s'il pouvait servir une valeur seul, déclarer
 * un champ au bon moment suffirait à moissonner un coffre.
 *
 * ## Ce qu'elle fait, dans l'ordre
 *
 *  1. la biométrie, si l'enveloppe est posée — le coffre s'ouvre alors **sans réseau et sans
 *     mot de passe maître** (ADR-0002) ;
 *  2. à défaut, le mot de passe maître, qui rouvre la session enregistrée hors ligne ;
 *  3. la liste des identifiants qui conviennent au site demandé ;
 *  4. un `Dataset` rendu au système, **seulement** après un geste sur une ligne.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle ne propose **jamais** de ligne illisible. C'est le seul endroit de l'application où
 * la règle §5 ne s'applique pas, et c'est délibéré : une ligne qu'on ne peut pas ouvrir n'a
 * pas de mot de passe à remplir. La montrer ici ne dirait rien d'utile — le champ resterait
 * vide — alors que dans la liste du coffre elle dit « ceci existe, sous une clé que vous
 * n'avez pas ». Le compteur en bas de l'écran le signale quand même, pour que l'absence ne
 * se lise pas « il n'y a rien ».
 */
@RequiresApi(Build.VERSION_CODES.O)
class ActiviteDeRemplissage : FragmentActivity() {

    companion object {
        const val EXTRA_DOMAINE = "ch.stackops.ghostpass.DOMAINE"
        const val EXTRA_ID_IDENTIFIANT = "ch.stackops.ghostpass.ID_IDENTIFIANT"
        const val EXTRA_ID_MOT_DE_PASSE = "ch.stackops.ghostpass.ID_MOT_DE_PASSE"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Le même voile qu'`ActivitePrincipale` : cet écran affiche des noms de sites et des
        // identifiants, et la vignette du sélecteur d'applications les garderait en clair.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        val domaine = intent.getStringExtra(EXTRA_DOMAINE)
        val idIdentifiant = extraAutofillId(EXTRA_ID_IDENTIFIANT)
        val idMotDePasse = extraAutofillId(EXTRA_ID_MOT_DE_PASSE)

        // Un refus, une sortie par le bouton du système, un plantage : le résultat par
        // défaut doit être « rien ». `RESULT_OK` sans charge ferait croire au système que
        // l'authentification a réussi et laisserait le champ vide sans explication.
        setResult(Activity.RESULT_CANCELED)

        setContent {
            ThemeGhostPass {
                val modele: ModeleDuCoffre = viewModel()
                EcranDeRemplissage(
                    modele = modele,
                    domaine = domaine,
                    surChoix = { identifiants -> rendre(identifiants, idIdentifiant, idMotDePasse) },
                    surAbandon = { finish() },
                )
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun extraAutofillId(nom: String): AutofillId? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(nom, AutofillId::class.java)
        } else {
            intent.getParcelableExtra(nom)
        }

    /**
     * Rend le `Dataset` au système, et **seulement** sur un geste.
     *
     * Ce qui repart est un **`Dataset`**, parce que l'authentification est portée par le jeu
     * et non par la réponse ([ServiceDeRemplissage] dit pourquoi). Les deux niveaux attendent
     * des objets différents, et se tromper ne produit aucune erreur : seulement un champ qui
     * reste vide.
     *
     * Les deux champs sont posés séparément parce qu'ils peuvent manquer indépendamment :
     * une page de connexion en deux temps ne montre que l'identifiant, puis que le mot de
     * passe. Poser une valeur sur un `AutofillId` nul lèverait ; n'en poser aucune rendrait
     * un `Dataset` vide, que le système accepte sans rien remplir.
     */
    private fun rendre(
        identifiants: Identifiants,
        idIdentifiant: AutofillId?,
        idMotDePasse: AutofillId?,
    ) {
        val presentation = RemoteViews(packageName, R.layout.ligne_de_remplissage).apply {
            setTextViewText(R.id.titre, identifiants.username.ifEmpty { getString(R.string.app_name) })
            setTextViewText(R.id.sous_titre, getString(R.string.app_name))
        }

        @Suppress("DEPRECATION")
        val jeu = Dataset.Builder(presentation).apply {
            idIdentifiant?.let {
                setValue(it, AutofillValue.forText(identifiants.username), presentation)
            }
            idMotDePasse?.let {
                setValue(it, AutofillValue.forText(identifiants.password), presentation)
            }
        }.build()

        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, jeu),
        )
        finish()
    }
}

/**
 * L'écran lui-même : déverrouiller, puis choisir.
 *
 * Écrit à part de l'activité pour rester lisible, et parce qu'il ne connaît rien du
 * remplissage — il rend des [Identifiants] à qui les lui demande.
 */
@Composable
private fun EcranDeRemplissage(
    modele: ModeleDuCoffre,
    domaine: String?,
    surChoix: (Identifiants) -> Unit,
    surAbandon: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var motDePasse by rememberSaveable { mutableStateOf("") }
    /** La biométrie n'est proposée qu'une fois : la relancer en boucle serait un piège. */
    var biometrieTentee by rememberSaveable { mutableStateOf(false) }
    val activite = androidx.compose.ui.platform.LocalContext.current as FragmentActivity

    // Le geste que le système attend est déjà fait — l'utilisateur a touché la ligne de
    // GhostPass au-dessus de son clavier. La biométrie s'ouvre donc d'elle-même : lui
    // demander de toucher un second bouton pour arriver au même endroit serait du bruit.
    LaunchedEffect(modele.biometrieActivee, modele.deverrouille) {
        if (!modele.deverrouille && modele.biometrieActivee && !biometrieTentee) {
            biometrieTentee = true
            modele.deverrouillerParBiometrie(activite)
        }
    }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = GP.largeurMax).padding(horizontal = 20.dp, vertical = 28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "Remplir dans " + (domaine ?: "cette application"),
                    color = couleurs.encre,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                )

                if (!modele.deverrouille) {
                    Column(
                        Modifier.fillMaxWidth().carteDeVerre(),
                        verticalArrangement = Arrangement.spacedBy(GP.ecartChamps),
                    ) {
                        if (modele.sessionEnregistree == null) {
                            Text(
                                "Ouvrez GhostPass et connectez-vous une première fois.",
                                color = couleurs.attenue,
                                fontSize = 13.sp,
                            )
                        } else {
                            ChampGhost(
                                intitule = "Mot de passe maître",
                                valeur = motDePasse,
                                invite = "Votre mot de passe",
                                identifiant = "field.master",
                                secret = true,
                                typeDeClavier = KeyboardType.Password,
                                onChange = { motDePasse = it },
                            )
                            modele.message?.let {
                                Text(it, color = couleurs.danger, fontSize = 13.sp)
                            }
                            BoutonPrincipal(
                                texte = "Déverrouiller",
                                actif = !modele.occupe && motDePasse.isNotEmpty(),
                                occupe = modele.occupe,
                                identifiant = "button.submit",
                            ) { modele.deverrouillerHorsLigne(motDePasse) }
                            if (modele.biometrieActivee) {
                                LienDiscret("Utiliser l'empreinte") {
                                    modele.deverrouillerParBiometrie(activite)
                                }
                            }
                        }
                        LienDiscret("Annuler", identifiant = "button.cancel") { surAbandon() }
                    }
                } else {
                    Proposition(modele, domaine, surChoix)
                }
            }
        }
    }
}

/**
 * Les identifiants qui conviennent, et ce qu'on dit quand il n'y en a aucun.
 *
 * Le rapprochement passe par [RapprochementDeSite], **le même objet que la liste du coffre**
 * — pas une seconde règle écrite ici. Deux règles qui divergeraient proposeraient des
 * identifiants différents selon l'endroit d'où l'on regarde.
 *
 * ## Le coffre entier, et pas seulement le sien
 *
 * On lit `coffreComplet`, pas `lecture`. La distinction n'est pas cosmétique : c'est le
 * défaut trouvé le même jour dans l'extension iOS, dont le cache ne contenait que le coffre
 * personnel. Pour un compte dont **tous** les mots de passe vivent en organisation — celui
 * de Clara — le remplissage annonçait « Aucun identifiant » sur tous les sites, ce qui se
 * lit comme une application cassée. Les éléments d'équipe ne sont pas un supplément
 * d'affichage : ils sont le contenu du coffre.
 *
 * **Ce qui reste vrai, et qu'il faut dire** : hors ligne, seul le coffre personnel est
 * proposé. Il a un cache ([StockageDeSession.elementsEnCache]) ; les collections d'équipe
 * n'en ont pas, et se relisent par le réseau. La phrase ci-dessous compte donc les
 * illisibles du coffre entier, mais un remplissage hors ligne ne verra que le personnel —
 * ce n'est pas corrigé ici, et mieux vaut l'écrire que de le laisser croire réglé.
 */
@Composable
private fun Proposition(
    modele: ModeleDuCoffre,
    domaine: String?,
    surChoix: (Identifiants) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val lecture = modele.coffreComplet

    val avecIdentifiants = lecture.lisibles.filter {
        it.element.data is ContenuDElement.Connexion
    }
    // Sans domaine déclaré — le cas d'une application native — on ne devine pas. Proposer
    // tout et le dire vaut mieux que rapprocher un nom de paquet d'un nom d'hôte par une
    // règle inventée ici, qui se tromperait sans jamais l'annoncer.
    val proposes = if (domaine.isNullOrEmpty()) {
        avecIdentifiants
    } else {
        avecIdentifiants.filter { RapprochementDeSite.correspond(it.element, listOf(domaine)) }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (domaine.isNullOrEmpty()) {
            Text(
                "Cette application ne déclare pas de site : tous vos identifiants sont proposés.",
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
        if (proposes.isEmpty()) {
            Text(
                if (avecIdentifiants.isEmpty()) {
                    "Aucun identifiant dans ce coffre."
                } else {
                    "Aucun identifiant enregistré pour ce site."
                },
                color = couleurs.attenue,
                fontSize = 14.sp,
            )
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().heightAdaptative(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(proposes, key = { it.id }) { entree ->
                    LigneProposee(entree) {
                        (entree.element.data as ContenuDElement.Connexion).valeur.let(surChoix)
                    }
                }
            }
        }

        // Ce qui n'a pas pu être ouvert n'est pas remplissable — et son absence ne doit pas
        // se lire « il n'y a rien ». C'est la règle §5 sous la seule forme qu'elle puisse
        // prendre ici : un compte, faute d'une ligne à proposer.
        if (lecture.nombreDIllisibles > 0) {
            Text(
                // Un élément illisible est le cas le plus fréquent, et « 1 élément(s) …
                // n'ont pas pu » se trompe alors deux fois : sur le nom et sur le verbe.
                LocalContext.current.resources.getQuantityString(
                    R.plurals.remplissage_illisibles,
                    lecture.nombreDIllisibles,
                    lecture.nombreDIllisibles,
                ),
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
    }
}

/** Une hauteur bornée : la liste vit dans une colonne déjà défilante. */
private fun Modifier.heightAdaptative(): Modifier = this.heightIn(max = 420.dp)

@Composable
private fun LigneProposee(entree: EntreeDuCoffre.Lisible, surClic: () -> Unit) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonCarte)
    val identifiants = (entree.element.data as ContenuDElement.Connexion).valeur
    Row(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.7f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .clickable(onClick = surClic)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.fillMaxWidth()) {
            Text(entree.element.name, color = couleurs.encre, fontSize = 15.sp)
            Text(
                identifiants.username.ifEmpty { "Sans identifiant" },
                color = couleurs.attenue,
                fontSize = 13.sp,
            )
        }
    }
}
