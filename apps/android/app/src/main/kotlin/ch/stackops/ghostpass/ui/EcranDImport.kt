package ch.stackops.ghostpass.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import ch.stackops.ghostpass.ElementDuCoffre
import ch.stackops.ghostpass.ImportCsv
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * Import d'un CSV exporté par un autre gestionnaire de mots de passe.
 *
 * **Deux temps** : on lit le fichier et on montre ce qu'on y a trouvé, puis on dépose. Un
 * import qui part sans rien montrer est un import qu'on n'ose pas lancer — et celui-ci écrit
 * dans le coffre, ce qui ne se défait qu'entrée par entrée.
 *
 * Porté de `apps/ios/Ghostpass/Views/ImportView.swift`, avec le sélecteur de fichiers
 * d'Android (`ACTION_OPEN_DOCUMENT`) à la place de `fileImporter`.
 */
@Composable
fun EcranDImport(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    val contexte = LocalContext.current
    val couleurs = LocalCouleurs.current
    var trouves by remember { mutableStateOf<List<ElementDuCoffre>>(emptyList()) }
    var nomDuFichier by remember { mutableStateOf("") }
    var echec by remember { mutableStateOf<String?>(null) }
    var deposes by remember { mutableStateOf<Int?>(null) }

    val selecteur = rememberLauncherForActivityResult(
        // `OpenDocument` et non `GetContent` : lui seul donne un document que l'on peut
        // relire, et surtout un nom de fichier à afficher. `GetContent` rend parfois un
        // flux anonyme, et l'aperçu dirait alors « fichier » sans pouvoir nommer lequel —
        // sur un écran dont tout l'objet est de montrer ce qu'on s'apprête à déposer.
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        echec = null
        if (uri == null) return@rememberLauncherForActivityResult
        val lu = runCatching {
            contexte.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }.getOrNull()
        if (lu == null) {
            echec = contexte.getString(R.string.import_echec_lecture)
            return@rememberLauncherForActivityResult
        }
        val elements = ImportCsv.elements(String(lu, Charsets.UTF_8))
        if (elements.isEmpty()) {
            echec = contexte.getString(R.string.import_aucune_entree)
            return@rememberLauncherForActivityResult
        }
        nomDuFichier = nomLisible(contexte, uri)
        trouves = elements
    }

    EcranGhost(identifiant = "screen.import") {
        BarreDeFeuille(
            titre = stringResource(R.string.import_titre),
            gauche = stringResource(
                if (deposes == null) R.string.import_annuler else R.string.import_termine,
            ),
            identifiantGauche = "button.closeImport",
            surGauche = surFermer,
        )

        when {
            deposes != null -> Resultat(deposes!!, modele.message)
            trouves.isEmpty() -> Presentation(echec, actif = !modele.occupe) {
                // L'exemption de verrouillage est armée **ici**, au lancement du sélecteur,
                // et pas à l'ouverture de cet écran. Voir `ModeleDuCoffre.unSelecteurEstOuvert` :
                // sans elle, le coffre se referme pendant qu'on cherche son fichier, et
                // l'import n'aboutit jamais. Elle est rendue par `ActivitePrincipale.onStart`.
                modele.unSelecteurEstOuvert = true

                // Les trois types MIME, parce qu'un CSV exporté par un navigateur arrive
                // souvent en `text/plain` : filtrer sur le seul `text/csv` grise alors le
                // fichier dans le sélecteur, et **rien à l'écran** ne dit pourquoi. On
                // laisse choisir, et l'analyse dira si ce n'était pas un CSV.
                selecteur.launch(arrayOf("text/csv", "text/comma-separated-values", "text/plain"))
            }
            else -> Apercu(
                trouves = trouves,
                nomDuFichier = nomDuFichier,
                actif = !modele.occupe,
            ) {
                modele.importerDesElements(trouves) { nombre -> deposes = nombre }
            }
        }
    }
}

@Composable
private fun Presentation(echec: String?, actif: Boolean, surChoisir: () -> Unit) {
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
                Text("↧", color = couleurs.accentTexte, fontSize = 32.sp)
            }
        }
        Text(
            stringResource(R.string.import_presentation),
            color = couleurs.attenue,
            fontSize = 14.sp,
        )
        Text(
            // Cette phrase n'est pas de la prudence d'usage : un export CSV est un fichier
            // qui contient tous les mots de passe **en clair**, souvent déposé dans le
            // dossier des téléchargements et oublié là.
            stringResource(R.string.import_avertissement),
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
        BoutonPrincipal(
            stringResource(R.string.import_choisir),
            actif = actif,
            identifiant = "button.pickCsv",
        ) {
            surChoisir()
        }
        if (echec != null) {
            Text(
                stringResource(R.string.import_erreur, echec),
                color = couleurs.danger,
                fontSize = 12.sp,
                modifier = Modifier.reperes("text.importError"),
            )
        }
    }
}

