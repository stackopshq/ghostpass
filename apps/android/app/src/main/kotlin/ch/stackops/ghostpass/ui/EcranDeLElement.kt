package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.CarteBancaire
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.ElementDuCoffre
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.Identifiants
import ch.stackops.ghostpass.LienOtpauth
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.Note
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IntituleDeSection
import androidx.activity.compose.BackHandler
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.carteDeVerre

/**
 * Créer ou modifier un élément.
 *
 * Sans cet écran, le coffre est en lecture seule — ce qui n'est pas un gestionnaire de mots
 * de passe. C'est aussi le préalable aux liens `otpauth:` (§9) : un `intent-filter` déclaré
 * sans écran capable d'afficher ce qu'il reçoit ferait promettre au système une capacité
 * qu'on ne tient pas, ce qui coûte plus qu'une capacité absente.
 *
 * ## `null` et `""` ne se confondent pas, y compris ici
 *
 * Un champ de texte ne sait pas dire « absent » : vide et absent y ont la même apparence.
 * La règle appliquée est donc explicite — **un champ vide reste `null` s'il l'était, et
 * devient `""` s'il portait quelque chose**. Sans elle, ouvrir puis refermer un élément sans
 * rien changer transformerait ses `null` en `""` : une modification que personne n'a
 * demandée, invisible ici, et visible chez le client suivant qui distingue les deux (§5).
 */
@Composable
fun EcranDeLElement(
    modele: ModeleDuCoffre,
    entree: EntreeDuCoffre.Lisible?,
    lien: String? = null,
    cle: String = entree?.id ?: lien ?: "nouveau",
    lectureSeule: Boolean = false,
    surFin: () -> Unit,
) {
    // `key` enferme tout l'état de ce formulaire dans l'identité de ce qu'on édite. Deux
    // liens reçus coup sur coup ouvrent alors deux formulaires ; sans lui, le second
    // rouvrirait le premier, pré-rempli avec les valeurs du premier — et rien ne
    // signalerait l'erreur.
    key(cle) { CorpsDeLElement(modele, entree, lien, lectureSeule, surFin) }
}

