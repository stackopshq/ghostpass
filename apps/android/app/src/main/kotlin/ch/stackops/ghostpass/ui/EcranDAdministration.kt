package ch.stackops.ghostpass.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.CollectionDOrganisation
import ch.stackops.ghostpass.GroupeDetailleDto
import ch.stackops.ghostpass.MembreDto
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.PermissionDeCollection
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.RoleDOrganisation
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * L'administration d'une équipe : les membres, les collections, les groupes.
 *
 * Porté d'`OrgAdminView`, `OrgInviteView`, `OrgGroupView` et `CollectionAccessView`. La
 * fiche des deux magasins promet « des collections partagées, des groupes, et la
 * possibilité de voir qui a accès à quoi — puis de le reprendre » ; Android n'en avait
 * **aucun écran**, alors que `noyau` portait déjà les opérations et qu'un témoin les
 * éprouvait contre un vrai serveur. Les fonctions existaient, et personne ne pouvait s'en
 * servir.
 *
 * ## Ce que cet écran ne propose pas, et pourquoi il le dit
 *
 * **Le changement de rôle d'un membre.** La route est un `PATCH`, et
 * `HttpURLConnection` — la pile HTTP d'Android — le refuse par un `ProtocolException`,
 * mesuré et non déduit (voir `Coffre.accorderSurUneCollection`). Plutôt qu'un bouton qui
 * échouerait au moment de s'en servir, l'écran affiche le rôle et dit où le changer. Un
 * manque énoncé coûte moins qu'une promesse qui casse.
 */
@Composable
fun EcranDAdministration(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    val organisation = modele.administrationDe ?: return

    // Les accès d'une collection recouvrent cet écran : on y regarde des personnes, pas une
    // sous-section de la liste des collections.
    val collectionRegardee = modele.accesDe
    if (collectionRegardee != null) {
        EcranDesAcces(modele, collectionRegardee) { modele.fermerLesAcces() }
        return
    }

    var invitationOuverte by remember { mutableStateOf(false) }
    if (invitationOuverte || modele.invitationAConfirmer != null) {
        EcranDInvitation(modele) {
            invitationOuverte = false
            modele.oublierLInvitation()
        }
        return
    }

    var aRevoquer by remember { mutableStateOf<MembreDto?>(null) }
    var nouvelleCollection by remember { mutableStateOf(false) }
    var nouveauGroupe by remember { mutableStateOf(false) }

    EcranGhost(identifiant = "screen.orgAdmin") {
        BarreDeFeuille(
            titre = organisation.nom,
            gauche = stringResource(R.string.admin_termine),
            identifiantGauche = "button.closeOrgAdmin",
            surGauche = surFermer,
        )

        when (val etat = modele.administration) {
            is ModeleDuCoffre.EtatDeLAdministration.EnLecture ->
                Attente(stringResource(R.string.admin_lecture))

            is ModeleDuCoffre.EtatDeLAdministration.Indisponible ->
                Indisponible(etat.cause)

            is ModeleDuCoffre.EtatDeLAdministration.Lu -> {
                SectionMembres(
                    membres = etat.membres,
                    occupe = modele.occupe,
                    surInviter = { invitationOuverte = true },
                    surRevoquer = { aRevoquer = it },
                )
                SectionCollections(
                    collections = etat.collections,
                    occupe = modele.occupe,
                    surAcces = { modele.ouvrirLesAcces(it) },
                    surNouvelle = { nouvelleCollection = true },
                )
                SectionGroupes(
                    groupes = etat.groupes,
                    collections = etat.collections,
                    membres = etat.membres,
                    occupe = modele.occupe,
                    surNouveau = { nouveauGroupe = true },
                    surAjouterUnMembre = { groupe, utilisateur ->
                        modele.ajouterAuGroupe(groupe, utilisateur)
                    },
                    surAccorder = { groupe, collection, permission ->
                        modele.accorderAuGroupe(groupe, collection, permission)
                    },
                )
                modele.message?.let { Erreur(it) }
            }
        }
    }

    aRevoquer?.let { membre ->
        ConfirmationDeRevocation(
            membre = membre,
            surAnnuler = { aRevoquer = null },
            surConfirmer = {
                aRevoquer = null
                // L'écran se referme de lui-même en cas de succès : le modèle rend toutes
                // les Org Keys, celle-ci comprise, parce que la clé de l'équipe a changé.
                modele.revoquerEtFaireTourner(membre)
            },
        )
    }

    if (nouvelleCollection) {
        BoiteDeNom(
            titre = stringResource(R.string.admin_nouvelle_collection),
            intitule = stringResource(R.string.admin_nom_collection),
            identifiant = "field.newCollection",
            identifiantValider = "button.createCollection",
            surAnnuler = { nouvelleCollection = false },
            surValider = { nom ->
                nouvelleCollection = false
                modele.creerUneCollectionDEquipe(nom)
            },
        )
    }

    if (nouveauGroupe) {
        BoiteDeNom(
            titre = stringResource(R.string.admin_nouveau_groupe),
            intitule = stringResource(R.string.admin_nom_groupe),
            identifiant = "field.newGroup",
            identifiantValider = "button.createGroup",
            surAnnuler = { nouveauGroupe = false },
            surValider = { nom ->
                nouveauGroupe = false
                modele.creerUnGroupeDEquipe(nom)
            },
        )
    }
}

