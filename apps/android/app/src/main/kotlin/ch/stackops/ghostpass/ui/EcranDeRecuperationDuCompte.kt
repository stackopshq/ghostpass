package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.ValeurFigee
import ch.stackops.ghostpass.theme.reperes

/**
 * Réinitialiser le mot de passe maître avec la clé de récupération.
 *
 * **Rien ne s'ouvre ici** : le serveur invalide toutes les sessions, et c'est voulu — si
 * quelqu'un vient de réinitialiser le mot de passe, celles restées ouvertes ailleurs n'ont
 * plus lieu d'être. L'écran renvoie donc à la connexion, avec le nouveau mot de passe.
 *
 * Il s'ouvre depuis l'écran d'entrée, et pas depuis le coffre : on n'y arrive que **parce
 * qu'on ne peut pas entrer**.
 */
@Composable
fun EcranDeRecuperationDuCompte(
    modele: ModeleDuCoffre,
    serveur: String,
    email: String,
    surFermer: () -> Unit,
    surReussite: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var cle by remember { mutableStateOf("") }
    var nouveau by remember { mutableStateOf("") }

    val pret = cle.isNotBlank() && nouveau.length >= 8 && !modele.occupe

    EcranGhost(identifiant = "screen.recoverAccount") {
        BarreDeFeuille(
            titre = "Mot de passe oublié",
            gauche = "Annuler",
            identifiantGauche = "button.cancelRecovery",
            surGauche = {
                modele.message = null
                surFermer()
            },
        )

        SectionGhost(
            note = "Le nouveau mot de passe rechiffre la clé du coffre. Son contenu reste " +
                "intact : rien n'est perdu, rien n'est déchiffré côté serveur.",
        ) {
            Column {
                // L'adresse et le compte viennent de l'écran d'entrée : les redemander ne
                // servirait qu'à les faire retaper, et une faute de frappe ici enverrait la
                // demande au mauvais compte.
                Box(Modifier.padding(14.dp)) { ValeurFigee("Adresse e-mail", email) }
                FiletDeSection()
                Box(Modifier.padding(14.dp)) {
                    ChampGhost(
                        intitule = "Clé de récupération",
                        valeur = cle,
                        invite = "Les mots notés à la création",
                        identifiant = "field.recoveryKey",
                        onChange = { cle = it },
                    )
                }
                FiletDeSection()
                Box(Modifier.padding(14.dp)) {
                    ChampGhost(
                        intitule = "Nouveau mot de passe maître",
                        valeur = nouveau,
                        invite = "Huit caractères au minimum",
                        identifiant = "field.newMaster",
                        secret = true,
                        typeDeClavier = KeyboardType.Password,
                        onChange = { nouveau = it },
                    )
                }
            }
        }

        if (nouveau.isNotEmpty() && nouveau.length < 8) {
            Text("Huit caractères au minimum.", color = couleurs.attenue, fontSize = 12.sp)
        }

        modele.message?.let {
            Text(
                "⚠ $it",
                color = couleurs.danger,
                fontSize = 12.sp,
                modifier = Modifier.reperes("text.recoverError"),
            )
        }

        BoutonPrincipal("Réinitialiser", actif = pret, identifiant = "button.submitRecovery") {
            modele.recupererLeCompte(serveur, email, cle, nouveau) { fait ->
                if (fait) surReussite()
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                "Toutes les sessions ouvertes seront fermées, y compris sur vos autres " +
                    "appareils. Il faudra s'y reconnecter avec le nouveau mot de passe.",
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
    }
}
