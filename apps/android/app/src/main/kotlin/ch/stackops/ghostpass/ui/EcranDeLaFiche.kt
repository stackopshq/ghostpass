package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.CarteBancaire
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.Identifiants
import ch.stackops.ghostpass.PressePapiers
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.Totp
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.reperes
import kotlinx.coroutines.delay

/**
 * La fiche d'un élément, **en lecture** : chaque champ se copie, le code TOTP s'affiche.
 *
 * Portée de `apps/ios/Ghostpass/Views/ItemDetailView.swift`. Jusqu'au 2026-11-13, toucher
 * un élément ouvrait directement son formulaire de modification : aucun champ ne se
 * copiait, et le code TOTP — dont le secret était pourtant là — ne se calculait nulle part.
 * Celui qui avait rangé son second facteur dans GhostPass ne pouvait pas le lire.
 *
 * La modification reste à un geste, par « Modifier », et c'est là que vivent le partage,
 * le déplacement vers une équipe et la suppression. Elle n'est pas offerte en lecture
 * seule : un bouton qui mène à un formulaire qu'on ne pourra pas enregistrer se lit comme
 * une panne.
 */
@Composable
fun EcranDeLaFiche(
    entree: EntreeDuCoffre.Lisible,
    lectureSeule: Boolean,
    surModifier: () -> Unit,
    surFermer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    val element = entree.element
    var copie by remember { mutableStateOf<String?>(null) }

    // Ce que la copie vient de faire, et quand cela cessera : la même phrase qu'iOS. Elle
    // s'efface d'elle-même, sans quoi elle resterait affirmer une copie déjà effacée.
    LaunchedEffect(copie) {
        if (copie != null) {
            delay(4_000)
            copie = null
        }
    }
    val copier: (String, String) -> Unit = { valeur, libelle ->
        PressePapiers.copier(contexte, valeur)
        copie = libelle
    }

    EcranGhost(identifiant = "screen.itemDetail") {
        BarreDeFeuille(
            titre = element.name,
            gauche = stringResource(R.string.fiche_fermer),
            identifiantGauche = "button.closeDetail",
            surGauche = surFermer,
            droite = if (lectureSeule) null else stringResource(R.string.fiche_modifier),
            identifiantDroite = "button.edit",
            surDroite = surModifier,
        )

        copie?.let { libelle ->
            Text(
                stringResource(R.string.fiche_copie, libelle, PressePapiers.DUREE_S),
                color = couleurs.accentTexte,
                fontSize = 13.sp,
                modifier = Modifier.reperes("text.copied"),
            )
        }

        when (val d = element.data) {
            is ContenuDElement.Connexion -> SectionsDIdentifiants(d.valeur, copier)
            is ContenuDElement.NoteSecrete -> SectionGhost(
                titre = stringResource(R.string.fiche_note),
            ) {
                Texte(d.valeur.content)
            }
            is ContenuDElement.Carte -> SectionDeCarte(d.valeur, copier)
        }

        element.folder?.takeIf { it.isNotBlank() }?.let { dossier ->
            SectionGhost(titre = stringResource(R.string.fiche_dossier)) { Texte(dossier) }
        }

        element.notes?.takeIf { it.isNotBlank() }?.let { notes ->
            SectionGhost(titre = stringResource(R.string.fiche_notes)) { Texte(notes) }
        }

        (element.data as? ContenuDElement.Connexion)?.valeur?.passwordHistory
            ?.takeIf { it.isNotEmpty() }
            ?.let { anciens -> AnciensMotsDePasse(anciens, copier) }
    }
}