// ─── Les membres ───

@Composable
private fun SectionMembres(
    membres: List<MembreDto>,
    occupe: Boolean,
    surInviter: () -> Unit,
    surRevoquer: (MembreDto) -> Unit,
) {
    SectionGhost(
        titre = stringResource(R.string.admin_membres_titre),
        // La note porte le manque plutôt que de le taire : voir l'en-tête du fichier.
        note = stringResource(R.string.admin_membres_note),
    ) {
        if (membres.isEmpty()) {
            Vide(stringResource(R.string.admin_aucun_membre), "text.noMembers")
        } else {
            Column {
                membres.forEachIndexed { rang, membre ->
                    if (rang > 0) FiletDeSection()
                    LigneMembre(membre, occupe) { surRevoquer(membre) }
                }
            }
        }
    }

    BoutonSecondaire(
        texte = stringResource(R.string.admin_inviter),
        actif = !occupe,
        identifiant = "button.inviteMember",
    ) { surInviter() }
}

@Composable
private fun LigneMembre(membre: MembreDto, occupe: Boolean, surRevoquer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 11.dp)
            .reperes("row.member.${membre.userId}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            // L'email, ou l'identifiant à défaut. Une ligne sans titre serait impossible à
            // désigner — et c'est pourtant celle qu'on voudrait révoquer.
            Text(
                membre.email ?: membre.userId,
                color = couleurs.encre,
                fontSize = 15.sp,
                maxLines = 1,
            )
            Text(
                stringResource(
                    R.string.admin_role_et_etat,
                    stringResource(intituleDuRole(membre.role)),
                    stringResource(intituleDeLEtat(membre.status)),
                ),
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
        LienDiscret(
            texte = stringResource(R.string.admin_revoquer),
            actif = !occupe,
            identifiant = "button.revoke.${membre.userId}",
        ) { surRevoquer() }
    }
}

/**
 * La confirmation d'une révocation, et **les deux phrases qu'elle doit tenir ensemble**.
 *
 * Retirer quelqu'un fait tourner la clé de l'équipe : ce qui s'écrira ensuite lui sera
 * illisible. Mais la rotation ne re-protège **pas** ce qu'il a déjà vu — ces mots de passe
 * doivent être changés un par un. Ne dire que la première ferait de cet écran une fausse
 * assurance, et c'est exactement le genre d'assurance qu'on ne découvre fausse qu'après.
 */
