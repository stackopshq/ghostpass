package ch.stackops.ghostpass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import ch.stackops.ghostpass.BiometrieDeLAppareil
import ch.stackops.ghostpass.CollectionDOrganisation
import ch.stackops.ghostpass.ContenuDElement
import ch.stackops.ghostpass.CouleurDEquipe
import ch.stackops.ghostpass.EchecDOrganisation
import ch.stackops.ghostpass.EntreeDuCoffre
import ch.stackops.ghostpass.EtatDAppartenance
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.Organisation
import ch.stackops.ghostpass.OrigineDuCoffre
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.RaisonDIllisibilite
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.FondGhost
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.LienDiscret
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.reperes

/**
 * La liste du coffre — personnel ou d'équipe.
 *
 * C'est ici que la règle §5 devient visible : la liste parcourt `lectureAffichee.entrees`,
 * qui contient **aussi** les lignes qui ne se sont pas ouvertes. Filtrer sur `lisibles`
 * serait une ligne plus courte et une régression silencieuse.
 *
 * ## Ce que cet écran a longtemps manqué
 *
 * Trois choses, toutes vues en dix secondes sur un vrai téléphone et par aucune relecture :
 *
 *  - **les coffres d'équipe.** L'application n'appelait que `/api/vault/items`, le coffre
 *    personnel. Quelqu'un dont les mots de passe vivent en collection d'équipe voyait une
 *    liste vide et concluait à une perte de données ;
 *  - **la recherche.** Un coffre de trente lignes sans recherche n'est plus un gestionnaire
 *    de mots de passe, c'est une liste ;
 *  - **un moyen de sortir.** Ni verrouillage à portée de main, ni déconnexion.
 */