@Composable
private fun CorpsDeLElement(
    modele: ModeleDuCoffre,
    entree: EntreeDuCoffre.Lisible?,
    lien: String?,
    lectureSeule: Boolean,
    surFin: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val origine = entree?.element

    // Ce que le lien pré-remplit. **Il ne crée rien** : c'est la deuxième règle du §9. Une
    // URL venue du dehors qui écrirait seule serait un moyen d'ajouter des lignes dans le
    // coffre de quelqu'un d'autre — il suffirait de lui faire ouvrir un lien.
    val etiquette = lien?.let { LienOtpauth.etiquette(it) }

    var nom by rememberSaveable { mutableStateOf(origine?.name ?: etiquette?.service ?: "") }
    var notes by rememberSaveable { mutableStateOf(origine?.notes ?: "") }
    var dossier by rememberSaveable { mutableStateOf(origine?.folder ?: "") }

    // Le genre se choisit à la création et **ne se change plus** ensuite. Changer le genre
    // d'un élément existant reviendrait à jeter son contenu sans le dire : les champs d'une
    // carte n'ont aucun équivalent dans une connexion.
    var genre by rememberSaveable {
        mutableStateOf(
            when (origine?.data) {
                is ContenuDElement.NoteSecrete -> "note"
                is ContenuDElement.Carte -> "carte"
                else -> "connexion"
            },
        )
    }

    val connexion = origine?.data as? ContenuDElement.Connexion
    var identifiant by rememberSaveable {
        mutableStateOf(connexion?.valeur?.username ?: etiquette?.compte ?: "")
    }
    var motDePasse by rememberSaveable { mutableStateOf(connexion?.valeur?.password ?: "") }
    var adresses by rememberSaveable {
        mutableStateOf(connexion?.valeur?.uris?.joinToString("\n") ?: "")
    }
    // Le lien **entier**, pas seulement son secret : il porte aussi la période, le nombre
    // de chiffres et l'algorithme. N'en garder que le secret perdrait ces trois-là en
    // silence, et les codes seraient faux chez un service qui ne prend pas les défauts.
    var totp by rememberSaveable { mutableStateOf(connexion?.valeur?.totp ?: lien ?: "") }

    val note = origine?.data as? ContenuDElement.NoteSecrete
    var contenu by rememberSaveable { mutableStateOf(note?.valeur?.content ?: "") }

    val carte = origine?.data as? ContenuDElement.Carte
    var porteur by rememberSaveable { mutableStateOf(carte?.valeur?.cardholder ?: "") }
    var numero by rememberSaveable { mutableStateOf(carte?.valeur?.number ?: "") }
    var mois by rememberSaveable { mutableStateOf(carte?.valeur?.expMonth ?: "") }
    var annee by rememberSaveable { mutableStateOf(carte?.valeur?.expYear ?: "") }
    var code by rememberSaveable { mutableStateOf(carte?.valeur?.code ?: "") }

    var confirmeLaSuppression by rememberSaveable { mutableStateOf(false) }

    // Le générateur est posé **par-dessus** le formulaire, et non à côté : il recouvre
    // l'écran le temps qu'on choisisse, puis rend la main. C'est la feuille modale d'iOS,
    // dont le retour arrière est le seul autre moyen de sortir.
    var genereUnMotDePasse by rememberSaveable { mutableStateOf(false) }
    if (genereUnMotDePasse) {
        BackHandler { genereUnMotDePasse = false }
        EcranDuGenerateur(
            surAnnuler = { genereUnMotDePasse = false },
            surUtiliser = { propose ->
                motDePasse = propose
                genereUnMotDePasse = false
            },
        )
        return
    }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier
                    .widthIn(max = GP.largeurMax)
                    // **96 dp de marge en bas**, et ce n'est pas de l'esthétique. Le dernier
                    // contrôle du formulaire — « Annuler » — tombait sinon dans la bande que
                    // la navigation par gestes se réserve : le système avale le toucher, et
                    // le bouton paraît simplement ne rien faire. Un doigt humain a le même
                    // problème, et personne ne pense à faire défiler un écran qui semble
                    // déjà entier.
                    .padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(
                    stringResource(
                        if (entree == null) R.string.element_titre_nouveau
                        else R.string.element_titre_modifier,
                    ),
                    color = couleurs.encre,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                )

                Column(
                    Modifier.fillMaxWidth().carteDeVerre(),
                    verticalArrangement = Arrangement.spacedBy(GP.ecartChamps),
                ) {
                    if (entree == null) {
                        Column(verticalArrangement = Arrangement.spacedBy(GP.ecartLibelle)) {
                            IntituleDeSection(stringResource(R.string.element_genre))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                // La gauche du couple est la valeur retenue dans l'état, la
                                // droite ce qui s'affiche : seule la seconde se traduit.
                                for ((cle, libelle) in listOf(
                                    "connexion" to stringResource(R.string.element_genre_connexion),
                                    "note" to stringResource(R.string.element_genre_note),
                                    "carte" to stringResource(R.string.element_genre_carte),
                                )) {
                                    Box(Modifier.weight(1f)) {
                                        if (genre == cle) {
                                            BoutonPrincipal(libelle, actif = true) { genre = cle }
                                        } else {
                                            BoutonSecondaire(libelle) { genre = cle }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    ChampGhost(
                        intitule = stringResource(R.string.element_nom),
                        valeur = nom,
                        // Un nom de produit, qui s'écrit pareil dans toutes les langues.
                        invite = "Forgejo",
                        identifiant = "field.name",
                        onChange = { nom = it },
                    )

                    when (genre) {
                        "connexion" -> {
                            ChampGhost(
                                intitule = stringResource(R.string.element_identifiant),
                                valeur = identifiant,
                                invite = stringResource(R.string.element_invite_identifiant),
                                identifiant = "field.username",
                                onChange = { identifiant = it },
                            )
                            ChampGhost(
                                intitule = stringResource(R.string.element_mot_de_passe),
                                valeur = motDePasse,
                                invite = "•••••••••",
                                identifiant = "field.password",
                                secret = true,
                                typeDeClavier = KeyboardType.Password,
                                onChange = { motDePasse = it },
                            )
                            // Sous le champ, et **seulement** sous le champ « mot de passe » :
                            // c'est là qu'on se demande quoi mettre. Le placer dans un menu
                            // d'écran obligerait à savoir qu'il existe avant d'en avoir
                            // besoin. iOS le présente au même endroit.
                            LienDiscret(
                                texte = stringResource(R.string.element_generer_un_mot_de_passe),
                                identifiant = "button.openGenerator",
                            ) { genereUnMotDePasse = true }
                            ChampGhost(
                                intitule = stringResource(R.string.element_adresses),
                                valeur = adresses,
                                // Le domaine réservé aux exemples (RFC 2606), et **pas**
                                // celui de l'éditeur. Le premier jet écrivait ici
                                // « https://git.stackops.ch », par mimétisme avec les jeux
                                // d'essai — et `tools/android/verifier-l-autonomie.sh` l'a
                                // trouvé dans le paquet construit. Une invite est du texte
                                // livré comme un autre : §7 s'y applique.
                                invite = "https://exemple.example.com",
                                identifiant = "field.uris",
                                typeDeClavier = KeyboardType.Uri,
                                onChange = { adresses = it },
                            )
                            ChampGhost(
                                intitule = stringResource(R.string.element_totp),
                                valeur = totp,
                                // Un schéma d'URL : il ne se traduit pas (§7 des conventions).
                                invite = "otpauth://totp/…",
                                identifiant = "field.totp",
                                onChange = { totp = it },
                            )
                        }
                        "note" -> ChampGhost(
                            intitule = stringResource(R.string.element_contenu),
                            valeur = contenu,
                            invite = stringResource(R.string.element_invite_contenu),
                            identifiant = "field.content",
                            onChange = { contenu = it },
                        )
                        "carte" -> {
                            ChampGhost(
                                intitule = stringResource(R.string.element_titulaire),
                                valeur = porteur,
                                // Un nom propre : il s'écrit de la même façon partout.
                                invite = "Jean Dupont",
                                identifiant = "field.cardholder",
                                onChange = { porteur = it },
                            )
                            ChampGhost(
                                intitule = stringResource(R.string.element_numero),
                                valeur = numero,
                                invite = "4111 1111 1111 1111",
                                identifiant = "field.number",
                                typeDeClavier = KeyboardType.NumberPassword,
                                onChange = { numero = it },
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f)) {
                                    ChampGhost(
                                        intitule = stringResource(R.string.element_mois),
                                        valeur = mois,
                                        invite = "12",
                                        identifiant = "field.expMonth",
                                        typeDeClavier = KeyboardType.Number,
                                        onChange = { mois = it },
                                    )
                                }
                                Box(Modifier.weight(1f)) {
                                    ChampGhost(
                                        intitule = stringResource(R.string.element_annee),
                                        valeur = annee,
                                        invite = "2030",
                                        identifiant = "field.expYear",
                                        typeDeClavier = KeyboardType.Number,
                                        onChange = { annee = it },
                                    )
                                }
                            }
                            ChampGhost(
                                intitule = stringResource(R.string.element_code),
                                valeur = code,
                                invite = "•••",
                                identifiant = "field.code",
                                secret = true,
                                typeDeClavier = KeyboardType.NumberPassword,
                                onChange = { code = it },
                            )
                        }
                    }

                    ChampGhost(
                        intitule = stringResource(R.string.element_dossier),
                        valeur = dossier,
                        invite = stringResource(R.string.element_invite_dossier),
                        identifiant = "field.folder",
                        onChange = { dossier = it },
                    )
                    ChampGhost(
                        intitule = stringResource(R.string.element_notes),
                        valeur = notes,
                        invite = stringResource(R.string.element_invite_notes),
                        identifiant = "field.notes",
                        onChange = { notes = it },
                    )

                    modele.message?.let {
                        Text(it, color = couleurs.danger, fontSize = 13.sp)
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        // En lecture seule, **aucun bouton d'enregistrement**. Le proposer
                        // puis échouer serait déjà mauvais ; le proposer et réussir au
                        // mauvais endroit — dans le coffre personnel — serait pire : l'élément
                        // disparaîtrait pour toute l'équipe.
                        if (lectureSeule) {
                            Text(
                                stringResource(R.string.element_lecture_seule),
                                color = couleurs.attenue,
                                fontSize = 12.sp,
                            )
                        }
                        if (!lectureSeule) BoutonPrincipal(
                            texte = stringResource(R.string.element_enregistrer),
                            actif = !modele.occupe && nom.isNotBlank(),
                            occupe = modele.occupe,
                            identifiant = "button.save",
                        ) {
                            val element = ElementDuCoffre(
                                name = nom,
                                // « Vide » reste « absent » si ce l'était : voir l'en-tête.
                                notes = conserverLAbsence(notes, origine?.notes),
                                folder = conserverLAbsence(dossier, origine?.folder),
                                data = when (genre) {
                                    "note" -> ContenuDElement.NoteSecrete(Note(contenu))
                                    "carte" -> ContenuDElement.Carte(
                                        CarteBancaire(porteur, numero, mois, annee, code))
                                    else -> ContenuDElement.Connexion(
                                        Identifiants(
                                            username = identifiant,
                                            password = motDePasse,
                                            uris = adresses.lines()
                                                .map { it.trim() }
                                                .filter { it.isNotEmpty() },
                                            totp = conserverLAbsence(
                                                totp, connexion?.valeur?.totp),
                                            passwordHistory = historique(
                                                connexion?.valeur, motDePasse),
                                        ),
                                    )
                                },
                            )
                            modele.enregistrerUnElement(entree, element) { fait ->
                                if (fait) surFin()
                            }
                        }

                        if (entree != null && !lectureSeule) {
                            BoutonSecondaire(
                                // Le libellé dit **ce qui va se passer**, et ce n'est pas la
                                // même chose des deux côtés : le coffre personnel range à la
                                // corbeille, une collection d'équipe efface. Le même mot pour
                                // les deux ferait croire à un filet qui n'existe pas.
                                texte = stringResource(
                                    when {
                                        confirmeLaSuppression && modele.collectionOuverte != null ->
                                            R.string.element_confirmer_suppression_definitive
                                        confirmeLaSuppression ->
                                            R.string.element_confirmer_suppression
                                        modele.collectionOuverte != null ->
                                            R.string.element_supprimer_definitivement
                                        else -> R.string.element_mettre_a_la_corbeille
                                    },
                                ),
                                actif = !modele.occupe,
                                destructif = true,
                                identifiant = "button.delete",
                            ) {
                                // Deux temps, sans boîte de dialogue : la première pression
                                // change le libellé. Une suppression immédiate d'un mot de
                                // passe qu'on est seul à détenir est irrattrapable côté
                                // utilisateur, même si le serveur garde une corbeille.
                                if (!confirmeLaSuppression) {
                                    confirmeLaSuppression = true
                                } else {
                                    modele.supprimerUnElement(entree) { fait ->
                                        if (fait) surFin()
                                    }
                                }
                            }
                        }

                        // Le partage ne s'offre que sur un élément **existant** : il n'y a
                        // rien à partager d'un formulaire qu'on n'a pas encore enregistré,
                        // et le proposer laisserait croire que le secret saisi part déjà.
                        if (entree != null) PanneauDePartage(modele, entree)

                        LienDiscret(
                            stringResource(R.string.element_annuler),
                            identifiant = "button.cancel",
                        ) {
                            modele.message = null
                            surFin()
                        }
                    }
                }
            }
        }
    }
}