@Composable
private fun ConfirmationDeRevocation(
    membre: MembreDto,
    surAnnuler: () -> Unit,
    surConfirmer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    AlertDialog(
        onDismissRequest = surAnnuler,
        title = {
            Text(stringResource(R.string.admin_revoquer_titre), fontWeight = FontWeight.Bold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(
                        R.string.admin_revoquer_corps,
                        membre.email ?: membre.userId,
                    ),
                    color = couleurs.encre,
                    fontSize = 14.sp,
                )
                Text(
                    stringResource(R.string.admin_revoquer_deja_vu),
                    color = couleurs.attenue,
                    fontSize = 13.sp,
                )
            }
        },
        confirmButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.admin_revoquer_confirmer),
                destructif = true,
                identifiant = "button.confirmRevoke",
            ) { surConfirmer() }
        },
        dismissButton = {
            BoutonPrincipal(
                texte = stringResource(R.string.admin_annuler),
                actif = true,
                identifiant = "button.cancelRevoke",
            ) { surAnnuler() }
        },
        containerColor = couleurs.surface,
    )
}

// ─── Les collections ───

@Composable
private fun SectionCollections(
    collections: List<CollectionDOrganisation>,
    occupe: Boolean,
    surAcces: (CollectionDOrganisation) -> Unit,
    surNouvelle: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    SectionGhost(titre = stringResource(R.string.admin_collections_titre)) {
        if (collections.isEmpty()) {
            Vide(stringResource(R.string.admin_aucune_collection), "text.noCollections")
        } else {
            Column {
                collections.forEachIndexed { rang, collection ->
                    if (rang > 0) FiletDeSection()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 11.dp)
                            .reperes("row.collection.${collection.id}"),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                collection.nom,
                                color = couleurs.encre,
                                fontSize = 15.sp,
                                maxLines = 1,
                            )
                            Text(
                                stringResource(intituleDeLaPermission(collection.permission)),
                                color = couleurs.attenue,
                                fontSize = 12.sp,
                            )
                        }
                        LienDiscret(
                            texte = stringResource(R.string.admin_qui_a_acces),
                            actif = !occupe,
                            identifiant = "button.access.${collection.id}",
                        ) { surAcces(collection) }
                    }
                }
            }
        }
    }

    BoutonSecondaire(
        texte = stringResource(R.string.admin_nouvelle_collection),
        actif = !occupe,
        identifiant = "button.newCollection",
    ) { surNouvelle() }
}

// ─── Les groupes ───

@Composable
private fun SectionGroupes(
    groupes: List<GroupeDetailleDto>,
    collections: List<CollectionDOrganisation>,
    membres: List<MembreDto>,
    occupe: Boolean,
    surNouveau: () -> Unit,
    surAjouterUnMembre: (String, String) -> Unit,
    surAccorder: (String, String, PermissionDeCollection) -> Unit,
) {
    var groupeAPeupler by remember { mutableStateOf<GroupeDetailleDto?>(null) }
    var groupeAAccorder by remember { mutableStateOf<GroupeDetailleDto?>(null) }

    SectionGhost(
        titre = stringResource(R.string.admin_groupes_titre),
        note = stringResource(R.string.admin_groupes_note),
    ) {
        if (groupes.isEmpty()) {
            Vide(stringResource(R.string.admin_aucun_groupe), "text.noGroups")
        } else {
            Column {
                groupes.forEachIndexed { rang, groupe ->
                    if (rang > 0) FiletDeSection()
                    LigneGroupe(
                        groupe = groupe,
                        collections = collections,
                        occupe = occupe,
                        surPeupler = { groupeAPeupler = groupe },
                        surAccorder = { groupeAAccorder = groupe },
                    )
                }
            }
        }
    }

    BoutonSecondaire(
        texte = stringResource(R.string.admin_nouveau_groupe),
        actif = !occupe,
        identifiant = "button.newGroup",
    ) { surNouveau() }

    groupeAPeupler?.let { groupe ->
        // Seuls les membres **qui n'y sont pas déjà** : proposer les autres ferait du
        // deuxième ajout une erreur serveur là où il n'y a rien à corriger.
        val dedans = groupe.members.map { it.userId }.toSet()
        ChoixDUnePersonne(
            titre = stringResource(R.string.admin_ajouter_au_groupe, groupe.name),
            candidats = membres.filter { it.userId !in dedans },
            surAnnuler = { groupeAPeupler = null },
            surChoisir = { membre ->
                groupeAPeupler = null
                surAjouterUnMembre(groupe.id, membre.userId)
            },
        )
    }

    groupeAAccorder?.let { groupe ->
        ChoixDUnAcces(
            titre = stringResource(R.string.admin_accorder_au_groupe, groupe.name),
            collections = collections,
            surAnnuler = { groupeAAccorder = null },
            surAccorder = { collection, permission ->
                groupeAAccorder = null
                surAccorder(groupe.id, collection.id, permission)
            },
        )
    }
}

