package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.SanteDuCoffre
import ch.stackops.ghostpass.VerificationDeFuite
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * La santé du coffre : ce qui est faible, ce qui est réutilisé, ce qui a fuité.
 *
 * Les deux premières listes se calculent sur l'appareil, sans rien demander à personne. La
 * troisième interroge Have I Been Pwned, et **c'est la seule chose de cette application qui
 * parle à un tiers** : elle ne part donc qu'à la demande, sur un bouton, jamais toute seule
 * au chargement de l'écran.
 *
 * La disposition suit `apps/ios/AppStore/captures/03-sante.png`.
 */
@Composable
fun EcranDeLaSante(
    modele: ModeleDuCoffre,
    surOuvrir: (EntreeDuCoffre.Lisible) -> Unit,
    surFermer: () -> Unit,
) {
    val bilan = remember(modele.lectureAffichee) {
        SanteDuCoffre.bilan(modele.lectureAffichee.entrees)
    }
    var verification by remember { mutableStateOf<Verification>(Verification.PasEncore) }

    EcranGhost(identifiant = "screen.health") {
        BarreDeFeuille(
            titre = "Santé du coffre",
            gauche = "Fermer",
            identifiantGauche = "button.closeHealth",
            surGauche = surFermer,
        )

        Resume(bilan)

        if (bilan.faibles.isNotEmpty()) {
            Liste(
                titre = "Mots de passe faibles",
                note = "Trop courts, ou faits d'une seule sorte de caractères.",
                entrees = bilan.faibles,
                marque = "!",
                surOuvrir = surOuvrir,
            )
        }
        if (bilan.reutilises.isNotEmpty()) {
            Liste(
                titre = "Mots de passe réutilisés",
                note = "Une seule fuite suffit alors à ouvrir plusieurs comptes.",
                entrees = bilan.reutilises,
                marque = "↻",
                surOuvrir = surOuvrir,
            )
        }

        Fuites(modele, verification, surOuvrir) { verification = it }

        if (bilan.sansCode.isNotEmpty()) {
            Liste(
                titre = "Sans code à usage unique",
                note = "Le second facteur protège même un mot de passe connu.",
                entrees = bilan.sansCode,
                marque = "#",
                surOuvrir = surOuvrir,
            )
        }
    }

    // Rien ici ne part sur le réseau tout seul. Ce `LaunchedEffect` ne sert qu'à oublier
    // une vérification faite sur un coffre qui a changé depuis : afficher « aucune fuite »
    // à propos d'une liste d'éléments qu'on ne regarde plus serait faux, et rassurant.
    LaunchedEffect(modele.lectureAffichee) {
        if (verification is Verification.Faite) verification = Verification.PasEncore
    }

}

/** Où en est la vérification des fuites. Quatre états, et **ils se distinguent à l'écran**. */
private sealed interface Verification {
    data object PasEncore : Verification
    data object EnCours : Verification
    data class Faite(val compromis: List<EntreeDuCoffre.Lisible>) : Verification
    data class Echouee(val cause: String) : Verification
}

/**
 * L'état d'ensemble, en tête.
 *
 * **Sans lui, un coffre sain n'afficherait qu'une page vide**, qu'on prendrait pour un écran
 * qui n'a pas fini de charger. C'est le repli silencieux le plus banal : l'absence de
 * mauvaise nouvelle ne se lit pas comme une bonne nouvelle, elle se lit comme une panne.
 */