@Composable
fun EcranDuCoffre(
    modele: ModeleDuCoffre,
    surNouveau: () -> Unit = {},
    surModifier: (EntreeDuCoffre.Lisible) -> Unit = {},
    surCorbeille: () -> Unit = {},
    surSante: () -> Unit = {},
    surReglages: () -> Unit = {},
    surImport: () -> Unit = {},
    surSecondFacteur: () -> Unit = {},
) {
    val couleurs = LocalCouleurs.current
    val lecture = modele.lectureAffichee
    var recherche by rememberSaveable { mutableStateOf("") }
    var reglagesOuverts by rememberSaveable { mutableStateOf(false) }

    // Les équipes se chargent avec le coffre, **contenu compris** : cette liste est celle
    // du coffre entier. Sans elles, l'écran ment par omission — et pour qui n'a que des
    // mots de passe d'équipe, il ment entièrement.
    LaunchedEffect(Unit) { modele.chargerLesCoffresDEquipe() }

    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(Modifier.fillMaxSize()) {
            BarreDOutils(
                modele = modele,
                reglagesOuverts = reglagesOuverts,
                surReglages = { reglagesOuverts = !reglagesOuverts },
                surNouveau = surNouveau,
            )

            if (reglagesOuverts) {
                MenuDeReglages(
                    modele, surCorbeille, surSante, surReglages, surImport, surSecondFacteur,
                ) {
                    reglagesOuverts = false
                }
            }

            ChoixDuCoffre(modele)

            if (modele.collectionOuverte == null) BandeDeDossiers(modele)

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

            // ─── La recherche ───
            //
            // Un champ à nous, et non celui de Material. La charte §7 note que sur iOS les
            // boutons restent rectangulaires **parce que** la barre de recherche du système
            // ne peut pas devenir une pilule. Ici le champ est redessinable : il prend donc
            // la forme des autres champs du produit, et rien n'a besoin de céder.
            if (lecture.entrees.isNotEmpty() || recherche.isNotEmpty()) {
                Box(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                    ChampGhost(
                        intitule = "Rechercher",
                        valeur = recherche,
                        invite = "Nom, identifiant, dossier",
                        identifiant = "field.search",
                        onChange = { recherche = it },
                    )
                }
            }

            val filtrees = filtrer(lecture.entrees, recherche)

            if (filtrees.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        messageDeListeVide(modele, recherche),
                        color = couleurs.attenue,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 24.dp),
                    )
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Les favoris en tête, puis le nom sans égard à la casse. L'ordre est
                    // **stable** : une liste qui se réordonne d'un affichage à l'autre est
                    // une liste où l'on ne retrouve rien.
                    val ordonnees = filtrees.sortedWith(
                        compareBy<EntreeDuCoffre> { it.id !in lecture.favoris }
                            .thenBy(String.CASE_INSENSITIVE_ORDER) {
                                (it as? EntreeDuCoffre.Lisible)?.element?.name ?: ""
                            },
                    )
                    items(ordonnees, key = { it.id }) { entree ->
                        when (entree) {
                            is EntreeDuCoffre.Lisible -> LigneLisible(
                                entree = entree,
                                favori = entree.id in lecture.favoris,
                                // L'étoile écrit dans un registre du coffre **personnel** :
                                // elle n'a pas de sens sur un élément d'équipe, et la
                                // proposer y écrirait un favori que personne ne relirait.
                                //
                                // La condition porte sur l'**origine** de la ligne et non
                                // sur l'écran : depuis la fusion, l'accueil contient les
                                // deux, et « aucune collection ouverte » ne veut plus dire
                                // « tout est personnel ici ».
                                surFavori = if (!entree.origine.estDEquipe) {
                                    { modele.basculerLeFavori(entree.id) }
                                } else {
                                    null
                                },
                            ) { surModifier(entree) }
                            is EntreeDuCoffre.Illisible -> LigneIllisible(entree)
                        }
                    }

                    // Ce qu'une recherche a mis de côté sans pouvoir le lire. Une ligne
                    // illisible n'a pas de nom : aucune recherche ne peut la retenir, et son
                    // absence se lirait « il n'y a rien d'autre ». On la compte donc.
                    val illisiblesEcartees =
                        lecture.nombreDIllisibles - filtrees.count { it is EntreeDuCoffre.Illisible }
                    if (recherche.isNotEmpty() && illisiblesEcartees > 0) {
                        item {
                            Text(
                                // « élément(s) illisible(s) » : deux parenthèses sur une
                                // même ligne, et l'une d'elles est fausse dans les deux
                                // cas. `plurals` accorde aussi le verbe, ce qu'aucune
                                // parenthèse ne sait faire.
                                LocalContext.current.resources.getQuantityString(
                                    R.plurals.coffre_illisibles_ecartes,
                                    illisiblesEcartees,
                                    illisiblesEcartees,
                                ),
                                color = couleurs.attenue,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * La barre d'outils : l'ornement, le titre, et les actions.
 *
 * L'emoji de coffre est **purement décoratif**, et ses deux modificateurs comptent autant
 * que lui — c'est l'idée de Kevin, reprise telle quelle d'iOS :
 *
 *  - `hideFromAccessibility()` : sans elle, un lecteur d'écran annonce l'emoji avant le
 *    titre, et « visage de fantôme » n'apprend rien à personne ;
 *  - **aucun `clickable`** : un ornement ne doit pas absorber un toucher. Appuyer sur
 *    quelque chose qui ne fait rien se lit comme une panne.
 */
@Composable
private fun BarreDOutils(
    modele: ModeleDuCoffre,
    reglagesOuverts: Boolean,
    surReglages: () -> Unit,
    surNouveau: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "🗄️",
            fontSize = 22.sp,
            modifier = Modifier.semantics { hideFromAccessibility() },
        )
        Text(
            modele.collectionOuverte?.nom ?: "Coffre",
            color = couleurs.encre,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f),
        )
        // « Nouveau » parle de l'endroit où l'élément **ira**, pas d'un élément existant :
        // c'est donc bien la permission de l'écran, et non celle d'une origine.
        if (modele.peutEcrire) {
            Box(Modifier.widthIn(max = 110.dp)) {
                BoutonSecondaire("Nouveau", identifiant = "button.new") { surNouveau() }
            }
        }
        Box(Modifier.widthIn(max = 60.dp)) {
            BoutonSecondaire(
                texte = if (reglagesOuverts) "✕" else "⋯",
                identifiant = "button.settings",
            ) { surReglages() }
        }
    }
}

/**
 * Le menu de réglages — **et rien de grisé**.
 *
 * La règle tient toujours : **on n'inscrit ici que ce qui existe**. Un réglage grisé qui
 * promet une fonction inexistante est pire que son absence — il déplace l'échec du moment
 * où l'on configure au moment où quelqu'un essaie de s'en servir.
 *
 * La liste s'allonge donc au rythme des écrans portés, et jamais avant. « Santé du coffre »
 * y est entrée le jour où `EcranDeLaSante` a existé.
 */
@Composable
private fun MenuDeReglages(
    modele: ModeleDuCoffre,
    surCorbeille: () -> Unit,
    surSante: () -> Unit,
    surReglages: () -> Unit,
    surImport: () -> Unit,
    surSecondFacteur: () -> Unit,
    surFermer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val activite = LocalContext.current as FragmentActivity
    val forme = RoundedCornerShape(GP.rayonCarte)

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .background(couleurs.surface.copy(alpha = 0.9f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // **La roue crantée a enfin un écran à ouvrir.** Elle n'en avait aucun tant que
        // les réglages tenaient dans ces trois entrées ; la poser alors aurait été un
        // bouton qui n'ouvre rien, ce qui se lit comme une panne.
        LienDiscret("Réglages", identifiant = "button.settings.open") {
            surFermer()
            surReglages()
        }

        LienDiscret("Second facteur", identifiant = "button.mfa") {
            surFermer()
            surSecondFacteur()
        }

        LienDiscret("Santé du coffre", identifiant = "button.health") {
            surFermer()
            surSante()
        }

        // L'import écrit dans le coffre **personnel** : le proposer depuis une collection
        // d'équipe laisserait croire qu'il y déposera. On ne l'offre donc qu'à l'accueil.
        if (modele.collectionOuverte == null) {
            LienDiscret("Importer un CSV", identifiant = "button.import") {
                surFermer()
                surImport()
            }
        }

        LienDiscret("Corbeille", identifiant = "button.trash") {
            surFermer()
            surCorbeille()
        }

        if (modele.biometriePossible) {
            // Le même nom qu'à l'écran d'entrée, et pour la même raison : « empreinte » en
            // dur ment sur un appareil à reconnaissance faciale. Deux formulations
            // différentes pour la même fonction feraient en outre douter qu'il s'agisse de
            // la même — on active ici ce sur quoi on appuie là-bas.
            val nomDuGeste = BiometrieDeLAppareil.nom(activite)
            LienDiscret(
                texte = if (modele.biometrieActivee) {
                    "Désactiver le déverrouillage par $nomDuGeste"
                } else {
                    "Activer le déverrouillage par $nomDuGeste"
                },
                identifiant = "button.biometricToggle",
            ) {
                if (modele.biometrieActivee) {
                    modele.desactiverLaBiometrie()
                } else {
                    modele.activerLaBiometrie(activite)
                }
            }
        }

        LienDiscret("Verrouiller", identifiant = "button.lock") {
            surFermer()
            modele.verrouiller()
        }

        // La déconnexion oublie la session, le cache **et** l'enveloppe biométrique. Elle
        // est distincte du verrouillage, et le dire évite de la choisir par erreur.
        LienDiscret("Se déconnecter", identifiant = "button.logout") {
            surFermer()
            modele.fermerLaSession()
        }
        Text(
            "Le verrouillage garde la session ; la déconnexion l'efface et demandera de " +
                "tout ressaisir.",
            color = couleurs.attenue,
            fontSize = 11.sp,
        )
    }
}

/**
 * Le choix entre le coffre personnel et les coffres d'équipe.
 *
 * Trois états par organisation, et les confondre coûte :
 *
 *  - **ouverte** : ses collections s'affichent ;
 *  - **en attente d'acceptation** : elle n'a *pas* de contenu, et le dire n'est pas la même
 *    chose que la montrer vide ;
 *  - **en échec** : elle garde sa place et dit pourquoi. Les autres restent utilisables —
 *    une clé d'équipe qui ne s'ouvre pas ne doit pas vider l'écran.
 */
@Composable
private fun ChoixDuCoffre(modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current
    if (modele.organisations.isEmpty()) return

    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Pastilledechoix(
                // « Mon coffre » est devenu faux le jour où l'accueil a fondu les deux
                // origines : cette pastille ne montre plus le seul coffre personnel, elle
                // montre **tout**. Le nom est celui d'iOS, vu sur la capture
                // `AppStore/captures/01-coffre.png` — « Tous les éléments ».
                //
                // L'identifiant, lui, ne bouge pas : `chip.personal` sert aux témoins des
                // deux plateformes, et le renommer d'un seul côté les ferait diverger en
                // silence. Le libellé se lit, l'identifiant se cherche ; ce sont deux
                // publics différents.
                texte = "Tous les éléments",
                choisie = modele.collectionOuverte == null,
                identifiant = "chip.personal",
            ) { modele.revenirAuCoffrePersonnel() }

            for (organisation in modele.organisations) {
                Pastilledechoix(
                    texte = organisation.nom,
                    choisie = modele.organisationOuverte?.organisation?.id == organisation.id,
                    identifiant = "chip.org." + organisation.id,
                ) {
                    if (organisation.etat == EtatDAppartenance.Invite) {
                        modele.accepterLInvitation(organisation)
                    } else {
                        modele.ouvrirUneOrganisation(organisation)
                    }
                }
            }
        }

        for (organisation in modele.organisations) {
            val echec = modele.echecsDOrganisation[organisation.id]
            if (organisation.etat == EtatDAppartenance.Invite) {
                Text(
                    "« ${organisation.nom} » vous a invité·e. Touchez son nom pour accepter ; " +
                        "son contenu ne sera lisible qu'ensuite.",
                    color = couleurs.attenue,
                    fontSize = 12.sp,
                )
            } else if (echec != null) {
                Text(
                    "« ${organisation.nom} » : " + when (echec) {
                        EchecDOrganisation.InvitationEnAttente ->
                            "invitation pas encore acceptée."
                        EchecDOrganisation.AucuneCleRemise ->
                            "aucune clé ne vous a encore été remise. Un administrateur doit " +
                                "vous l'attribuer."
                        is EchecDOrganisation.CleRefusee ->
                            "la clé de ce coffre n'a pas pu être ouverte. Elle a peut-être " +
                                "été remplacée depuis qu'elle vous a été remise."
                        is EchecDOrganisation.Reseau ->
                            "coffre injoignable pour l'instant."
                    },
                    color = couleurs.danger,
                    fontSize = 12.sp,
                )
            }
        }

        // Les collections de l'organisation ouverte.
        val ouverte = modele.organisationOuverte
        if (ouverte != null && ouverte.collections.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (collection in ouverte.collections) {
                    Pastilledechoix(
                        // La permission se lit **avant** d'ouvrir : découvrir qu'on ne peut
                        // pas écrire après avoir tout saisi est le pire moment.
                        texte = collection.nom +
                            if (collection.permission.peutEcrire) "" else " (lecture)",
                        choisie = modele.collectionOuverte?.id == collection.id,
                        identifiant = "chip.collection." + collection.id,
                    ) { modele.ouvrirUneCollection(collection) }
                }
            }
        }
    }
}