@Composable
private fun Apercu(
    trouves: List<ElementDuCoffre>,
    nomDuFichier: String,
    actif: Boolean,
    surImporter: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current

    SectionGhost(
        titre = stringResource(R.string.import_a_importer),
        note = stringResource(R.string.import_a_importer_note),
    ) {
        Column {
            LigneDeValeur(stringResource(R.string.import_fichier), nomDuFichier)
            FiletDeSection()
            LigneDeValeur(
                stringResource(R.string.import_entrees_trouvees),
                contexte.resources.getQuantityString(
                    R.plurals.import_entrees, trouves.size, trouves.size,
                ),
            )
        }
    }

    SectionGhost(titre = stringResource(R.string.import_apercu)) {
        Column {
            // Les premières seulement : une liste de deux cents lignes n'apprendrait rien
            // de plus sur la bonne lecture des colonnes, qui est la seule question ici.
            trouves.take(5).forEachIndexed { rang, element ->
                if (rang > 0) FiletDeSection()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 11.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(30.dp)
                            .background(
                                couleurs.accent.copy(alpha = 0.14f),
                                RoundedCornerShape(8.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("🔑", fontSize = 13.sp)
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(element.name, color = couleurs.encre, fontSize = 15.sp, maxLines = 1)
                        val compte = element.identifiants?.username.orEmpty()
                        if (compte.isNotEmpty()) {
                            Text(compte, color = couleurs.attenue, fontSize = 12.sp, maxLines = 1)
                        }
                    }
                }
            }
            if (trouves.size > 5) {
                FiletDeSection()
                val autres = trouves.size - 5
                Text(
                    contexte.resources.getQuantityString(
                        R.plurals.import_et_autres, autres, autres,
                    ),
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(14.dp),
                )
            }
        }
    }

    BoutonPrincipal(
        texte = contexte.resources.getQuantityString(
            R.plurals.import_bouton, trouves.size, trouves.size,
        ),
        actif = actif,
        identifiant = "button.confirmImport",
    ) { surImporter() }
}

@Composable
private fun Resultat(nombre: Int, message: String?) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            // Le « ✓ » vit dans la ressource plutôt que devant elle : une langue qui pose
            // sa ponctuation autrement doit pouvoir déplacer la marque avec la phrase.
            stringResource(
                R.string.import_resultat,
                contexte.resources.getQuantityString(
                    R.plurals.import_importees, nombre, nombre,
                ),
            ),
            color = couleurs.encre,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.imported"),
        )
        // **Le message d'erreur reste visible même quand le compte est bon.** Un import de
        // deux cents lignes dont trois ont échoué affiche « 197 entrées importées » : sans
        // cette ligne, les trois manquantes n'auraient laissé aucune trace.
        if (message != null) {
            Text(message, color = couleurs.danger, fontSize = 12.sp)
        }
        Text(
            stringResource(R.string.import_penser_a_effacer),
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun LigneDeValeur(intitule: String, valeur: String) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(intitule, color = couleurs.encre, fontSize = 15.sp)
        Box(Modifier.weight(1f))
        Text(valeur, color = couleurs.attenue, fontSize = 14.sp, maxLines = 1)
    }
}

/**
 * Le nom du fichier choisi, tel qu'il s'affiche.
 *
 * Une `content://` n'a pas de nom de fichier : son dernier segment est un identifiant du
 * fournisseur de documents, du genre « msf:1000000042 ». L'afficher tel quel ne dirait rien
 * de ce qu'on s'apprête à importer — sur un écran dont c'est précisément l'objet. On
 * interroge donc le fournisseur pour son `DISPLAY_NAME`, et on ne retombe sur le segment
 * que s'il ne répond pas.
 */
private fun nomLisible(contexte: android.content.Context, uri: Uri): String {
    val nom = runCatching {
        contexte.contentResolver.query(uri, null, null, null, null)?.use { curseur ->
            val colonne = curseur.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (colonne >= 0 && curseur.moveToFirst()) curseur.getString(colonne) else null
        }
    }.getOrNull()
    return nom ?: uri.lastPathSegment ?: contexte.getString(R.string.import_nom_par_defaut)
}