@Composable
private fun Resume(bilan: SanteDuCoffre.Bilan) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    val sain = bilan.estSain
    val teinte = if (sain) couleurs.succes else couleurs.danger

    Row(
        Modifier.fillMaxWidth().carteDeVerre(marge = 18.dp).reperes("card.healthSummary"),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(52.dp).background(teinte.copy(alpha = 0.14f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (sain) "✓" else "!", color = teinte, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                if (sain) {
                    "Rien à signaler"
                } else {
                    // **`plurals`.** iOS affichait « 1 mots de passe à revoir » — un coffre
                    // avec un seul défaut est le cas le plus fréquent, et c'est celui sur
                    // lequel la phrase se trompait.
                    contexte.resources.getQuantityString(
                        R.plurals.sante_a_revoir, bilan.aRevoir, bilan.aRevoir,
                    )
                },
                color = couleurs.encre,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                contexte.resources.getQuantityString(
                    R.plurals.sante_examines, bilan.examines, bilan.examines,
                ),
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
    }
}

/** Une des listes de défauts : son intitulé, ses lignes, et la note qui dit le critère. */
@Composable
private fun Liste(
    titre: String,
    note: String,
    entrees: List<EntreeDuCoffre.Lisible>,
    marque: String,
    surOuvrir: (EntreeDuCoffre.Lisible) -> Unit,
) {
    SectionGhost(titre = titre, note = note) {
        Column {
            entrees.forEachIndexed { index, entree ->
                if (index > 0) FiletDeSection()
                Ligne(entree, marque, surOuvrir)
            }
        }
    }
}

@Composable
private fun Ligne(
    entree: EntreeDuCoffre.Lisible,
    marque: String,
    surOuvrir: (EntreeDuCoffre.Lisible) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { surOuvrir(entree) }
            .reperes("row.health." + entree.id)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(30.dp)
                .background(couleurs.danger.copy(alpha = 0.12f), RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(marque, color = couleurs.danger, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(entree.element.name, color = couleurs.encre, fontSize = 15.sp)
            val compte = entree.element.identifiants?.username.orEmpty()
            if (compte.isNotEmpty()) {
                Text(compte, color = couleurs.attenue, fontSize = 12.sp)
            }
        }
        Text("›", color = couleurs.attenue, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * La section des fuites connues.
 *
 * Son bouton est le seul de l'application qui déclenche un appel vers un tiers. La note
 * sous la carte dit exactement ce qui part, et ce n'est pas de la décoration : c'est la
 * seule information qui permette de décider d'appuyer. `SanteDuCoffreTest` tient la
 * promesse qu'elle fait.
 */
@Composable
private fun Fuites(
    modele: ModeleDuCoffre,
    verification: Verification,
    surOuvrir: (EntreeDuCoffre.Lisible) -> Unit,
    surEtat: (Verification) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var demande by remember { mutableStateOf(0) }

    LaunchedEffect(demande) {
        if (demande == 0) return@LaunchedEffect
        surEtat(Verification.EnCours)
        val entrees = modele.lectureAffichee.entrees
        val resultat = runCatching {
            withContext(Dispatchers.IO) { VerificationDeFuite.compromis(entrees) }
        }
        surEtat(
            resultat.fold(
                onSuccess = { Verification.Faite(it) },
                // **On ne retombe pas sur « aucune fuite ».** Un service muet et un coffre
                // sain donneraient alors le même écran, et le second est rassurant.
                onFailure = { Verification.Echouee(it.message ?: "le service n'a pas répondu") },
            ),
        )
    }

    SectionGhost(
        titre = "Fuites connues",
        note = "Seuls les cinq premiers caractères de l'empreinte du mot de passe sont " +
            "envoyés : ni le mot de passe ni son empreinte complète ne quittent l'appareil.",
    ) {
        when (verification) {
            is Verification.PasEncore, is Verification.Echouee -> Column(
                Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (verification is Verification.Echouee) {
                    Text(
                        "⚠ Le service de vérification n'a pas répondu (${verification.cause}).",
                        color = couleurs.danger,
                        fontSize = 12.sp,
                        modifier = Modifier.reperes("text.breachFailed"),
                    )
                }
                BoutonSecondaire("Vérifier les fuites", identifiant = "button.checkBreaches") {
                    demande++
                }
            }

            is Verification.EnCours -> Row(
                Modifier.padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), color = couleurs.accentTexte, strokeWidth = 2.dp)
                Text("Vérification…", color = couleurs.attenue, fontSize = 13.sp)
            }

            is Verification.Faite -> if (verification.compromis.isEmpty()) {
                Text(
                    "✓ Aucun mot de passe connu des fuites publiques.",
                    color = couleurs.succes,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(14.dp).reperes("text.noBreach"),
                )
            } else {
                Column {
                    verification.compromis.forEachIndexed { index, entree ->
                        if (index > 0) FiletDeSection()
                        Ligne(entree, "🔥", surOuvrir)
                    }
                }
            }
        }
    }
}