@Composable
private fun Pastilledechoix(
    texte: String,
    choisie: Boolean,
    identifiant: String,
    surClic: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayon)
    Box(
        Modifier
            .background(
                if (choisie) couleurs.accent.copy(alpha = 0.9f) else couleurs.surface2,
                forme,
            )
            .border(1.dp, couleurs.bordure, forme)
            .clickable(onClick = surClic)
            .reperes(identifiant)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(
            texte,
            color = if (choisie) couleurs.surAccent else couleurs.encre,
            fontSize = 13.sp,
        )
    }
}

/** Ce qu'on dit quand la liste est vide — et « vide » a quatre causes différentes. */
private fun messageDeListeVide(modele: ModeleDuCoffre, recherche: String): String = when {
    recherche.isNotEmpty() -> "Aucun élément ne correspond à « $recherche »."
    // « On n'a pas pu regarder » n'est pas « il n'y a rien », et les confondre fait
    // recréer un identifiant qui existe déjà.
    modele.horsLigne -> "Coffre indisponible hors ligne — rien n'a encore été mis en cache."
    modele.collectionOuverte != null -> "Cette collection d'équipe est vide."
    // Cette phrase-là était le symptôme du défaut, pas son remède : elle envoyait chercher
    // ailleurs ce que l'accueil aurait dû montrer. Depuis la fusion, un accueil vide alors
    // qu'on appartient à des équipes ne veut plus dire « c'est rangé ailleurs » — il veut
    // dire que les équipes n'ont pas pu être lues, et c'est ce qu'il faut dire.
    modele.echecsDOrganisation.isNotEmpty() ->
        "Vos coffres d'équipe n'ont pas pu être ouverts — voyez le motif ci-dessus."
    else -> "Ce coffre est vide."
}

