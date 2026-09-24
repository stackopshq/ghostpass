package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs

/**
 * Les deux boîtes du partage de lien : la confirmation de destination, puis le lien.
 *
 * Elles sont posées au-dessus de toute l'application plutôt que dans un écran, parce que
 * l'ordre est ce qui compte : **la destination se confirme avant que la clé ne soit
 * affichée**. Une boîte qui recouvre tout ne peut pas être contournée par un retour arrière
 * ou un changement d'écran, là où un panneau posé dans une liste le pourrait.
 */
@Composable
fun BoitesDePartage(modele: ModeleDuCoffre) {
    ConfirmationDeDestination(modele)
    LienAMontrer(modele)
}

/**
 * « Ce lien pointe vers un autre domaine que votre serveur. »
 *
 * C'est le point de sécurité le plus important du produit, et il ne se comprend pas tout
 * seul : le texte doit dire **pourquoi** on demande. La clé voyage dans le fragment, que le
 * navigateur n'envoie pas au serveur — mais la page servie par ce domaine est du code que ce
 * domaine contrôle, et rien ne l'empêche de lire `location.hash`.
 *
 * Un refus **révoque** le partage, qui existe déjà côté serveur à cet instant. Le bouton le
 * dit, sans quoi « Annuler » se lirait « ne rien faire » — et laisserait un secret publié.
 */
@Composable
private fun ConfirmationDeDestination(modele: ModeleDuCoffre) {
    val attente = modele.destinationAConfirmer ?: return
    val couleurs = LocalCouleurs.current
    var memoriser by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { modele.refuserLaDestination() },
        title = {
            Text(stringResource(R.string.partage_destination_titre), fontWeight = FontWeight.Bold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(R.string.partage_destination_corps, attente.hote),
                    color = couleurs.encre,
                    fontSize = 14.sp,
                )
                Text(
                    stringResource(R.string.partage_destination_cle),
                    color = couleurs.attenue,
                    fontSize = 13.sp,
                )
                LienDiscret(
                    // La case cochée est un signe, pas un mot : elle reste ici, et la
                    // ressource dit où elle se pose dans la phrase.
                    texte = stringResource(
                        R.string.partage_retenir_hote,
                        if (memoriser) "☑" else "☐",
                        attente.hote,
                    ),
                    identifiant = "button.rememberHost",
                ) { memoriser = !memoriser }
            }
        },
        confirmButton = {
            BoutonPrincipal(
                texte = stringResource(R.string.partage_continuer),
                actif = true,
                identifiant = "button.trustHost",
            ) { modele.confirmerLaDestination(memoriser) }
        },
        dismissButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.partage_annuler_et_revoquer),
                destructif = true,
                identifiant = "button.revokeShare",
            ) { modele.refuserLaDestination() }
        },
        containerColor = couleurs.surface,
    )
}

/** Le lien, une fois la destination acceptée. */
@Composable
private fun LienAMontrer(modele: ModeleDuCoffre) {
    val lien = modele.lienDePartage ?: return
    val couleurs = LocalCouleurs.current
    val presse = LocalClipboardManager.current

    AlertDialog(
        onDismissRequest = { modele.lienDePartage = null },
        title = { Text(stringResource(R.string.partage_lien_titre), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(lien, color = couleurs.encre, fontSize = 12.sp)
                Text(
                    // La clé est dans le lien : le tronquer le rendrait inutilisable, et le
                    // dire évite qu'on le recopie à la main en oubliant ce qui suit le « # ».
                    stringResource(R.string.partage_lien_avertissement),
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                )
            }
        },
        confirmButton = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BoutonPrincipal(
                    texte = stringResource(R.string.partage_copier),
                    actif = true,
                    identifiant = "button.copyLink",
                ) {
                    presse.setText(AnnotatedString(lien))
                    modele.lienDePartage = null
                }
            }
        },
        dismissButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.partage_fermer),
                identifiant = "button.closeLink",
            ) {
                modele.lienDePartage = null
            }
        },
        containerColor = couleurs.surface,
    )
}