/**
 * Un champ vidé garde son absence : `null` s'il était `null`, `""` s'il portait quelque chose.
 *
 * C'est la seule règle qui préserve la distinction §5 à travers un champ de texte, lequel
 * n'a aucun moyen de représenter « absent ». Sans elle, ouvrir puis enregistrer sans rien
 * changer réécrirait tous les `null` en `""`.
 */
private fun conserverLAbsence(saisi: String, origine: String?): String? =
    if (saisi.isEmpty() && origine == null) null else saisi

/**
 * L'historique des mots de passe : on **empile**, on ne remplace jamais.
 *
 * Le champ existe pour retrouver l'accès à un service qui n'a pas pris le nouveau mot de
 * passe. Le laisser vide à chaque modification le viderait sans un mot, et personne ne s'en
 * apercevrait avant d'en avoir besoin. Plus récent en tête, comme le dit [Identifiants].
 */
private fun historique(origine: Identifiants?, nouveau: String): List<String> {
    if (origine == null) return emptyList()
    if (origine.password == nouveau || origine.password.isEmpty()) return origine.passwordHistory
    return listOf(origine.password) + origine.passwordHistory
}

/**
 * Le partage d'un secret par lien éphémère (§4).
 *
 * Deux réglages, et ce sont ceux d'iOS : une durée et un nombre de consultations. Le second
 * est le plus utile et le moins connu — un lien qui s'efface après une lecture rend inutile
 * de faire confiance au canal par lequel il a voyagé.
 *
 * Ce panneau ne montre **jamais** le lien : il déclenche la création, et c'est
 * `BoitesDePartage` qui affiche soit la confirmation de destination, soit le lien. L'ordre
 * est le point : la destination se confirme avant que la clé ne soit remise.
 */
