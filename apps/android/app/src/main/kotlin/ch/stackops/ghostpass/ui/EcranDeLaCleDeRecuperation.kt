package ch.stackops.ghostpass.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
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
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * La clé de récupération : **le seul moyen de rouvrir un coffre dont on a oublié le mot de
 * passe maître**.
 *
 * Elle ne s'affiche qu'une fois. Le serveur n'en reçoit qu'une preuve re-hachée, et
 * l'application ne la garde nulle part — c'est ce qui fait que personne d'autre ne peut s'en
 * servir, et c'est aussi ce qui rend cet écran irremplaçable. D'où l'insistance : tant que la
 * clé est à l'écran, on ne propose pas de partir sans l'avoir notée.
 */
@Composable
fun EcranDeLaCleDeRecuperation(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    var cle by remember { mutableStateOf<String?>(null) }

    EcranGhost(identifiant = "screen.recoveryKey") {
        BarreDeFeuille(
            titre = stringResource(R.string.cle_titre),
            gauche = stringResource(
                if (cle == null) R.string.cle_annuler else R.string.cle_termine,
            ),
            identifiantGauche = "button.closeRecovery",
            surGauche = surFermer,
        )

        if (cle == null) {
            Presentation(actif = !modele.occupe, message = modele.message) {
                modele.creerUneCleDeRecuperation { creee -> cle = creee }
            }
        } else {
            Resultat(cle!!)
        }
    }
}

@Composable
private fun Presentation(actif: Boolean, message: String?, surCreer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(76.dp).background(couleurs.accent.copy(alpha = 0.14f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("🔑", fontSize = 30.sp)
            }
        }
        Text(
            stringResource(R.string.cle_pas_de_second_exemplaire),
            color = couleurs.attenue,
            fontSize = 14.sp,
        )
        Text(
            stringResource(R.string.cle_seule_issue),
            color = couleurs.attenue,
            fontSize = 14.sp,
        )
        BoutonPrincipal(
            stringResource(R.string.cle_creer),
            actif = actif,
            identifiant = "button.createRecovery",
        ) { surCreer() }
        if (message != null) {
            Text(
                "⚠ $message",
                color = couleurs.danger,
                fontSize = 12.sp,
                modifier = Modifier.reperes("text.recoveryError"),
            )
        }
    }
}

@Composable
private fun Resultat(cle: String) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    var copiee by remember { mutableStateOf(false) }

    SectionGhost(
        titre = stringResource(R.string.cle_votre),
        note = stringResource(R.string.cle_plus_jamais_affichee),
    ) {
        Text(
            cle,
            color = couleurs.encre,
            fontSize = 15.sp,
            // À chasse fixe : cette clé se recopie à la main sur du papier, et c'est même
            // le rangement qu'on recommande. Distinguer un `l` d'un `1` n'est pas un détail
            // quand la relecture arrive des mois plus tard.
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.fillMaxWidth().padding(14.dp).reperes("text.recoveryKey"),
        )
    }

    BoutonSecondaire(
        texte = stringResource(if (copiee) R.string.cle_copiee else R.string.cle_copier),
        identifiant = "button.copyRecovery",
    ) {
        val presse = contexte.getSystemService(ClipboardManager::class.java)
        val donnees = ClipData.newPlainText("", cle)
        // Comme pour le secret du second facteur : sans ce drapeau, Android affiche un
        // aperçu en grand au bas de l'écran, par-dessus le `FLAG_SECURE` qui ne protège
        // que nos propres fenêtres.
        donnees.description.extras = android.os.PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
        presse?.setPrimaryClip(donnees)
        copiee = true
    }
}