@Composable
private fun LigneGroupe(
    groupe: GroupeDetailleDto,
    collections: List<CollectionDOrganisation>,
    occupe: Boolean,
    surPeupler: () -> Unit,
    surAccorder: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 11.dp)
            .reperes("row.group.${groupe.id}"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(groupe.name, color = couleurs.encre, fontSize = 15.sp, maxLines = 1)
        Text(
            // Les membres par leur adresse, pas par un décompte : « 3 membres » n'aide pas à
            // décider si l'accès qu'on s'apprête à accorder va aux bonnes personnes.
            groupe.members.joinToString(", ") { it.email ?: it.userId }
                .ifEmpty { stringResource(R.string.admin_groupe_vide) },
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
        if (groupe.collections.isNotEmpty()) {
            Text(
                groupe.collections.joinToString(" · ") { acces ->
                    val nom = collections.firstOrNull { it.id == acces.collectionId }?.nom
                        ?: acces.collectionId
                    "$nom (${acces.permission})"
                },
                color = couleurs.attenue,
                fontSize = 12.sp,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            LienDiscret(
                texte = stringResource(R.string.admin_ajouter_un_membre),
                actif = !occupe,
                identifiant = "button.addToGroup.${groupe.id}",
            ) { surPeupler() }
            LienDiscret(
                texte = stringResource(R.string.admin_accorder),
                actif = !occupe && collections.isNotEmpty(),
                identifiant = "button.grant.${groupe.id}",
            ) { surAccorder() }
        }
    }
}

// ─── Les boîtes ───

/** Une boîte à un seul champ de texte, pour une création qui n'a besoin que d'un nom. */
@Composable
private fun BoiteDeNom(
    titre: String,
    intitule: String,
    identifiant: String,
    identifiantValider: String,
    surAnnuler: () -> Unit,
    surValider: (String) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var nom by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = surAnnuler,
        title = { Text(titre, fontWeight = FontWeight.Bold) },
        text = {
            ChampGhost(
                intitule = intitule,
                valeur = nom,
                invite = "",
                identifiant = identifiant,
                onChange = { nom = it },
            )
        },
        confirmButton = {
            BoutonPrincipal(
                texte = stringResource(R.string.admin_creer),
                actif = nom.isNotBlank(),
                identifiant = identifiantValider,
            ) { surValider(nom) }
        },
        dismissButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.admin_annuler),
                identifiant = "button.cancelName",
            ) { surAnnuler() }
        },
        containerColor = couleurs.surface,
    )
}

/** Le choix d'une personne parmi les membres de l'équipe. */
@Composable
private fun ChoixDUnePersonne(
    titre: String,
    candidats: List<MembreDto>,
    surAnnuler: () -> Unit,
    surChoisir: (MembreDto) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    AlertDialog(
        onDismissRequest = surAnnuler,
        title = { Text(titre, fontWeight = FontWeight.Bold) },
        text = {
            if (candidats.isEmpty()) {
                Text(
                    stringResource(R.string.admin_tous_deja_dedans),
                    color = couleurs.attenue,
                    fontSize = 13.sp,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    candidats.forEach { membre ->
                        LienDiscret(
                            texte = membre.email ?: membre.userId,
                            identifiant = "button.pickMember.${membre.userId}",
                        ) { surChoisir(membre) }
                    }
                }
            }
        },
        confirmButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.admin_annuler),
                identifiant = "button.cancelPickMember",
            ) { surAnnuler() }
        },
        containerColor = couleurs.surface,
    )
}