/**
 * Le filtre de la recherche.
 *
 * Il porte sur le nom, l'identifiant et le dossier — ce qu'on tape quand on cherche. Les
 * lignes illisibles ne peuvent pas être filtrées : elles n'ont pas de nom, puisqu'il vit
 * dans le chiffré. Elles sortent donc dès qu'une recherche est active, et l'écran le
 * **compte** pour que leur absence ne se lise pas « il n'y a rien d'autre ».
 */
private fun filtrer(entrees: List<EntreeDuCoffre>, recherche: String): List<EntreeDuCoffre> {
    val requete = recherche.trim().lowercase()
    if (requete.isEmpty()) return entrees
    return entrees.filterIsInstance<EntreeDuCoffre.Lisible>().filter { entree ->
        val element = entree.element
        val identifiants = element.identifiants
        element.name.lowercase().contains(requete) ||
            element.folder?.lowercase()?.contains(requete) == true ||
            identifiants?.username?.lowercase()?.contains(requete) == true ||
            identifiants?.uris?.any { it.lowercase().contains(requete) } == true
    }
}

@Composable
private fun LigneLisible(
    entree: EntreeDuCoffre.Lisible,
    favori: Boolean,
    surFavori: (() -> Unit)?,
    surClic: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val element = entree.element
    val forme = RoundedCornerShape(GP.rayonCarte)

    Row(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.7f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .clickable(onClick = surClic)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Pastille(element.name)
        Column(Modifier.weight(1f)) {
            Text(element.name, color = couleurs.encre, fontSize = 15.sp)
            val detail = when (val d = element.data) {
                is ContenuDElement.Connexion -> d.valeur.username.ifEmpty { "Identifiant" }
                is ContenuDElement.NoteSecrete -> "Note sécurisée"
                is ContenuDElement.Carte -> "Carte"
            }
            Text(detail, color = couleurs.attenue, fontSize = 13.sp)
            MarqueDOrigine(entree.origine)
        }
        if (surFavori != null) {
            // L'étoile a sa propre zone de toucher : elle ne doit pas ouvrir l'élément.
            Text(
                if (favori) "★" else "☆",
                color = if (favori) couleurs.accentTexte else couleurs.attenue,
                fontSize = 18.sp,
                modifier = Modifier
                    .clickable(onClick = surFavori)
                    // Deux emplacements, désormais, pour deux lecteurs différents.
                    //
                    // L'état entre dans l'**identifiant**, parce qu'une machine doit pouvoir
                    // distinguer une étoile allumée d'une étoile éteinte : le « ★ » est du
                    // texte de nœud, qu'un lecteur d'écran annonce « étoile blanche » et
                    // qu'une description écraserait. Il entre aussi dans la **description**,
                    // mais en français — c'est ce qui se prononce.
                    //
                    // Avant `testTag`, ces deux besoins se disputaient la même propriété :
                    // l'identifiant y logeait, et l'étoile se lisait « button.favorite.<id>.on »
                    // à voix haute.
                    .reperes(
                        identifiant = "button.favorite." + entree.id +
                            if (favori) ".on" else ".off",
                        description = if (favori) "Retirer des favoris" else "Ajouter aux favoris",
                    )
                    .padding(6.dp),
            )
        }
    }
}

