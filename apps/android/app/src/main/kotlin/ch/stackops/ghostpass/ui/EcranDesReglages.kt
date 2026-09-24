package ch.stackops.ghostpass.ui

import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.runtime.DisposableEffect
import ch.stackops.ghostpass.Apparence
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.Preferences
import ch.stackops.ghostpass.R
import ch.stackops.ghostpass.Verrouillage
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.GP
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.reperes

/**
 * Les réglages : apparence, verrouillage, et ce que voit le remplissage automatique.
 *
 * C'est le `SettingsView.swift` d'iOS, **amputé de deux sections et le disant**. Voir
 * [PourquoiPasDeLangueNiDIcones] : les ajouter reviendrait à proposer des réglages qui ne
 * commandent rien, et la charte §8 tranche — « un réglage grisé est pire que son absence
 * quand la fonction ne peut pas exister ».
 *
 * Jusqu'ici Android n'avait qu'un menu de trois entrées sous la barre du coffre. La roue
 * crantée n'avait donc aucun écran à ouvrir ; elle en a un maintenant.
 */
@Composable
fun EcranDesReglages(
    modele: ModeleDuCoffre,
    reglages: Preferences,
    surFermer: () -> Unit,
) {
    EcranGhost(identifiant = "screen.settings") {
        BarreDeFeuille(
            titre = "Réglages",
            gauche = "Terminé",
            identifiantGauche = "button.doneSettings",
            surGauche = surFermer,
        )

        SectionGhost(
            titre = "Apparence",
            note = "« Système » suit le réglage de l'appareil, y compris son passage " +
                "automatique à la nuit.",
        ) {
            // Trois vignettes plutôt qu'une liste déroulante : le choix est visuel, et
            // l'aperçu vaut mieux qu'un nom.
            Row(
                Modifier.fillMaxWidth().padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                for (cas in Apparence.entries) {
                    Box(Modifier.weight(1f)) {
                        Vignette(cas, choisie = reglages.apparence == cas) {
                            reglages.choisirLApparence(cas)
                        }
                    }
                }
            }
        }

        SectionGhost(
            titre = "Verrouillage",
            note = "Pendant ce délai, le coffre reste ouvert en mémoire — jamais sur le " +
                "disque — et son contenu est masqué dans le sélecteur d'applications.",
        ) {
            Column {
                Verrouillage.entries.forEachIndexed { index, cas ->
                    if (index > 0) FiletDeSection()
                    LigneDeChoix(
                        libelle = cas.libelle,
                        choisie = reglages.verrouillage == cas,
                        identifiant = "row.lock." + cas.cle,
                    ) { reglages.choisirLeVerrouillage(cas) }
                }
            }
        }

        RemplissageAutomatique(modele)
    }
}

/**
 * Ce que voit le service de remplissage — **et d'abord, s'il est appelé du tout**.
 *
 * Cette section ne répare rien ; elle rend lisible un état invisible. C'est la leçon d'iOS,
 * où l'extension affichait « Aucun identifiant » — un message qui décrit son écran sans
 * rien dire de la cause, et qui ressemble à s'y méprendre à un défaut d'appariement de
 * domaine. Sur Android le service se choisit dans les réglages du système, et tant qu'il
 * n'est pas choisi **il n'est jamais appelé** : aucune suggestion n'apparaît, et rien
 * n'explique pourquoi.
 *
 * L'autre leçon d'iOS est dans le compte : la première version de sa section ne comptait
 * que le coffre personnel et affichait « 0 » avec la même assurance, que les coffres
 * d'équipe fussent déposés ou non. Un indicateur qui ne mesure pas ce qu'on lui demande
 * vaut moins que pas d'indicateur, puisqu'on le croit. Les deux comptes sont donc séparés.
 */
@Composable
private fun RemplissageAutomatique(modele: ModeleDuCoffre) {
    val contexte = LocalContext.current
    val couleurs = LocalCouleurs.current
    var actif by remember { mutableStateOf(remplissageActif(contexte)) }

    // L'état se relit **au retour** des réglages du système, et pas seulement à l'ouverture
    // de cet écran. Sans cela, quelqu'un qui vient d'autoriser le service reviendrait sur
    // une ligne qui dit encore « non autorisé » — et conclurait que son geste a échoué.
    val cycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(cycle) {
        val observateur = LifecycleEventObserver { _, evenement ->
            if (evenement == Lifecycle.Event.ON_RESUME) actif = remplissageActif(contexte)
        }
        cycle.addObserver(observateur)
        onDispose { cycle.removeObserver(observateur) }
    }

    val coffreComplet = modele.coffreComplet
    val personnels = modele.lecture.entrees.size
    val equipes = modele.partagesDEquipe

    SectionGhost(
        titre = "Remplissage automatique",
        note = "Le service ne voit pas le serveur : il lit le coffre déjà ouvert par " +
            "l'application. Un coffre verrouillé ne propose rien, quel que soit le site.",
    ) {
        Column {
            when (actif) {
                true -> LigneDeDiagnostic("Service", "autorisé", alerte = false)
                false -> Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { ouvrirLesReglagesDeRemplissage(contexte) }
                        .reperes("button.enableAutofillSettings")
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Service", color = couleurs.encre, fontSize = 15.sp)
                    Box(Modifier.weight(1f))
                    Text("non autorisé", color = couleurs.danger, fontSize = 14.sp)
                    Text(
                        " ›",
                        color = couleurs.attenue,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                // `null` : l'appareil est trop ancien pour le remplissage d'Android. Le dire
                // vaut mieux que de montrer « non autorisé » avec un bouton qui n'ouvrirait
                // aucun écran.
                null -> LigneDeDiagnostic(
                    "Service",
                    "indisponible sur cet Android",
                    alerte = true,
                )
            }
            FiletDeSection()
            LigneDeDiagnostic(
                "Coffre personnel",
                contexte.resources.getQuantityString(
                    R.plurals.reglages_elements, personnels, personnels,
                ),
                alerte = personnels == 0,
            )
            FiletDeSection()
            LigneDeDiagnostic(
                "Coffres d'équipe",
                if (equipes.isEmpty()) {
                    "aucun"
                } else {
                    val elements = equipes.sumOf { it.entrees.size }
                    contexte.resources.getQuantityString(
                        R.plurals.reglages_elements, elements, elements,
                    ) + " · " + contexte.resources.getQuantityString(
                        R.plurals.reglages_coffres, equipes.size, equipes.size,
                    )
                },
                alerte = equipes.isNotEmpty() && equipes.sumOf { it.entrees.size } == 0,
            )
            FiletDeSection()
            // Ce qui ne s'est pas ouvert n'est pas remplissable, et son absence de la
            // liste se lirait « il n'y a rien ». On le compte donc à part.
            val illisibles = coffreComplet.nombreDIllisibles
            LigneDeDiagnostic(
                "Non déchiffrés",
                contexte.resources.getQuantityString(
                    R.plurals.reglages_elements, illisibles, illisibles,
                ),
                alerte = illisibles > 0,
            )
        }
    }
}

@Composable
private fun LigneDeDiagnostic(titre: String, valeur: String, alerte: Boolean) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(titre, color = couleurs.encre, fontSize = 15.sp)
        Box(Modifier.weight(1f))
        Text(valeur, color = if (alerte) couleurs.danger else couleurs.attenue, fontSize = 14.sp)
    }
}