/** Le choix d'une collection **et** d'une permission, en une boîte. */
@Composable
private fun ChoixDUnAcces(
    titre: String,
    collections: List<CollectionDOrganisation>,
    surAnnuler: () -> Unit,
    surAccorder: (CollectionDOrganisation, PermissionDeCollection) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    var choisie by remember { mutableStateOf<CollectionDOrganisation?>(null) }
    AlertDialog(
        onDismissRequest = surAnnuler,
        title = { Text(titre, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val collection = choisie
                if (collection == null) {
                    Text(
                        stringResource(R.string.admin_choisir_la_collection),
                        color = couleurs.attenue,
                        fontSize = 13.sp,
                    )
                    collections.forEach { candidate ->
                        LienDiscret(
                            texte = candidate.nom,
                            identifiant = "button.pickCollection.${candidate.id}",
                        ) { choisie = candidate }
                    }
                } else {
                    Text(
                        stringResource(R.string.admin_choisir_la_permission, collection.nom),
                        color = couleurs.attenue,
                        fontSize = 13.sp,
                    )
                    PermissionDeCollection.entries.forEach { permission ->
                        LienDiscret(
                            texte = stringResource(intituleDeLaPermission(permission)),
                            identifiant = "button.pickPermission.${permission.name}",
                        ) { surAccorder(collection, permission) }
                    }
                }
            }
        },
        confirmButton = {
            BoutonSecondaire(
                texte = stringResource(R.string.admin_annuler),
                identifiant = "button.cancelGrant",
            ) { surAnnuler() }
        },
        containerColor = couleurs.surface,
    )
}

// ─── L'invitation, en deux temps ───

/**
 * Inviter quelqu'un — et **montrer la clé publique avant de sceller**.
 *
 * Rien n'authentifie la clé que le serveur annonce pour un email. Sceller l'Org Key vers
 * elle sans la montrer laisserait le serveur désigner qui reçoit la clé de l'équipe : un
 * serveur actif qui substitue la sienne lit tout ce que l'équipe écrira ensuite, et
 * l'invité verrait seulement une organisation qui ne s'ouvre pas — ce qui ressemble à une
 * erreur ordinaire.
 *
 * On ne peut pas le vérifier depuis le téléphone. On peut refuser de le faire en silence,
 * et c'est pourquoi cet écran a deux temps que rien ne permet de sauter : le type
 * `Invitation.AConfirmer` est ce que `poserLInvitation` exige.
 */
