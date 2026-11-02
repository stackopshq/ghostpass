package ch.stackops.ghostpass.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ExportCsv
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * Export du coffre en CSV.
 *
 * Le fichier produit contient tous les mots de passe **en clair** — c'est ce qu'est un
 * export CSV, et c'est ce qui le rend utile pour partir ailleurs. D'où deux garde-fous,
 * repris d'`ExportView.swift` : le mot de passe maître est redemandé, parce qu'un téléphone
 * déverrouillé posé sur une table ne doit pas suffire à vider le coffre ; et l'écran
 * rappelle d'effacer le fichier ensuite.
 *
 * **Trois temps** : on explique et on demande le mot de passe, le système demande où
 * écrire, on confirme. Le temps du milieu est une activité d'une *autre* application, ce qui
 * a une conséquence sur le verrouillage — voir [ModeleDuCoffre.unSelecteurEstOuvert].
 */
@Composable
fun EcranDExport(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    val contexte = LocalContext.current
    var motDePasse by remember { mutableStateOf("") }
    // `remember` et **jamais `rememberSaveable`** pour ces deux-là. Le second recopie son
    // contenu dans le `Bundle` d'état de l'activité, que le système écrit sur le disque et
    // que les traces de plantage emportent : le coffre entier en clair, mots de passe
    // compris, y serait parti. Un changement de langue ou une rotation perdra donc le
    // formulaire, et c'est le bon compromis — il se retape en deux gestes.
    var csv by remember { mutableStateOf<String?>(null) }
    var echec by remember { mutableStateOf<String?>(null) }
    var ecrit by remember { mutableStateOf(false) }

    val selecteur = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri: Uri? ->
        val contenu = csv
        // Le texte est **oublié dès qu'on sort du sélecteur**, abandon compris. Le garder
        // laisserait le coffre en clair dans la composition jusqu'à la fermeture de l'écran,
        // alors que plus rien n'en a besoin.
        csv = null
        if (uri == null || contenu == null) return@rememberLauncherForActivityResult
        val pose = runCatching {
            contexte.contentResolver.openOutputStream(uri)?.use { flux ->
                flux.write(contenu.toByteArray(Charsets.UTF_8))
            } ?: error("flux indisponible")
        }
        if (pose.isSuccess) {
            ecrit = true
        } else {
            // Le fichier a pu être créé vide par le sélecteur avant l'échec d'écriture. Le
            // dire plutôt que de laisser croire à un export réussi : un CSV de zéro octet
            // ressemble à un coffre vide, et c'est la pire chose à conclure de celui-ci.
            echec = contexte.getString(R.string.export_echec_ecriture)
        }
    }

    EcranGhost(identifiant = "screen.export") {
        BarreDeFeuille(
            titre = stringResource(R.string.export_titre),
            gauche = stringResource(
                if (ecrit) R.string.export_termine else R.string.export_annuler,
            ),
            identifiantGauche = "button.closeExport",
            surGauche = {
                modele.message = null
                surFermer()
            },
        )

        if (ecrit) {
            Resultat()
        } else {
            Formulaire(
                nombre = modele.exportables.size,
                motDePasse = motDePasse,
                erreur = echec ?: modele.message,
                occupe = modele.occupe,
                surMotDePasse = { motDePasse = it; echec = null },
            ) {
                modele.preparerLExport(motDePasse) { texte ->
                    // Le mot de passe est oublié qu'il ait servi ou non : un champ secret
                    // qui garde sa valeur après un refus la garde aussi à l'écran suivant.
                    motDePasse = ""
                    if (texte == null) return@preparerLExport
                    csv = texte
                    // L'exemption de verrouillage est armée **ici**, au lancement du
                    // sélecteur, et pas à l'ouverture de l'écran : voir le commentaire de
                    // `unSelecteurEstOuvert`. Rendue par `ActivitePrincipale.onStart`.
                    modele.unSelecteurEstOuvert = true
                    selecteur.launch(ExportCsv.nomDeFichier())
                }
            }
        }
    }
}

@Composable
private fun Formulaire(
    nombre: Int,
    motDePasse: String,
    erreur: String?,
    occupe: Boolean,
    surMotDePasse: (String) -> Unit,
    surPreparer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(76.dp).background(couleurs.accent.copy(alpha = 0.14f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("↥", color = couleurs.accentTexte, fontSize = 32.sp)
            }
        }
        Text(
            // Le compte vient de ce qui **sortira**, pas de ce que la liste affiche : les
            // éléments d'équipe n'y sont pas, et une ligne qui ne s'est pas ouverte non
            // plus. Annoncer le compte de l'accueil promettrait un fichier plus gros que
            // celui qu'on obtient, et personne ne saurait ce qui manque.
            contexte.resources.getQuantityString(R.plurals.export_presentation, nombre, nombre),
            color = couleurs.attenue,
            fontSize = 14.sp,
        )
        ChampGhost(
            intitule = stringResource(R.string.export_mot_de_passe_maitre),
            valeur = motDePasse,
            invite = stringResource(R.string.export_mot_de_passe_invite),
            identifiant = "field.exportMaster",
            secret = true,
            onChange = surMotDePasse,
        )
        if (erreur != null) {
            Text(
                erreur,
                color = couleurs.danger,
                fontSize = 12.sp,
                modifier = Modifier.reperes("text.exportError"),
            )
        }
        BoutonPrincipal(
            texte = stringResource(R.string.export_preparer),
            // Un coffre personnel vide n'a rien à exporter, et le bouton le dit en restant
            // gris plutôt qu'en écrivant un fichier d'une seule ligne d'en-tête.
            actif = motDePasse.isNotEmpty() && nombre > 0 && !occupe,
            occupe = occupe,
            identifiant = "button.prepareExport",
        ) { surPreparer() }
    }
}

@Composable
private fun Resultat() {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            stringResource(R.string.export_enregistre),
            color = couleurs.encre,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.exported"),
        )
        Text(
            stringResource(R.string.export_penser_a_effacer),
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
    }
}
