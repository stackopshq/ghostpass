package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ActionDto
import ch.stackops.ghostpass.ConnexionDto
import ch.stackops.ghostpass.JournalDuCompte
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.reperes
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Le journal du compte : connexions et actions sensibles.
 *
 * **C'est le seul écran où l'on peut s'apercevoir qu'un accès n'était pas le sien.** Il est
 * donc construit pour être parcouru vite : les appareils inconnus et les actions qui
 * retirent une protection sont signalés, le reste s'efface.
 *
 * Porté de `apps/ios/Ghostpass/Views/ActivityView.swift`.
 */
@Composable
fun EcranDuJournal(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    LaunchedEffect(Unit) { modele.lireLeJournal() }
    val etat = modele.journal

    EcranGhost(identifiant = "screen.activity") {
        BarreDeFeuille(
            titre = "Journal du compte",
            gauche = "Terminé",
            identifiantGauche = "button.closeActivity",
            surGauche = surFermer,
        )

        when (etat) {
            is ModeleDuCoffre.EtatDuJournal.EnLecture -> {
                val couleurs = LocalCouleurs.current
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 40.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = couleurs.accentTexte, strokeWidth = 2.dp)
                }
            }

            // **Un journal qu'on n'a pas pu lire n'est pas un journal vide.** Les confondre
            // dirait « rien ne s'est passé sur ce compte » à quelqu'un dont on n'a rien lu —
            // sur le seul écran qui puisse révéler une intrusion.
            is ModeleDuCoffre.EtatDuJournal.Indisponible -> Indisponible(etat.cause)

            is ModeleDuCoffre.EtatDuJournal.Lu -> {
                SectionGhost(
                    titre = "Actions sensibles",
                    note = "Ce qui retire une protection ou ouvre le coffre à quelqu'un " +
                        "d'autre. Une ligne que vous ne reconnaissez pas mérite de changer " +
                        "votre mot de passe maître.",
                ) {
                    if (etat.actions.isEmpty()) {
                        Vide("Aucune action enregistrée.", "text.noActions")
                    } else {
                        Column {
                            etat.actions.forEachIndexed { rang, action ->
                                if (rang > 0) FiletDeSection()
                                LigneDAction(action)
                            }
                        }
                    }
                }

                SectionGhost(
                    titre = "Connexions",
                    note = "Un appareil inconnu signalé ici, que vous ne reconnaissez pas, " +
                        "veut dire que quelqu'un connaît votre mot de passe maître.",
                ) {
                    if (etat.connexions.isEmpty()) {
                        Vide("Aucune connexion enregistrée.", "text.noLogins")
                    } else {
                        Column {
                            etat.connexions.forEachIndexed { rang, connexion ->
                                if (rang > 0) FiletDeSection()
                                LigneDeConnexion(connexion)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Indisponible(cause: String) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "⚠ Le journal n'a pas pu être lu.",
            color = couleurs.danger,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.journalFailed"),
        )
        Text(cause, color = couleurs.attenue, fontSize = 12.sp)
        Text(
            // La phrase compte autant que le reste : un écran vide se lit « rien ne s'est
            // passé », ce qui est rassurant et faux.
            "Ceci ne veut pas dire qu'il ne s'est rien passé : rien n'a pu être lu.",
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun Vide(texte: String, identifiant: String) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = couleurs.attenue,
        fontSize = 13.sp,
        modifier = Modifier.fillMaxWidth().padding(14.dp).reperes(identifiant),
    )
}

@Composable
private fun LigneDAction(action: ActionDto) {
    val couleurs = LocalCouleurs.current
    val sensible = JournalDuCompte.estSensible(action.action)
    Row(
        Modifier.fillMaxWidth().padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // Un triangle pour ce qui compte, une pastille discrète pour le reste. Tout marquer
        // reviendrait à ne rien marquer.
        Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
            if (sensible) {
                Text("⚠", color = couleurs.danger, fontSize = 13.sp)
            } else {
                Box(Modifier.size(6.dp).background(couleurs.attenue, CircleShape))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                JournalDuCompte.intitule(action.action),
                color = if (sensible) couleurs.encre else couleurs.attenue,
                fontSize = 14.sp,
                fontWeight = if (sensible) FontWeight.Medium else FontWeight.Normal,
            )
            Text(
                detail(action.createdAt, action.ip, action.target),
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun LigneDeConnexion(connexion: ConnexionDto) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(quand(connexion.createdAt), color = couleurs.encre, fontSize = 14.sp)
            if (connexion.newDevice) {
                Text(
                    "Nouvel appareil",
                    color = couleurs.surAccent,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .background(couleurs.danger, RoundedCornerShape(50))
                        .reperes("badge.newDevice")
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
        }
        connexion.userAgent?.takeIf { it.isNotEmpty() }?.let {
            Text(it, color = couleurs.attenue, fontSize = 12.sp, maxLines = 2)
        }
        connexion.ip?.takeIf { it.isNotEmpty() }?.let {
            // À chasse fixe : une adresse se compare chiffre à chiffre avec celle qu'on
            // croit être la sienne.
            Text(it, color = couleurs.attenue, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

/**
 * La date, puis la cible et l'adresse si elles apportent quelque chose.
 *
 * L'ordre est celui d'iOS — date, cible, adresse — pour que les deux journaux se lisent
 * pareil. Les morceaux vides sont écartés plutôt qu'affichés comme des séparateurs
 * orphelins.
 */
private fun detail(quand: Long, ip: String?, cible: String?): String =
    listOfNotNull(
        quand(quand),
        cible?.takeIf { it.isNotEmpty() },
        ip?.takeIf { it.isNotEmpty() },
    ).joinToString(" · ")

/**
 * L'horodatage du serveur, en millisecondes, rendu dans le fuseau de l'appareil.
 *
 * `Locale.getDefault()` et non `Locale.ROOT` : une date se lit dans la langue de celui qui
 * la regarde. Le format court suffit — le journal se parcourt, il ne s'archive pas.
 */
private fun quand(millisecondes: Long): String {
    if (millisecondes <= 0) return "date inconnue"
    val format = SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault())
    return format.format(Date(millisecondes))
}
