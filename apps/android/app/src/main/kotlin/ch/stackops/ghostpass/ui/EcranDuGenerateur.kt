package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.GenerateurDeMotDePasse
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.ReglagesDuGenerateur
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.CarteDeSection
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IntituleDeSection
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.reperes
import kotlin.math.roundToInt

/**
 * Le générateur de mots de passe, ouvert depuis le formulaire d'édition.
 *
 * **Le mot de passe n'est que proposé.** Rien n'est enregistré ici — c'est l'écran
 * d'édition qui décide, et seulement si on appuie sur « Utiliser ». C'est la même règle
 * qu'iOS, et elle compte : un générateur qui écrirait directement dans le coffre
 * remplacerait un mot de passe en service sur un simple coup d'œil.
 *
 * La disposition suit la capture `apps/ios/AppStore/captures/05-generateur.png`, regardée
 * plutôt que déduite du Swift : la carte du mot de passe, sa force et son compte de bits à
 * gauche et « Régénérer » à droite, puis la longueur, puis les quatre jeux de caractères.
 *
 * Toute modification de réglage régénère. Voir l'effet d'un réglage évite de se demander
 * s'il a été pris en compte — et sur un écran où la seule sortie est un mot de passe, un
 * réglage sans effet visible se lirait comme un réglage ignoré.
 */
@Composable
fun EcranDuGenerateur(
    surAnnuler: () -> Unit,
    surUtiliser: (String) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    var reglages by remember { mutableStateOf(ReglagesDuGenerateur()) }
    var motDePasse by remember { mutableStateOf(GenerateurDeMotDePasse.generer(ReglagesDuGenerateur())) }

    fun regenerer(nouveaux: ReglagesDuGenerateur) {
        reglages = nouveaux
        motDePasse = GenerateurDeMotDePasse.generer(nouveaux)
    }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            BarreDuGenerateur(
                peutUtiliser = motDePasse.isNotEmpty(),
                surAnnuler = surAnnuler,
                surUtiliser = { surUtiliser(motDePasse) },
            )

            // ─── Le mot de passe, sa force, et de quoi le rejouer ───
            CarteDeSection {
                Column(
                    Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        motDePasse,
                        color = couleurs.encre,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Medium,
                        // À chasse fixe, comme iOS : c'est ce qui distingue un `l` d'un `1`
                        // et un `O` d'un `0` pour qui recopie le mot de passe à la main.
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.fillMaxWidth().reperes("text.generated"),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Force(GenerateurDeMotDePasse.bits(reglages))
                        Spacer(Modifier.weight(1f))
                        LienDiscret(
                            texte = stringResource(R.string.generateur_regenerer),
                            identifiant = "button.regenerate",
                        ) { regenerer(reglages) }
                    }
                }
            }

            // ─── La longueur ───
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // **`plurals` et non « caractère(s) ».** À 1, iOS affichait « 1 mots de passe
                // à revoir » ; la parenthèse est la version qui ne se trompe jamais et ne
                // se lit bien jamais non plus. Kotlin a les pluriels de ressources.
                IntituleDeSection(
                    contexte.resources.getQuantityString(
                        R.plurals.generateur_longueur, reglages.longueur, reglages.longueur,
                    ),
                )
                CarteDeSection {
                    Slider(
                        value = reglages.longueur.toFloat(),
                        onValueChange = { regenerer(reglages.copy(longueur = it.roundToInt())) },
                        // Pas moins de 8 : en dessous, la longueur ne protège plus de rien.
                        valueRange = GenerateurDeMotDePasse.LONGUEUR_MIN.toFloat()..
                            GenerateurDeMotDePasse.LONGUEUR_MAX.toFloat(),
                        steps = GenerateurDeMotDePasse.LONGUEUR_MAX -
                            GenerateurDeMotDePasse.LONGUEUR_MIN - 1,
                        colors = SliderDefaults.colors(
                            thumbColor = couleurs.surAccent,
                            activeTrackColor = couleurs.accent,
                            inactiveTrackColor = couleurs.surface2,
                            // Material dessine un point par cran. À cinquante-six crans, la
                            // piste devient une ligne pointillée illisible ; iOS n'en montre
                            // aucun. Les crans restent, leurs marques disparaissent.
                            activeTickColor = Color.Transparent,
                            inactiveTickColor = Color.Transparent,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                            .reperes("slider.length"),
                    )
                }
            }

            // ─── Les jeux de caractères ───
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                IntituleDeSection(stringResource(R.string.generateur_caracteres))
                CarteDeSection {
                    Column {
                        // Les exemples ne sont pas des mots : ils montrent les caractères
                        // eux-mêmes, et restent donc en dur à côté des noms traduits.
                        Bascule(
                            stringResource(R.string.generateur_minuscules),
                            "a-z", reglages.minuscules, "toggle.lowercase",
                        ) {
                            regenerer(reglages.copy(minuscules = it))
                        }
                        FiletDeSection()
                        Bascule(
                            stringResource(R.string.generateur_majuscules),
                            "A-Z", reglages.majuscules, "toggle.uppercase",
                        ) {
                            regenerer(reglages.copy(majuscules = it))
                        }
                        FiletDeSection()
                        Bascule(
                            stringResource(R.string.generateur_chiffres),
                            "0-9", reglages.chiffres, "toggle.digits",
                        ) {
                            regenerer(reglages.copy(chiffres = it))
                        }
                        FiletDeSection()
                        Bascule(
                            stringResource(R.string.generateur_symboles),
                            "!@#$…", reglages.symboles, "toggle.symbols",
                        ) {
                            regenerer(reglages.copy(symboles = it))
                        }
                    }
                }
            }

            Spacer(Modifier.height(40.dp))
        }
    }
}

