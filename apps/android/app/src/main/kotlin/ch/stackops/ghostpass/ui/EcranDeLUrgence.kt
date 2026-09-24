package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.LienDUrgenceDto
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.UrgenceDuCompte
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.IntituleDeSection
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * L'accès d'urgence : confier la lecture de son coffre, et hériter de celui d'un autre.
 *
 * **C'est le seul endroit du produit où la clé d'un coffre est scellée vers un tiers.** Tout
 * le reste est scellé pour soi-même, ou pour une organisation dont on est membre. L'écran
 * est donc bavard là où les autres sont brefs : le rôle est expliqué en toutes lettres avant
 * d'être choisi, et la reprise se confirme deux fois.
 *
 * Deux listes, et il faut les distinguer d'un coup d'œil — **ce que j'ai confié** et **ce
 * qu'on m'a confié** n'appellent pas les mêmes gestes, et les confondre ferait révoquer par
 * erreur l'accès qu'un parent vous a donné.
 *
 * Porté de `EmergencyView`, `EmergencyInviteView`, `EmergencyVaultView` et
 * `EmergencyTakeoverView`.
 */
@Composable
fun EcranDeLUrgence(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    var invitationOuverte by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { modele.lireLesLiensDUrgence() }

    // Le coffre d'un donneur, une fois ouvert, recouvre cet écran : on y lit les
    // identifiants de quelqu'un d'autre, et ce n'est pas une sous-section de la liste.
    val ouvert = modele.coffreDUrgenceOuvert
    if (ouvert != null) {
        EcranDuCoffreDUrgence(modele, ouvert) { modele.fermerLeCoffreDUrgence() }
        return
    }

    if (invitationOuverte) {
        EcranDInvitationDUrgence(modele) { invitationOuverte = false }
        return
    }

    EcranGhost(identifiant = "screen.emergency") {
        BarreDeFeuille(
            titre = "Accès d'urgence",
            gauche = "Terminé",
            identifiantGauche = "button.closeEmergency",
            surGauche = surFermer,
        )

        when (val etat = modele.liensDUrgence) {
            is ModeleDuCoffre.EtatDesUrgences.EnLecture -> Chargement()
            is ModeleDuCoffre.EtatDesUrgences.Indisponible -> Indisponible(etat.cause)
            is ModeleDuCoffre.EtatDesUrgences.Lu -> {
                SectionGhost(
                    titre = "Ce que j'ai confié",
                    note = "Ces personnes pourront accéder à votre coffre après le délai " +
                        "indiqué, si vous ne refusez pas leur demande entre-temps.",
                ) {
                    if (etat.confies.isEmpty()) {
                        Vide("Personne pour l'instant.", "text.noGrantors")
                    } else {
                        Column {
                            etat.confies.forEachIndexed { rang, lien ->
                                if (rang > 0) FiletDeSection()
                                LigneConfiee(lien, modele)
                            }
                        }
                    }
                }

                BoutonPrincipal(
                    "Confier un accès d'urgence",
                    actif = !modele.occupe,
                    identifiant = "button.inviteEmergency",
                ) { invitationOuverte = true }

                SectionGhost(
                    titre = "Ce qu'on m'a confié",
                    note = "Vous pourrez demander l'accès ; il s'ouvrira au bout du délai, " +
                        "sauf refus de la personne concernée.",
                ) {
                    if (etat.recus.isEmpty()) {
                        Vide("Personne ne vous a confié d'accès.", "text.noGrantees")
                    } else {
                        Column {
                            etat.recus.forEachIndexed { rang, lien ->
                                if (rang > 0) FiletDeSection()
                                LigneRecue(lien, modele)
                            }
                        }
                    }
                }

                modele.message?.let { Erreur(it) }
            }
        }
    }
}

