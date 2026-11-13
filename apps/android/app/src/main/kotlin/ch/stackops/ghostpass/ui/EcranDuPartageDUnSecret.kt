package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.reperes

/**
 * Partager un texte libre par un lien qui expire — l'entrée « Partager un secret » d'iOS
 * (`apps/ios/Ghostpass/Views/SendView.swift`).
 *
 * Jusqu'au 2026-11-13, Android ne partageait qu'à partir d'un élément du coffre. Les deux
 * chemins mènent désormais au même endroit (`ModeleDuCoffre.partagerUnSecret`), donc à la
 * même règle : la destination se confirme avant que la clé ne soit remise, et c'est
 * `BoitesDePartage`, posée au-dessus de tout, qui montre le lien.
 *
 * Les mêmes réglages qu'iOS : quatre durées, et un nombre de consultations de 1 à 100.
 */
@Composable
fun EcranDuPartageDUnSecret(modele: ModeleDuCoffre, surFermer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    // `remember` et non `rememberSaveable` : le texte est un secret en clair, et il n'a
    // rien à faire dans l'état sauvegardé qu'Android écrit quand il tue le processus.
    var secret by remember { mutableStateOf("") }
    var heures by remember { mutableIntStateOf(24) }
    var consultations by remember { mutableIntStateOf(1) }

    // Le lien est remis : le texte n'a plus de raison de rester à l'écran.
    LaunchedEffect(modele.lienDePartage) {
        if (modele.lienDePartage != null) secret = ""
    }

    val durees = listOf(
        1 to stringResource(R.string.secret_1_heure),
        24 to stringResource(R.string.secret_1_jour),
        168 to stringResource(R.string.secret_1_semaine),
        720 to stringResource(R.string.secret_30_jours),
    )

    EcranGhost(identifiant = "screen.send") {
        BarreDeFeuille(
            titre = stringResource(R.string.secret_titre),
            gauche = stringResource(R.string.secret_annuler),
            identifiantGauche = "button.closeSend",
            surGauche = surFermer,
        )

        SectionGhost(
            titre = stringResource(R.string.secret_le_secret),
            note = stringResource(R.string.secret_le_secret_note),
        ) {
            TextField(
                value = secret,
                onValueChange = { secret = it },
                minLines = 5,
                textStyle = androidx.compose.material3.LocalTextStyle.current.copy(
                    color = couleurs.encre,
                    fontSize = 15.sp,
                ),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = couleurs.accentTexte,
                ),
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp).reperes("field.sendSecret"),
            )
        }

        SectionGhost(titre = stringResource(R.string.secret_duree)) {
            Row(
                Modifier.fillMaxWidth().padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for ((valeur, libelle) in durees) {
                    Box(Modifier.weight(1f)) {
                        Pastilledechoix(
                            texte = libelle,
                            choisie = heures == valeur,
                            identifiant = "chip.sendExpiry.$valeur",
                        ) { heures = valeur }
                    }
                }
            }
        }

        SectionGhost(
            titre = stringResource(R.string.secret_consultations),
            note = stringResource(R.string.secret_consultations_note),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.weight(1f)) {
                    BoutonSecondaire(
                        "−",
                        actif = consultations > 1,
                        identifiant = "button.sendViewsLess",
                    ) { consultations -= 1 }
                }
                Text(
                    pluralStringResource(R.plurals.secret_n_consultations, consultations, consultations),
                    color = couleurs.encre,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(2f).reperes("text.sendViews"),
                )
                Box(Modifier.weight(1f)) {
                    BoutonSecondaire(
                        "+",
                        actif = consultations < 100,
                        identifiant = "button.sendViewsMore",
                    ) { consultations += 1 }
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BoutonPrincipal(
                texte = stringResource(R.string.secret_creer_le_lien),
                actif = secret.isNotBlank() && !modele.occupe,
                identifiant = "button.createSend",
            ) { modele.partagerUnTexte(secret, heures, consultations) }

            modele.message?.let { texte ->
                Text(texte, color = couleurs.danger, fontSize = 12.sp)
            }
        }
    }
}