@Composable
private fun LigneDeChoix(
    libelle: String,
    choisie: Boolean,
    identifiant: String,
    surClic: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = surClic)
            // L'état entre dans l'identifiant : un témoin doit pouvoir distinguer la ligne
            // choisie des autres, et le « ✓ » est un texte de nœud parmi d'autres.
            .reperes(
                identifiant = identifiant + if (choisie) ".on" else ".off",
                description = if (choisie) "$libelle, choisi" else libelle,
            )
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(libelle, color = couleurs.encre, fontSize = 15.sp)
        Box(Modifier.weight(1f))
        if (choisie) {
            Text("✓", color = couleurs.accentTexte, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Vignette(cas: Apparence, choisie: Boolean, surClic: () -> Unit) {
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
                identifiant = "tile.apparence." + cas.cle + if (choisie) ".on" else ".off",
                description = if (choisie) "${cas.libelle}, choisi" else cas.libelle,
            )
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val teinte = if (choisie) couleurs.accentTexte else couleurs.attenue
        Text(cas.symbole, color = teinte, fontSize = 19.sp)
        Text(cas.libelle, color = teinte, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

/**
 * GhostPass est-il le service de remplissage de cet appareil ?
 *
 * `null` quand l'appareil est trop ancien : le cadre de remplissage d'Android date de
 * l'API 26, et le `minSdk` du produit est 24. Trois états et non deux — répondre « non »
 * sur un appareil qui ne peut pas répondre enverrait chercher un réglage inexistant.
 */
private fun remplissageActif(contexte: android.content.Context): Boolean? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val gestionnaire = contexte.getSystemService(AutofillManager::class.java) ?: return null
    return runCatching { gestionnaire.hasEnabledAutofillServices() }.getOrNull()
}

private fun ouvrirLesReglagesDeRemplissage(contexte: android.content.Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    // L'écran dédié d'abord ; à défaut, celui des réglages de l'application. Les deux
    // peuvent manquer selon le constructeur, et une intention non résolue ferait planter
    // l'application au lieu de ne rien faire.
    val candidats = listOf(
        Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE)
            .setData(android.net.Uri.parse("package:" + contexte.packageName)),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(android.net.Uri.parse("package:" + contexte.packageName)),
    )
    for (intention in candidats) {
        if (runCatching { contexte.startActivity(intention) }.isSuccess) return
    }
}

/**
 * **Les deux sections d'iOS qui ne sont pas ici, et pourquoi.**
 *
 * Ce n'est pas un oubli, et le nommer vaut mieux que de laisser le prochain lecteur
 * comparer les deux écrans en se demandant ce qui a été perdu.
 *
 *  - **Langue.** iOS propose « Système / Français / English » parce qu'il a un catalogue de
 *    traductions. Android n'en a aucun : toutes ses chaînes sont en français, dans le code
 *    ou dans `values/`. Une liste qui ne proposerait que « Français » ne commanderait rien.
 *    Y ajouter « English » serait pire : le réglage se cocherait et l'écran resterait en
 *    français — un réglage qui ment est pire qu'un réglage absent. **Ce qu'il faudrait** :
 *    sortir les chaînes du code vers `values/strings.xml`, ajouter `values-en/`, et poser
 *    les locales par `AppCompatDelegate.setApplicationLocales`.
 *
 *  - **Icônes des sites.** L'interrupteur d'iOS commande l'affichage des favicons, que le
 *    serveur relaie par `GET /api/icons?domain=…`. Android ne les affiche pas du tout : sa
 *    liste montre une initiale colorée. L'interrupteur n'aurait donc rien à éteindre.
 *    **Ce qu'il faudrait** : un chargeur d'images vers cette route, avec le jeton d'icônes,
 *    et un cache — puis l'interrupteur devient honnête.
 *
 * Les deux sont des fonctions à porter, pas des réglages à ajouter. Les inscrire ici avant
 * elles déplacerait l'échec du moment où l'on configure au moment où quelqu'un s'en sert.
 */
private object PourquoiPasDeLangueNiDIcones