/** Une ligne « j'ai confié » : à qui, quel rôle, où en est-on, et de quoi reprendre la main. */
@Composable
private fun LigneConfiee(lien: LienDUrgenceDto, modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current
    val role = UrgenceDuCompte.Role.parCle(lien.role)
    val etat = UrgenceDuCompte.Etat.parCle(lien.status)

    Column(
        Modifier.fillMaxWidth().padding(14.dp).reperes("row.emergency.grantor." + lien.id),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(lien.contactEmail, color = couleurs.encre, fontSize = 15.sp)
        Text(
            // **Un rôle inconnu se dit inconnu.** Le faire passer pour « lecture seule »
            // présenterait comme inoffensif un lien qui permet peut-être la reprise.
            (role?.intitule ?: "Rôle inconnu (${lien.role})") +
                " · " + (etat?.intitule ?: lien.status) +
                " · délai de ${lien.waitDays} j",
            color = if (role == null) couleurs.danger else couleurs.attenue,
            fontSize = 12.sp,
        )

        // Une demande en cours est le moment où il faut agir, et le seul. On le dit avec la
        // date à laquelle l'accès s'ouvrira **si l'on ne fait rien**.
        if (etat == UrgenceDuCompte.Etat.DEMANDE) {
            val quand = UrgenceDuCompte.ouverturePrevue(lien.status, lien.requestedAt, lien.waitDays)
            Text(
                "⚠ Accès demandé" + (quand?.let { " — s'ouvrira le ${UrgenceDuCompte.dateLisible(it)}" } ?: ""),
                color = couleurs.danger,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) {
                    BoutonSecondaire(
                        texte = "Refuser",
                        destructif = true,
                        identifiant = "button.rejectEmergency." + lien.id,
                    ) { modele.agirSurUnLienDUrgence(lien.id, "reject") }
                }
                Box(Modifier.weight(1f)) {
                    BoutonSecondaire(
                        texte = "Accorder maintenant",
                        identifiant = "button.approveEmergency." + lien.id,
                    ) { modele.agirSurUnLienDUrgence(lien.id, "approve") }
                }
            }
        }

        LienDiscret(
            texte = "Retirer cet accès",
            identifiant = "button.revokeEmergency." + lien.id,
        ) { modele.revoquerUnLienDUrgence(lien.id) }
    }
}

/** Une ligne « on m'a confié » : de qui, et ce que je peux en faire maintenant. */
@Composable
private fun LigneRecue(lien: LienDUrgenceDto, modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current
    val role = UrgenceDuCompte.Role.parCle(lien.role)
    val etat = UrgenceDuCompte.Etat.parCle(lien.status)

    Column(
        Modifier.fillMaxWidth().padding(14.dp).reperes("row.emergency.grantee." + lien.id),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(lien.contactEmail, color = couleurs.encre, fontSize = 15.sp)
        Text(
            (role?.intitule ?: "Rôle inconnu (${lien.role})") +
                " · " + (etat?.intitule ?: lien.status) +
                " · délai de ${lien.waitDays} j",
            color = if (role == null) couleurs.danger else couleurs.attenue,
            fontSize = 12.sp,
        )

        when {
            etat == UrgenceDuCompte.Etat.INVITE -> BoutonSecondaire(
                texte = "Accepter",
                identifiant = "button.acceptEmergency." + lien.id,
            ) { modele.agirSurUnLienDUrgence(lien.id, "accept") }

            etat == UrgenceDuCompte.Etat.ACCEPTE -> BoutonSecondaire(
                texte = "Demander l'accès",
                identifiant = "button.requestEmergency." + lien.id,
            ) { modele.agirSurUnLienDUrgence(lien.id, "request") }

            etat == UrgenceDuCompte.Etat.DEMANDE -> {
                val quand = UrgenceDuCompte.ouverturePrevue(lien.status, lien.requestedAt, lien.waitDays)
                Text(
                    "Demande en cours" +
                        (quand?.let { " — accessible le ${UrgenceDuCompte.dateLisible(it)}" } ?: ""),
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                )
                // **`available` vient du serveur**, et le client ne le recalcule pas. Une
                // horloge de téléphone avancée de huit jours ne doit pas ouvrir le coffre de
                // quelqu'un d'autre ; le serveur refusera de toute façon, mais proposer le
                // bouton ferait croire à une panne plutôt qu'à un délai.
                if (lien.available == true) {
                    BoutonSecondaire(
                        texte = "Ouvrir le coffre",
                        identifiant = "button.openEmergencyVault." + lien.id,
                    ) { modele.ouvrirUnCoffreDUrgence(lien.id) }
                }
            }

            etat == UrgenceDuCompte.Etat.OUVERT -> BoutonSecondaire(
                texte = "Ouvrir le coffre",
                identifiant = "button.openEmergencyVault." + lien.id,
            ) { modele.ouvrirUnCoffreDUrgence(lien.id) }
        }

        LienDiscret(
            texte = "Retirer",
            identifiant = "button.dropEmergency." + lien.id,
        ) { modele.revoquerUnLienDUrgence(lien.id) }
    }
}

