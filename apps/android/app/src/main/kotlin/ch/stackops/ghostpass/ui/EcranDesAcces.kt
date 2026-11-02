package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.AccesDto
import ch.stackops.ghostpass.CollectionDOrganisation
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.reperes

/**
 * Qui a accès à une collection — et **par quelle porte**.
 *
 * Porté de `CollectionAccessView`. L'écran n'affiche pas la table des octrois directs, et
 * c'est tout son intérêt : cette table ne porte qu'**une** des trois sources d'accès. Un
 * administrateur d'organisation a la gestion sans aucune ligne, et un groupe donne l'accès
 * à tous ses membres sans ligne non plus.
 *
 * Le symptôme, relevé le 2026-08-29 dans l'organisation `stackops` : la collection
 * `providers` n'affichait **personne**, alors que ses deux administratrices y lisaient et y
 * écrivaient, l'une venant d'y déposer un mot de passe. Une liste d'accès qui dit
 * « personne » là où deux personnes entrent ne se trompe pas dans le sens anodin : elle
 * invite à donner un accès déjà donné, et fait croire qu'une révocation ferme une porte
 * restée ouverte.
 *
 * D'où deux choses à l'écran : la **provenance** de chaque accès, et le fait que seul
 * l'octroi direct se reprend ici. Retirer une administratrice d'une collection se fait en
 * changeant son rôle ; sortir quelqu'un d'un groupe, en le sortant du groupe. Le bouton ne
 * paraît donc que là où il agit.
 */
@Composable
fun EcranDesAcces(
    modele: ModeleDuCoffre,
    collection: CollectionDOrganisation,
    surFermer: () -> Unit,
) {
    EcranGhost(identifiant = "screen.collectionAccess") {
        BarreDeFeuille(
            titre = collection.nom,
            gauche = stringResource(R.string.admin_termine),
            identifiantGauche = "button.closeAccess",
            surGauche = surFermer,
        )

        when (val etat = modele.acces) {
            is ModeleDuCoffre.EtatDesAcces.EnLecture ->
                Attente(stringResource(R.string.acces_lecture))

            is ModeleDuCoffre.EtatDesAcces.Indisponible ->
                Indisponible(etat.cause)

            is ModeleDuCoffre.EtatDesAcces.Lu -> {
                SectionGhost(
                    titre = stringResource(R.string.acces_titre),
                    note = stringResource(R.string.acces_note),
                ) {
                    if (etat.acces.isEmpty()) {
                        Vide(stringResource(R.string.acces_personne), "text.noAccess")
                    } else {
                        Column {
                            etat.acces.forEachIndexed { rang, acces ->
                                if (rang > 0) FiletDeSection()
                                LigneDAcces(acces, modele.occupe) {
                                    modele.retirerLAcces(acces.userId)
                                }
                            }
                        }
                    }
                }
                modele.message?.let { Erreur(it) }
            }
        }
    }
}

@Composable
private fun LigneDAcces(acces: AccesDto, occupe: Boolean, surRetirer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 11.dp)
            .reperes("row.access.${acces.userId}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                acces.email ?: acces.userId,
                color = couleurs.encre,
                fontSize = 15.sp,
                maxLines = 1,
            )
            // La permission **effective** d'abord : c'est la réponse à « que peut cette
            // personne ». Les provenances ensuite, parce qu'elles répondent à « pourquoi »,
            // et que c'est la seconde question qu'on se pose, pas la première.
            Text(
                acces.permission,
                color = couleurs.accentTexte,
                fontSize = 12.sp,
            )
            if (acces.sources.isNotEmpty()) {
                Text(
                    acces.sources.joinToString(" · ") { source ->
                        // Les libellés viennent du serveur, qui les rend déjà en français.
                        // On ne les retraduit pas ici : la liste des provenances n'est pas
                        // fermée — un groupe s'appelle comme on l'a nommé — et bâtir une
                        // table de correspondance sur un ensemble ouvert ferait disparaître
                        // ce qu'elle ne connaît pas.
                        "${source.label} (${source.permission})"
                    },
                    color = couleurs.attenue,
                    fontSize = 11.sp,
                )
            }
        }
        if (acces.revocable) {
            LienDiscret(
                texte = stringResource(R.string.acces_retirer),
                actif = !occupe,
                identifiant = "button.revokeAccess.${acces.userId}",
            ) { surRetirer() }
        }
    }
}

// ─── Les mêmes petites briques, privées à ce fichier ───
//
// Voir la note d'`EcranDAdministration.kt` : le dépôt recopie ces quatre lignes plutôt que
// de les partager, et une fonction de premier niveau privée n'entre en conflit avec aucune
// de ses jumelles.

@Composable
private fun Attente(texte: String) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = couleurs.attenue,
        fontSize = 13.sp,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
    )
}

@Composable
private fun Indisponible(cause: String) {
    val couleurs = LocalCouleurs.current
    Text(
        cause,
        color = couleurs.danger,
        fontSize = 13.sp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 14.dp)
            .reperes("text.accessUnavailable"),
    )
}

@Composable
private fun Vide(texte: String, identifiant: String) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = couleurs.attenue,
        fontSize = 13.sp,
        modifier = Modifier.padding(14.dp).reperes(identifiant),
    )
}

@Composable
private fun Erreur(message: String) {
    val couleurs = LocalCouleurs.current
    Text(
        message,
        color = couleurs.danger,
        fontSize = 12.sp,
        modifier = Modifier.padding(horizontal = 20.dp).reperes("text.accessError"),
    )
}