/**
 * La barre du haut : annuler à gauche, le titre au centre, utiliser à droite.
 *
 * C'est la forme d'une feuille modale d'iOS, portée à la main : Android n'a pas de barre de
 * navigation modale, et `TopAppBar` de Material en donnerait une qui ne ressemble à rien
 * d'autre dans le produit (§10).
 */
@Composable
private fun BarreDuGenerateur(
    peutUtiliser: Boolean,
    surAnnuler: () -> Unit,
    surUtiliser: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(top = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.widthIn(max = 100.dp)) {
            BoutonSecondaire(
                stringResource(R.string.generateur_annuler),
                identifiant = "button.cancelGenerator",
            ) { surAnnuler() }
        }
        Text(
            stringResource(R.string.generateur_titre),
            color = couleurs.encre,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f).padding(horizontal = 10.dp),
        )
        Box(Modifier.widthIn(max = 100.dp)) {
            BoutonSecondaire(
                texte = stringResource(R.string.generateur_utiliser),
                actif = peutUtiliser,
                identifiant = "button.usePassword",
            ) { surUtiliser() }
        }
    }
}

/**
 * La jauge de force, en mots et en bits.
 *
 * Elle ne dit rien d'une fuite — c'est la santé du coffre qui répond à cette question-là —,
 * seulement de ce qu'il en coûterait de deviner un mot de passe tiré de ces réglages. Les
 * deux se ressemblent assez pour qu'on les confonde, et confondre « impossible à deviner »
 * avec « jamais volé » est exactement l'erreur qu'un gestionnaire de mots de passe ne doit
 * pas encourager.
 */
@Composable
private fun Force(bits: Double) {
    val couleurs = LocalCouleurs.current
    val (libelle, couleur) = when (GenerateurDeMotDePasse.force(bits)) {
        GenerateurDeMotDePasse.Force.EXCELLENT ->
            stringResource(R.string.generateur_force_excellent) to couleurs.succes
        GenerateurDeMotDePasse.Force.SOLIDE ->
            stringResource(R.string.generateur_force_solide) to couleurs.succes
        GenerateurDeMotDePasse.Force.CORRECT ->
            stringResource(R.string.generateur_force_correct) to couleurs.accentTexte
        GenerateurDeMotDePasse.Force.FAIBLE ->
            stringResource(R.string.generateur_force_faible) to couleurs.danger
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            libelle,
            color = couleur,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.strength"),
        )
        // « ≈ 42 bits » : un nombre et son unité, qui s'écrivent de la même façon partout.
        // Rien à traduire, donc rien à sortir en ressource.
        Text("≈ ${bits.toInt()} bits", color = couleurs.attenue, fontSize = 11.sp)
    }
}

/** Une ligne de bascule : son nom, un exemple de ses caractères, et l'interrupteur. */
@Composable
private fun Bascule(
    titre: String,
    exemple: String,
    actif: Boolean,
    identifiant: String,
    surChangement: (Boolean) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(titre, color = couleurs.encre, fontSize = 15.sp)
        Text(
            // « a-z », « 0-9 » : des exemples de caractères, pas de la prose. À chasse fixe
            // pour qu'ils se lisent comme tels.
            exemple,
            color = couleurs.attenue,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(start = 8.dp),
        )
        Spacer(Modifier.weight(1f))
        Switch(
            checked = actif,
            onCheckedChange = surChangement,
            colors = SwitchDefaults.colors(
                checkedThumbColor = couleurs.surAccent,
                checkedTrackColor = couleurs.accent,
                checkedBorderColor = Color.Transparent,
                uncheckedThumbColor = couleurs.attenue,
                uncheckedTrackColor = couleurs.surface2,
                uncheckedBorderColor = couleurs.bordure,
            ),
            modifier = Modifier.reperes(identifiant),
        )
    }
}
