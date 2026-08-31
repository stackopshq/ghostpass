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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.CouleurDEquipe
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.RaisonDIllisibilite
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IntituleDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs

/**
 * La liste du coffre.
 *
 * C'est ici que la règle §5 devient visible : la liste parcourt `lecture.entrees`, qui
 * contient **aussi** les lignes qui ne se sont pas ouvertes. Filtrer sur `lisibles` serait
 * une ligne plus courte et une régression silencieuse.
 */
@Composable
fun EcranDuCoffre(modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current
    val lecture = modele.lecture

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Coffre",
                    color = couleurs.encre,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                )
                Box(Modifier.widthIn(max = 140.dp)) {
                    BoutonSecondaire("Verrouiller") { modele.verrouiller() }
                }
            }

            modele.message?.let { texte ->
                Text(
                    texte,
                    color = couleurs.danger,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }

            if (modele.horsLigne && lecture.entrees.isNotEmpty()) {
                // Dire d'où vient ce qu'on montre. Une liste du dernier passage présentée
                // comme à jour ferait croire qu'un élément ajouté ailleurs n'existe pas.
                Text(
                    "Hors ligne — dernier état connu.",
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp),
                )
            }

            if (lecture.entrees.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    // « Vide » et « on n'a pas pu regarder » sont deux choses différentes,
                    // et les confondre est la même faute que faire disparaître une ligne
                    // illisible : l'utilisateur conclut qu'il n'a rien enregistré, et
                    // recrée un identifiant qui existe déjà.
                    Text(
                        if (modele.horsLigne) {
                            "Coffre indisponible hors ligne — rien n'a encore été mis en cache."
                        } else {
                            "Ce coffre est vide."
                        },
                        color = couleurs.attenue,
                        fontSize = 14.sp,
                    )
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // `lecture.entrees`, jamais `lecture.lisibles` : c'est la règle §5, et
                    // c'est cette ligne qui la porte.
                    items(lecture.entrees, key = { it.id }) { entree ->
                        when (entree) {
                            is EntreeDuCoffre.Lisible -> LigneLisible(entree)
                            is EntreeDuCoffre.Illisible -> LigneIllisible(entree)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LigneLisible(entree: EntreeDuCoffre.Lisible) {
    val couleurs = LocalCouleurs.current
    val element = entree.element
    val forme = RoundedCornerShape(GP.rayonCarte)

    Row(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.7f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Pastille(element.name)
        Column(Modifier.fillMaxWidth()) {
            Text(element.name, color = couleurs.encre, fontSize = 15.sp)
            val detail = when (val d = element.data) {
                is ContenuDElement.Connexion -> d.valeur.username.ifEmpty { "Identifiant" }
                is ContenuDElement.NoteSecrete -> "Note sécurisée"
                is ContenuDElement.Carte -> "Carte"
            }
            Text(detail, color = couleurs.attenue, fontSize = 13.sp)
        }
    }
}

/**
 * Une ligne qui ne s'est pas ouverte.
 *
 * Elle **garde sa place** et **dit pourquoi**. Elle ne porte aucun nom : le nom vit dans le
 * chiffré, et en inventer un serait pire que de n'en montrer aucun.
 *
 * Sa forme est celle des autres lignes, pas celle d'une erreur : ce n'est pas un incident
 * de l'application, c'est un élément du coffre qui existe et qu'on ne peut pas lire. Une
 * bannière rouge dirait « quelque chose s'est mal passé » là où il faut lire « ceci est à
 * vous, sous une clé que vous n'avez pas ici ».
 */
@Composable
private fun LigneIllisible(entree: EntreeDuCoffre.Illisible) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonCarte)

    Row(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.4f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(32.dp)
                .background(couleurs.surface2, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("🔒", fontSize = 15.sp)
        }
        Column(Modifier.fillMaxWidth()) {
            Text("Élément illisible", color = couleurs.attenue, fontSize = 15.sp)
            Text(
                when (val raison = entree.raison) {
                    // Trois causes, trois conduites à tenir. Un message unique
                    // « erreur de déchiffrement » les rendrait toutes également
                    // décourageantes, et enverrait chercher un problème de clé là où il n'y
                    // en a pas.
                    RaisonDIllisibilite.CleManquante ->
                        "Chiffré sous une clé dont cet appareil ne dispose pas."
                    is RaisonDIllisibilite.SceauRefuse ->
                        "Scellé pour un autre compte, ou sous une clé qui a tourné."
                    is RaisonDIllisibilite.ContenuInconnu ->
                        "Écrit par une version plus récente de GhostPass."
                },
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
    }
}

/**
 * La pastille d'initiale, teintée par la règle de couleur partagée.
 *
 * La même couleur pour le même nom sur les trois clients : c'est [CouleurDEquipe], la
 * somme des octets UTF-8 modulo huit. Aucun hachage de bibliothèque, parce qu'aucun n'est
 * garanti stable d'une exécution à l'autre.
 */
@Composable
private fun Pastille(nom: String) {
    val argb = CouleurDEquipe.couleurArgb(CouleurDEquipe.attribuee(nom))!!
    Box(
        Modifier
            .size(32.dp)
            .background(Color(argb).copy(alpha = 0.9f), RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            nom.take(1).uppercase(),
            color = Color.White,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