/**
 * Une ligne qui ne s'est pas ouverte.
 *
 * Elle **garde sa place** et **dit pourquoi**. Elle ne porte aucun nom : le nom vit dans le
 * chiffré, et en inventer un serait pire que de n'en montrer aucun.
 *
 * Sa forme est celle des autres lignes, pas celle d'une erreur : ce n'est pas un incident de
 * l'application, c'est un élément du coffre qui existe et qu'on ne peut pas lire. Dans une
 * collection d'équipe, c'est encore plus vrai — l'élément a été scellé par quelqu'un
 * d'autre, et son absence se lirait « cette personne ne l'a pas encore créé ».
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
            Modifier.size(32.dp).background(couleurs.surface2, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("🔒", fontSize = 15.sp)
        }
        Column(Modifier.fillMaxWidth()) {
            Text("Élément illisible", color = couleurs.attenue, fontSize = 15.sp)
            Text(
                when (entree.raison) {
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
            // Une ligne illisible porte sa marque **aussi**, et c'est là qu'elle sert le
            // plus : sans elle, elle se lirait comme un élément personnel abîmé, et l'on
            // chercherait le défaut dans le mauvais coffre — alors que la cause est presque
            // toujours une clé d'organisation qu'on n'a pas encore reçue.
            MarqueDOrigine(entree.origine)
        }
    }
}

/**
 * **D'où vient cette ligne**, dit sur la ligne elle-même.
 *
 * C'est ce qui rend la fusion lisible. Une seule liste où rien ne distinguerait un élément
 * d'équipe d'un élément personnel serait pire que deux listes : on croirait tout pouvoir
 * modifier, et l'on ne saurait pas qui voit quoi.
 *
 * L'étiquette nomme **l'équipe et la collection**. Les deux, parce que savoir laquelle
 * compte dès qu'on appartient à plusieurs équipes, et qu'une collection n'a de sens
 * qu'associée à la sienne.
 *
 * Elle reste du **texte**, et ne prend pas de `contentDescription` : contrairement à
 * l'étoile, dont le glyphe n'apprend rien à un lecteur d'écran, ce texte est déjà la phrase
 * qu'il faut lire. Une description l'aurait remplacée par un identifiant de machine, et
 * aurait rendu l'écran moins lisible pour gagner un témoin plus commode.
 */