/**
 * Confier un accès : à qui, quel rôle, et après combien de temps.
 *
 * Le rôle porte son explication **sous** son nom, et non dans une aide qu'on irait chercher :
 * « Reprise du compte » ne dit pas de lui-même qu'il exclut le donneur de son propre coffre.
 */
@Composable
private fun EcranDInvitationDUrgence(modele: ModeleDuCoffre, surFermer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(UrgenceDuCompte.Role.LECTURE) }
    var delai by remember { mutableStateOf("7") }
    var confirme by remember { mutableStateOf(false) }

    val jours = delai.toIntOrNull()
    val pret = email.contains("@") && jours != null && jours in 1..90 && !modele.occupe

    EcranGhost(identifiant = "screen.emergencyInvite") {
        BarreDeFeuille(
            titre = "Confier un accès",
            gauche = "Annuler",
            identifiantGauche = "button.cancelInvite",
            surGauche = {
                modele.message = null
                surFermer()
            },
        )

        SectionGhost(
            note = "Le contact doit déjà avoir un compte sur ce serveur : la clé de votre " +
                "coffre est scellée vers sa clé publique, et il n'y a personne d'autre à qui " +
                "la sceller.",
        ) {
            Box(Modifier.padding(14.dp)) {
                ChampGhost(
                    intitule = "Adresse e-mail du contact",
                    valeur = email,
                    invite = "kevin@exemple.ch",
                    identifiant = "field.emergencyEmail",
                    typeDeClavier = KeyboardType.Email,
                    onChange = { email = it; confirme = false },
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            IntituleDeSection("Rôle")
            for (cas in UrgenceDuCompte.Role.entries) {
                CarteDeRole(cas, choisie = role == cas) { role = cas; confirme = false }
            }
        }

        SectionGhost(
            note = "Entre 1 et 90 jours. Pendant ce délai, vous recevez la demande et pouvez " +
                "la refuser — c'est la seule protection contre une demande que vous n'auriez " +
                "pas voulue.",
        ) {
            Box(Modifier.padding(14.dp)) {
                ChampGhost(
                    intitule = "Délai d'attente (jours)",
                    valeur = delai,
                    invite = "7",
                    identifiant = "field.emergencyWait",
                    typeDeClavier = KeyboardType.Number,
                    onChange = { delai = it.filter(Char::isDigit).take(2) },
                )
            }
        }

        modele.message?.let { Erreur(it) }

        // **Deux temps, et le second nomme ce qu'on s'apprête à faire.** La confirmation ne
        // répète pas « êtes-vous sûr » : elle écrit le rôle, le contact et la conséquence,
        // parce que c'est l'information qui manque au moment de décider.
        if (!confirme) {
            BoutonPrincipal(
                "Continuer",
                actif = pret,
                identifiant = "button.reviewInvite",
            ) { confirme = true }
        } else {
            Column(
                Modifier.fillMaxWidth().carteDeVerre(marge = 14.dp).reperes("card.inviteConfirm"),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "Vous confiez à $email :",
                    color = couleurs.encre,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(role.explication, color = couleurs.attenue, fontSize = 13.sp)
                Text(
                    "Après une demande de sa part, l'accès s'ouvrira au bout de $jours jours " +
                        "si vous ne l'avez pas refusée.",
                    color = couleurs.attenue,
                    fontSize = 13.sp,
                )
            }
            BoutonPrincipal(
                "Confier l'accès",
                actif = pret,
                identifiant = "button.confirmInvite",
            ) {
                modele.inviterUnContactDUrgence(email, role.cle, jours ?: 7) { fait ->
                    if (fait) surFermer()
                }
            }
        }
    }
}

@Composable
private fun CarteDeRole(
    role: UrgenceDuCompte.Role,
    choisie: Boolean,
    surClic: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayon)
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                if (choisie) couleurs.accent.copy(alpha = 0.18f) else couleurs.surface2,
                forme,
            )
            .border(
                if (choisie) 1.5.dp else 1.dp,
                if (choisie) couleurs.accent else couleurs.bordure,
                forme,
            )
            .clickable(onClick = surClic)
            .reperes(
                identifiant = "role." + role.cle + if (choisie) ".on" else ".off",
                description = if (choisie) "${role.intitule}, choisi" else role.intitule,
            )
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            role.intitule,
            color = if (choisie) couleurs.accentTexte else couleurs.encre,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
        // L'explication est **toujours** visible, pas seulement sur le rôle choisi : c'est
        // en comparant les deux qu'on choisit, et un texte qui n'apparaît qu'après le clic
        // arrive trop tard.
        Text(role.explication, color = couleurs.attenue, fontSize = 12.sp)
    }
}