@Composable
private fun SectionsDIdentifiants(
    identifiants: Identifiants,
    copier: (String, String) -> Unit,
) {
    var revele by rememberSaveable { mutableStateOf(false) }
    val copieNom = stringResource(R.string.fiche_copie_nom)
    val copieMotDePasse = stringResource(R.string.fiche_copie_mot_de_passe)
    val copieAdresse = stringResource(R.string.fiche_copie_adresse)

    SectionGhost(titre = stringResource(R.string.fiche_identifiants)) {
        Column {
            Ligne(
                intitule = stringResource(R.string.fiche_nom_utilisateur),
                valeur = identifiants.username,
                identifiant = "row.username",
            ) {
                if (identifiants.username.isNotEmpty()) {
                    Action(stringResource(R.string.fiche_copier), "button.copyUsername") {
                        copier(identifiants.username, copieNom)
                    }
                }
            }
            FiletDeSection()
            Ligne(
                intitule = stringResource(R.string.fiche_mot_de_passe),
                valeur = if (revele) identifiants.password else "••••••••",
                monospace = revele,
                identifiant = "row.password",
            ) {
                if (identifiants.password.isNotEmpty()) {
                    Action(
                        stringResource(if (revele) R.string.fiche_masquer else R.string.fiche_afficher),
                        "button.reveal",
                    ) { revele = !revele }
                    Action(stringResource(R.string.fiche_copier), "button.copyPassword") {
                        copier(identifiants.password, copieMotDePasse)
                    }
                }
            }
        }
    }

    identifiants.totp?.takeIf { it.isNotBlank() }?.let { champ -> SectionDuCode(champ, copier) }

    if (identifiants.uris.isNotEmpty()) {
        SectionGhost(titre = stringResource(R.string.fiche_adresses)) {
            Column {
                identifiants.uris.forEachIndexed { rang, adresse ->
                    if (rang > 0) FiletDeSection()
                    Ligne(intitule = null, valeur = adresse, identifiant = "row.uri.$rang") {
                        Action(stringResource(R.string.fiche_copier), "button.copyUri.$rang") {
                            copier(adresse, copieAdresse)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Le code TOTP, recalculé chaque seconde.
 *
 * Une boucle attachée à la composition, et non une minuterie : elle s'arrête d'elle-même
 * quand la fiche se referme — le pendant du `TimelineView` d'iOS. Le code se recalcule
 * à chaque tour plutôt qu'au changement de période : une horloge qu'on règle pendant que
 * la fiche est ouverte ne doit pas laisser un code périmé à l'écran.
 */
@Composable
private fun SectionDuCode(champ: String, copier: (String, String) -> Unit) {
    val couleurs = LocalCouleurs.current
    var maintenant by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(champ) {
        while (true) {
            maintenant = System.currentTimeMillis()
            delay(1_000 - maintenant % 1_000)
        }
    }
    val code = Totp.codeCourant(champ, maintenant)
    val copieCode = stringResource(R.string.fiche_copie_code)

    SectionGhost(titre = stringResource(R.string.fiche_code)) {
        if (code == null) {
            Text(
                stringResource(R.string.fiche_code_illisible),
                color = couleurs.danger,
                fontSize = 13.sp,
                modifier = Modifier.padding(14.dp).reperes("text.totpUnreadable"),
            )
        } else {
            Row(
                Modifier.fillMaxWidth().padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        // Groupé par trois, comme les applications d'authentification : un
                        // code de six chiffres se lit en deux temps, pas en un.
                        code.code.chunked(3).joinToString(" "),
                        color = couleurs.encre,
                        fontSize = 26.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.reperes("text.totpCode"),
                    )
                    Text(
                        stringResource(R.string.fiche_code_restant, code.restant),
                        color = if (code.restant <= 5) couleurs.danger else couleurs.attenue,
                        fontSize = 12.sp,
                    )
                }
                Action(stringResource(R.string.fiche_copier), "button.copyTotp") {
                    copier(code.code, copieCode)
                }
            }
        }
    }
}

@Composable
private fun SectionDeCarte(carte: CarteBancaire, copier: (String, String) -> Unit) {
    var revele by rememberSaveable { mutableStateOf(false) }
    val copieTitulaire = stringResource(R.string.fiche_copie_titulaire)
    val copieNumero = stringResource(R.string.fiche_copie_numero)

    SectionGhost(titre = stringResource(R.string.fiche_carte)) {
        Column {
            Ligne(stringResource(R.string.fiche_titulaire), carte.cardholder, "row.cardholder") {
                if (carte.cardholder.isNotEmpty()) {
                    Action(stringResource(R.string.fiche_copier), "button.copyCardholder") {
                        copier(carte.cardholder, copieTitulaire)
                    }
                }
            }
            FiletDeSection()
            Ligne(
                intitule = stringResource(R.string.fiche_numero),
                // Les quatre derniers chiffres restent lisibles : c'est ce qui dit de
                // quelle carte il s'agit, sans rien livrer d'utile à qui regarde l'écran.
                valeur = if (revele) carte.number else "•••• " + carte.number.takeLast(4),
                monospace = true,
                identifiant = "row.cardNumber",
            ) {
                if (carte.number.isNotEmpty()) {
                    Action(
                        stringResource(if (revele) R.string.fiche_masquer else R.string.fiche_afficher),
                        "button.revealCard",
                    ) { revele = !revele }
                    Action(stringResource(R.string.fiche_copier), "button.copyCardNumber") {
                        copier(carte.number, copieNumero)
                    }
                }
            }
            FiletDeSection()
            Ligne(
                stringResource(R.string.fiche_expiration),
                listOf(carte.expMonth, carte.expYear).filter { it.isNotEmpty() }.joinToString("/"),
                "row.cardExpiry",
            ) {}
            if (carte.code.isNotEmpty()) {
                FiletDeSection()
                Ligne(
                    stringResource(R.string.fiche_cryptogramme),
                    if (revele) carte.code else "•••",
                    "row.cardCode",
                    monospace = revele,
                ) {}
            }
        }
    }
}

@Composable
private fun AnciensMotsDePasse(anciens: List<String>, copier: (String, String) -> Unit) {
    var ouvert by rememberSaveable { mutableStateOf(false) }
    val copieAncien = stringResource(R.string.fiche_copie_ancien)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LienDiscret(
            texte = pluralStringResource(R.plurals.fiche_anciens, anciens.size, anciens.size),
            identifiant = "button.passwordHistory",
        ) { ouvert = !ouvert }
        if (ouvert) {
            SectionGhost {
                Column {
                    anciens.forEachIndexed { rang, ancien ->
                        if (rang > 0) FiletDeSection()
                        Ligne(null, ancien, "row.oldPassword.$rang", monospace = true) {
                            Action(stringResource(R.string.fiche_copier), "button.copyOld.$rang") {
                                copier(ancien, copieAncien)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Ligne(
    intitule: String?,
    valeur: String,
    identifiant: String,
    monospace: Boolean = false,
    actions: @Composable () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(14.dp).reperes(identifiant),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            if (intitule != null) Text(intitule, color = couleurs.attenue, fontSize = 12.sp)
            Text(
                valeur,
                color = couleurs.encre,
                fontSize = 15.sp,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
            )
        }
        actions()
    }
}

@Composable
private fun Action(texte: String, identifiant: String, surClic: () -> Unit) {
    LienDiscret(texte = texte, identifiant = identifiant, onClick = surClic)
}

@Composable
private fun Texte(texte: String) {
    val couleurs = LocalCouleurs.current
    Text(texte, color = couleurs.encre, fontSize = 15.sp, modifier = Modifier.padding(14.dp))
}