@Composable
private fun MarqueDOrigine(origine: OrigineDuCoffre) {
    val couleurs = LocalCouleurs.current
    val etiquette = origine.etiquette ?: return
    Text(
        etiquette,
        color = couleurs.accentTexte,
        fontSize = 11.sp,
        modifier = Modifier
            .padding(top = 3.dp)
            .background(
                couleurs.accent.copy(alpha = 0.14f),
                RoundedCornerShape(6.dp),
            )
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/**
 * La bande des dossiers, et le moyen d'en créer un vide.
 *
 * Un dossier « existe » de deux façons : parce qu'un élément l'habite, ou parce qu'il est
 * inscrit au registre des dossiers **vides**. La seconde est la seule qui permette de
 * préparer un rangement avant d'avoir quoi que ce soit à y mettre, et la seule qui empêche
 * un dossier de s'évaporer quand on en sort le dernier élément.
 */
@Composable
private fun BandeDeDossiers(modele: ModeleDuCoffre) {
    val couleurs = LocalCouleurs.current
    var ouvert by rememberSaveable { mutableStateOf(false) }
    var nouveau by rememberSaveable { mutableStateOf("") }
    val dossiers = modele.dossiers

    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        LienDiscret(
            texte = if (ouvert) "Masquer les dossiers" else "Dossiers (${dossiers.size})",
            identifiant = "button.folders",
        ) { ouvert = !ouvert }

        if (ouvert) {
            for (dossier in dossiers) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(dossier, color = couleurs.encre, fontSize = 13.sp)
                    // Seuls les dossiers vides se retirent : les autres tiennent à leurs
                    // éléments, et « retirer » n'y voudrait rien dire.
                    if (dossier in modele.lecture.dossiersVides) {
                        LienDiscret("Retirer", identifiant = "button.removeFolder") {
                            modele.retirerUnDossierVide(dossier)
                        }
                    }
                }
            }
            ChampGhost(
                intitule = "Nouveau dossier",
                valeur = nouveau,
                invite = "Travail/Serveurs",
                identifiant = "field.newFolder",
                onChange = { nouveau = it },
            )
            LienDiscret(
                texte = "Ajouter",
                actif = nouveau.isNotBlank() && !modele.occupe,
                identifiant = "button.addFolder",
            ) {
                modele.ajouterUnDossierVide(nouveau)
                nouveau = ""
            }
        }
    }
}

/**
 * La pastille d'initiale, teintée par la règle de couleur partagée.
 *
 * La même couleur pour le même nom sur les trois clients : [CouleurDEquipe], la somme des
 * octets UTF-8 modulo huit. Aucun hachage de bibliothèque, parce qu'aucun n'est garanti
 * stable d'une exécution à l'autre.
 */
@Composable
private fun Pastille(nom: String) {
    val argb = CouleurDEquipe.couleurArgb(CouleurDEquipe.attribuee(nom))!!
    Box(
        Modifier.size(32.dp).background(Color(argb).copy(alpha = 0.9f), RoundedCornerShape(10.dp)),
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