/**
 * Le coffre d'un donneur, ouvert.
 *
 * On y lit les identifiants de quelqu'un d'autre. L'écran le rappelle en tête — pas par
 * scrupule, mais parce qu'un coffre ressemble à un coffre, et qu'on referme rarement une
 * application en se demandant de qui était la liste qu'on vient de lire.
 */
@Composable
private fun EcranDuCoffreDUrgence(
    modele: ModeleDuCoffre,
    ouvert: ch.stackops.ghostpass.Coffre.CoffreDUrgenceOuvert,
    surFermer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var repriseOuverte by remember { mutableStateOf(false) }
    var nouveau by remember { mutableStateOf("") }
    var confirme by remember { mutableStateOf(false) }

    EcranGhost(identifiant = "screen.emergencyVault") {
        BarreDeFeuille(
            titre = "Coffre d'urgence",
            gauche = "Fermer",
            identifiantGauche = "button.closeEmergencyVault",
            surGauche = surFermer,
        )

        Column(
            Modifier.fillMaxWidth().carteDeVerre(marge = 14.dp).reperes("card.emergencyOwner"),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("Coffre de ${ouvert.donneur}", color = couleurs.encre, fontSize = 15.sp)
            Text(
                "Ces identifiants ne sont pas les vôtres. Rien de ce que vous faites ici ne " +
                    "modifie son coffre.",
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }

        SectionGhost(titre = "Identifiants") {
            if (ouvert.entrees.isEmpty()) {
                Vide("Ce coffre est vide.", "text.emptyEmergencyVault")
            } else {
                Column {
                    ouvert.entrees.forEachIndexed { rang, entree ->
                        if (rang > 0) FiletDeSection()
                        when (entree) {
                            is ch.stackops.ghostpass.EntreeDuCoffre.Lisible -> LigneLue(entree)
                            // **La règle §5 tient ici aussi**, et plus qu'ailleurs : un
                            // contact qui hérite d'un coffre doit savoir qu'il reste des
                            // éléments qu'il ne peut pas lire. Leur absence se lirait « il
                            // n'y avait que ça ».
                            is ch.stackops.ghostpass.EntreeDuCoffre.Illisible -> Row(
                                Modifier.fillMaxWidth().padding(14.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text("🔒", fontSize = 14.sp)
                                Text(
                                    "Élément illisible — scellé sous une clé que vous n'avez pas.",
                                    color = couleurs.attenue,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }
        }

        if (UrgenceDuCompte.Role.parCle(ouvert.role) == UrgenceDuCompte.Role.REPRISE) {
            SectionGhost(
                titre = "Reprendre le compte",
                note = "Le mot de passe maître de ${ouvert.donneur} sera remplacé, et toutes " +
                    "ses sessions fermées. Il ne pourra plus ouvrir son coffre sans le " +
                    "nouveau mot de passe.",
            ) {
                Column {
                    Box(Modifier.padding(14.dp)) {
                        ChampGhost(
                            intitule = "Nouveau mot de passe maître",
                            valeur = nouveau,
                            invite = "Huit caractères au minimum",
                            identifiant = "field.takeoverPassword",
                            secret = true,
                            typeDeClavier = KeyboardType.Password,
                            onChange = { nouveau = it; confirme = false },
                        )
                    }
                }
            }

            modele.message?.let { Erreur(it) }

            // Deux temps ici aussi, et le texte de confirmation nomme la personne. C'est
            // l'opération la plus lourde du produit : elle exclut quelqu'un de son coffre.
            if (!confirme) {
                BoutonSecondaire(
                    texte = "Reprendre le compte",
                    actif = nouveau.length >= 8 && !modele.occupe,
                    destructif = true,
                    identifiant = "button.reviewTakeover",
                ) { confirme = true }
            } else {
                Text(
                    "⚠ ${ouvert.donneur} perdra l'accès à son propre coffre tant que vous ne " +
                        "lui aurez pas donné ce mot de passe.",
                    color = couleurs.danger,
                    fontSize = 13.sp,
                    modifier = Modifier.reperes("text.takeoverWarning"),
                )
                BoutonSecondaire(
                    texte = "Confirmer la reprise",
                    actif = nouveau.length >= 8 && !modele.occupe,
                    destructif = true,
                    identifiant = "button.confirmTakeover",
                ) {
                    modele.reprendreLeCompte(ouvert, nouveau) { fait ->
                        if (fait) {
                            nouveau = ""
                            confirme = false
                            repriseOuverte = false
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LigneLue(entree: ch.stackops.ghostpass.EntreeDuCoffre.Lisible) {
    val couleurs = LocalCouleurs.current
    var montre by remember { mutableStateOf(false) }
    val identifiants = entree.element.identifiants

    Column(
        Modifier.fillMaxWidth().padding(14.dp).reperes("row.emergencyItem." + entree.id),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(entree.element.name, color = couleurs.encre, fontSize = 15.sp)
        identifiants?.username?.takeIf { it.isNotEmpty() }?.let {
            Text(it, color = couleurs.attenue, fontSize = 12.sp)
        }
        identifiants?.password?.takeIf { it.isNotEmpty() }?.let { mot ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (montre) mot else "•".repeat(mot.length.coerceAtMost(20)),
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                )
                Box(Modifier.widthIn(max = 90.dp)) {
                    BoutonSecondaire(
                        texte = if (montre) "Masquer" else "Afficher",
                        identifiant = "button.revealEmergency." + entree.id,
                    ) { montre = !montre }
                }
            }
        }
    }
}

@Composable
private fun Chargement() {
    val couleurs = LocalCouleurs.current
    Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = couleurs.accentTexte, strokeWidth = 2.dp)
    }
}

@Composable
private fun Indisponible(cause: String) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "⚠ Les accès d'urgence n'ont pas pu être lus.",
            color = couleurs.danger,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.emergencyFailed"),
        )
        Text(cause, color = couleurs.attenue, fontSize = 12.sp)
        // Comme pour le journal : une liste vide et une liste illisible ne veulent pas dire
        // la même chose, et la première est rassurante.
        Text(
            "Ceci ne veut pas dire qu'il n'y en a aucun : rien n'a pu être lu.",
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun Vide(texte: String, identifiant: String) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = couleurs.attenue,
        fontSize = 13.sp,
        modifier = Modifier.fillMaxWidth().padding(14.dp).reperes(identifiant),
    )
}

@Composable
private fun Erreur(message: String) {
    val couleurs = LocalCouleurs.current
    Text(
        "⚠ $message",
        color = couleurs.danger,
        fontSize = 12.sp,
        modifier = Modifier.reperes("text.emergencyError"),
    )
}