@Composable
private fun PanneauDePartage(modele: ModeleDuCoffre, entree: EntreeDuCoffre.Lisible) {
    val couleurs = LocalCouleurs.current
    var ouvert by rememberSaveable { mutableStateOf(false) }
    var heures by rememberSaveable { mutableStateOf("24") }
    var consultations by rememberSaveable { mutableStateOf("1") }

    // Une carte n'a pas **un** secret : numéro, date et code sont trois champs, et n'en
    // envoyer qu'un donnerait au destinataire quelque chose d'inutilisable en lui laissant
    // croire qu'il a tout. On le dit au lieu de choisir à sa place.
    val partageable = entree.element.data !is ContenuDElement.Carte

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LienDiscret(
            texte = stringResource(
                if (ouvert) R.string.element_masquer_le_partage
                else R.string.element_partager_par_lien,
            ),
            actif = partageable && !modele.occupe,
            identifiant = "button.share",
        ) { ouvert = !ouvert }

        if (!partageable) {
            Text(
                stringResource(R.string.element_carte_non_partageable),
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }

        if (ouvert && partageable) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) {
                    ChampGhost(
                        intitule = stringResource(R.string.element_heures),
                        valeur = heures,
                        invite = "24",
                        identifiant = "field.shareHours",
                        typeDeClavier = KeyboardType.Number,
                        onChange = { heures = it },
                    )
                }
                Box(Modifier.weight(1f)) {
                    ChampGhost(
                        intitule = stringResource(R.string.element_consultations),
                        valeur = consultations,
                        invite = "1",
                        identifiant = "field.shareViews",
                        typeDeClavier = KeyboardType.Number,
                        onChange = { consultations = it },
                    )
                }
            }
            BoutonSecondaire(
                texte = stringResource(R.string.element_creer_le_lien),
                actif = !modele.occupe,
                identifiant = "button.createShare",
            ) {
                // Les bornes du serveur : 1 à 720 heures, 0 à 100 consultations. Les
                // appliquer ici évite un aller-retour qui rendrait « requête invalide »,
                // message qui n'apprend rien à qui a tapé « 0 ».
                modele.partager(
                    entree,
                    heures = heures.toIntOrNull()?.coerceIn(1, 720) ?: 24,
                    consultations = consultations.toIntOrNull()?.coerceIn(0, 100) ?: 1,
                )
            }
        }
    }
}
