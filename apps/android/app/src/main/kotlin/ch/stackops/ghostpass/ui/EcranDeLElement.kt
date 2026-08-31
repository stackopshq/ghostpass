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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.CarteBancaire
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.ElementDuCoffre
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.Identifiants
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.Note
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IntituleDeSection
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
    surFin: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val origine = entree?.element

    var nom by rememberSaveable { mutableStateOf(origine?.name ?: "") }
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
    var identifiant by rememberSaveable { mutableStateOf(connexion?.valeur?.username ?: "") }
    var motDePasse by rememberSaveable { mutableStateOf(connexion?.valeur?.password ?: "") }
    var adresses by rememberSaveable {
        mutableStateOf(connexion?.valeur?.uris?.joinToString("\n") ?: "")
    }
    var totp by rememberSaveable { mutableStateOf(connexion?.valeur?.totp ?: "") }

    val note = origine?.data as? ContenuDElement.NoteSecrete
    var contenu by rememberSaveable { mutableStateOf(note?.valeur?.content ?: "") }

    val carte = origine?.data as? ContenuDElement.Carte
    var porteur by rememberSaveable { mutableStateOf(carte?.valeur?.cardholder ?: "") }
    var numero by rememberSaveable { mutableStateOf(carte?.valeur?.number ?: "") }
    var mois by rememberSaveable { mutableStateOf(carte?.valeur?.expMonth ?: "") }
    var annee by rememberSaveable { mutableStateOf(carte?.valeur?.expYear ?: "") }
    var code by rememberSaveable { mutableStateOf(carte?.valeur?.code ?: "") }

    var confirmeLaSuppression by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = GP.largeurMax).padding(horizontal = 20.dp, vertical = 28.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(
                    if (entree == null) "Nouvel élément" else "Modifier",
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
                            IntituleDeSection("Genre")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for ((cle, libelle) in listOf(
                                    "connexion" to "Connexion",
                                    "note" to "Note",
                                    "carte" to "Carte",
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
                        intitule = "Nom",
                        valeur = nom,
                        invite = "Forgejo",
                        identifiant = "field.name",
                        onChange = { nom = it },
                    )

                    when (genre) {
                        "connexion" -> {
                            ChampGhost(
                                intitule = "Identifiant",
                                valeur = identifiant,
                                invite = "vous@exemple.ch",
                                identifiant = "field.username",
                                onChange = { identifiant = it },
                            )
                            ChampGhost(
                                intitule = "Mot de passe",
                                valeur = motDePasse,
                                invite = "•••••••••",
                                identifiant = "field.password",
                                secret = true,
                                typeDeClavier = KeyboardType.Password,
                                onChange = { motDePasse = it },
                            )
                            ChampGhost(
                                intitule = "Adresses (une par ligne)",
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
                                intitule = "Clé de second facteur",
                                valeur = totp,
                                invite = "otpauth://totp/…",
                                identifiant = "field.totp",
                                onChange = { totp = it },
                            )
                        }
                        "note" -> ChampGhost(
                            intitule = "Contenu",
                            valeur = contenu,
                            invite = "Ce que vous voulez garder",
                            identifiant = "field.content",
                            onChange = { contenu = it },
                        )
                        "carte" -> {
                            ChampGhost(
                                intitule = "Titulaire",
                                valeur = porteur,
                                invite = "Clara Vanacker",
                                identifiant = "field.cardholder",
                                onChange = { porteur = it },
                            )
                            ChampGhost(
                                intitule = "Numéro",
                                valeur = numero,
                                invite = "4111 1111 1111 1111",
                                identifiant = "field.number",
                                typeDeClavier = KeyboardType.NumberPassword,
                                onChange = { numero = it },
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f)) {
                                    ChampGhost(
                                        intitule = "Mois",
                                        valeur = mois,
                                        invite = "12",
                                        identifiant = "field.expMonth",
                                        typeDeClavier = KeyboardType.Number,
                                        onChange = { mois = it },
                                    )
                                }
                                Box(Modifier.weight(1f)) {
                                    ChampGhost(
                                        intitule = "Année",
                                        valeur = annee,
                                        invite = "2030",
                                        identifiant = "field.expYear",
                                        typeDeClavier = KeyboardType.Number,
                                        onChange = { annee = it },
                                    )
                                }
                            }
                            ChampGhost(
                                intitule = "Code",
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
                        intitule = "Dossier",
                        valeur = dossier,
                        invite = "Travail/Serveurs",
                        identifiant = "field.folder",
                        onChange = { dossier = it },
                    )
                    ChampGhost(
                        intitule = "Notes",
                        valeur = notes,
                        invite = "Facultatif",
                        identifiant = "field.notes",
                        onChange = { notes = it },
                    )

                    modele.message?.let {
                        Text(it, color = couleurs.danger, fontSize = 13.sp)
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        BoutonPrincipal(
                            texte = "Enregistrer",
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
                            modele.enregistrerUnElement(entree?.id, element) { fait ->
                                if (fait) surFin()
                            }
                        }

                        if (entree != null) {
                            BoutonSecondaire(
                                texte = if (confirmeLaSuppression) {
                                    "Confirmer la suppression"
                                } else {
                                    "Supprimer"
                                },
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
                                    modele.supprimerUnElement(entree.id) { fait ->
                                        if (fait) surFin()
                                    }
                                }
                            }
                        }

                        LienDiscret("Annuler", identifiant = "button.cancel") {
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
