package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.LocalCouleurs

/**
 * La corbeille : ce qu'un effacement a mis de côté sans le détruire.
 *
 * Elle existe parce que `DELETE /api/vault/items/:id` est un effacement **doux** — la ligne
 * reçoit un `deletedAt` et sort de la liste, sans disparaître. Sans cet écran, cette nuance
 * était invisible : l'utilisateur croyait détruire, et le serveur gardait tout. Les deux
 * malentendus sont mauvais, en sens contraires.
 *
 * **La destruction définitive demande deux gestes**, comme la mise à la corbeille. C'est le
 * seul endroit du produit où une action est irréversible : personne ne peut rendre un mot de
 * passe que personne n'a plus.
 *
 * Les lignes illisibles y figurent aussi (§5). C'est même plus important ici qu'ailleurs :
 * la corbeille est le dernier endroit où l'on peut rattraper quelque chose, et une ligne qui
 * y disparaîtrait serait perdue sans que personne ne l'ait décidé.
 */
@Composable
fun EcranDeLaCorbeille(modele: ModeleDuCoffre, surFin: () -> Unit) {
    val couleurs = LocalCouleurs.current
    val lecture = modele.corbeille
    var aPurger by rememberSaveable { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(stringResource(R.string.corbeille_titre), color = couleurs.encre,
                    fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Box(Modifier.widthIn(max = 120.dp)) {
                    BoutonSecondaire(
                        stringResource(R.string.corbeille_retour),
                        identifiant = "button.backFromTrash",
                    ) { surFin() }
                }
            }

            modele.message?.let {
                Text(it, color = couleurs.danger, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            }

            if (lecture.entrees.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        stringResource(R.string.corbeille_vide),
                        color = couleurs.attenue,
                        fontSize = 14.sp,
                    )
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(lecture.entrees, key = { it.id }) { entree ->
                        LigneDeCorbeille(
                            entree = entree,
                            confirmeLaPurge = aPurger == entree.id,
                            surRestaurer = { modele.restaurer(entree.id) },
                            surPurger = {
                                if (aPurger == entree.id) {
                                    aPurger = null
                                    modele.purger(entree.id)
                                } else {
                                    aPurger = entree.id
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LigneDeCorbeille(
    entree: EntreeDuCoffre,
    confirmeLaPurge: Boolean,
    surRestaurer: () -> Unit,
    surPurger: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonCarte)
    Column(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.6f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            when (entree) {
                is EntreeDuCoffre.Lisible -> entree.element.name
                // Une ligne illisible garde sa place ici aussi, et ne prétend pas avoir un
                // nom : il vit dans le chiffré.
                // La même clé qu'au coffre : c'est la même ligne, dite au même endroit du
                // produit, et deux clés jumelles finiraient par se traduire différemment.
                is EntreeDuCoffre.Illisible -> stringResource(R.string.coffre_element_illisible)
            },
            color = couleurs.encre,
            fontSize = 15.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.widthIn(max = 140.dp)) {
                BoutonSecondaire(
                    stringResource(R.string.corbeille_restaurer),
                    identifiant = "button.restore",
                ) { surRestaurer() }
            }
            Box(Modifier.widthIn(max = 180.dp)) {
                BoutonSecondaire(
                    texte = stringResource(
                        if (confirmeLaPurge) {
                            R.string.corbeille_confirmer
                        } else {
                            R.string.corbeille_detruire
                        },
                    ),
                    destructif = true,
                    identifiant = "button.purge",
                ) { surPurger() }
            }
        }
    }
}