@Composable
private fun EcranDInvitation(modele: ModeleDuCoffre, surFermer: () -> Unit) {
    val couleurs = LocalCouleurs.current
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(RoleDOrganisation.Membre) }

    EcranGhost(identifiant = "screen.orgInvite") {
        BarreDeFeuille(
            titre = stringResource(R.string.admin_inviter_titre),
            gauche = stringResource(R.string.admin_annuler),
            identifiantGauche = "button.closeInvite",
            surGauche = surFermer,
        )

        val aConfirmer = modele.invitationAConfirmer
        if (aConfirmer == null) {
            Column(
                Modifier.fillMaxWidth().carteDeVerre(),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ChampGhost(
                    intitule = stringResource(R.string.admin_email),
                    valeur = email,
                    invite = "",
                    identifiant = "field.inviteEmail",
                    onChange = { email = it },
                )
                Text(
                    stringResource(R.string.admin_role_a_donner),
                    color = couleurs.attenue,
                    fontSize = 13.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    listOf(
                        RoleDOrganisation.Admin,
                        RoleDOrganisation.Membre,
                        RoleDOrganisation.LectureSeule,
                    ).forEach { candidat ->
                        LienDiscret(
                            // La marque reste ici et la ressource dit où elle se pose : une
                            // langue qui ponctue autrement doit pouvoir la déplacer.
                            texte = stringResource(
                                R.string.admin_role_choix,
                                if (role == candidat) "☑" else "☐",
                                stringResource(intituleDuRole2(candidat)),
                            ),
                            identifiant = "button.pickRole.${candidat.name}",
                        ) { role = candidat }
                    }
                }
                BoutonPrincipal(
                    texte = stringResource(R.string.admin_chercher),
                    actif = email.isNotBlank() && !modele.occupe,
                    occupe = modele.occupe,
                    identifiant = "button.lookupInvite",
                ) { modele.preparerUneInvitation(email) }

                modele.invitationSansCompte?.let {
                    Text(
                        stringResource(R.string.admin_sans_compte, it),
                        color = couleurs.danger,
                        fontSize = 12.sp,
                        modifier = Modifier.reperes("text.inviteNoAccount"),
                    )
                }
                modele.message?.let {
                    Text(it, color = couleurs.danger, fontSize = 12.sp)
                }
            }
        } else {
            SectionGhost(
                titre = stringResource(R.string.admin_confirmer_la_cle_titre),
                note = stringResource(R.string.admin_confirmer_la_cle_note),
            ) {
                Column {
                    LigneDeValeur(stringResource(R.string.admin_email), aConfirmer.email)
                    FiletDeSection()
                    LigneDeValeur(
                        stringResource(R.string.admin_cle_annoncee),
                        aConfirmer.clePubliqueAnnoncee,
                    )
                }
            }
            BoutonPrincipal(
                texte = stringResource(R.string.admin_sceller_et_inviter),
                actif = !modele.occupe,
                occupe = modele.occupe,
                identifiant = "button.confirmInvite",
            ) { modele.poserLInvitation(role) { reussi -> if (reussi) surFermer() } }
            BoutonSecondaire(
                texte = stringResource(R.string.admin_renoncer),
                destructif = true,
                identifiant = "button.abandonInvite",
            ) { modele.oublierLInvitation() }
            modele.message?.let {
                Text(it, color = couleurs.danger, fontSize = 12.sp)
            }
        }
    }
}

// ─── Les intitulés ───

private fun intituleDuRole(brut: String): Int = when (brut.lowercase()) {
    "admin" -> R.string.admin_role_admin
    "member" -> R.string.admin_role_membre
    "readonly" -> R.string.admin_role_lecture
    else -> R.string.admin_role_inconnu
}

private fun intituleDuRole2(role: RoleDOrganisation): Int = when (role) {
    RoleDOrganisation.Admin -> R.string.admin_role_admin
    RoleDOrganisation.Membre -> R.string.admin_role_membre
    RoleDOrganisation.LectureSeule -> R.string.admin_role_lecture
    RoleDOrganisation.Inconnu -> R.string.admin_role_inconnu
}

private fun intituleDeLEtat(brut: String): Int = when (brut.lowercase()) {
    "active" -> R.string.admin_etat_actif
    "invited", "pending" -> R.string.admin_etat_invite
    "revoked" -> R.string.admin_etat_revoque
    else -> R.string.admin_etat_inconnu
}

private fun intituleDeLaPermission(permission: PermissionDeCollection): Int = when (permission) {
    PermissionDeCollection.Lecture -> R.string.admin_permission_lecture
    PermissionDeCollection.Ecriture -> R.string.admin_permission_ecriture
    PermissionDeCollection.Gestion -> R.string.admin_permission_gestion
}

// ─── Les petites briques ───
//
// `private`, donc propres à ce fichier, et volontairement jumelles de celles
// d'`EcranDeLUrgence.kt` et d'`EcranDImport.kt`. C'est l'usage du dépôt : quatre lignes
// recopiées coûtent moins qu'une brique partagée qu'il faudrait faire voyager entre des
// écrans dont les marges ne s'accordent pas.

@Composable
private fun LigneDeValeur(intitule: String, valeur: String) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(intitule, color = couleurs.encre, fontSize = 15.sp)
        Box(Modifier.weight(1f))
        Text(valeur, color = couleurs.attenue, fontSize = 12.sp)
    }
}

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
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            cause,
            color = couleurs.danger,
            fontSize = 13.sp,
            modifier = Modifier.reperes("text.adminUnavailable"),
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
        modifier = Modifier.padding(horizontal = 20.dp).reperes("text.adminError"),
    )
}
