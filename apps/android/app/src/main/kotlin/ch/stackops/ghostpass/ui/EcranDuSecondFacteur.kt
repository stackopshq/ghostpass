package ch.stackops.ghostpass.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.ConfigurationDuSecondFacteur
import ch.stackops.ghostpass.ModeleDuCoffre
import ch.stackops.ghostpass.ModeleDuCoffre.EtatDuSecondFacteur
import ch.stackops.ghostpass.theme.BarreDeFeuille
import ch.stackops.ghostpass.theme.BoutonPrincipal
import ch.stackops.ghostpass.theme.BoutonSecondaire
import ch.stackops.ghostpass.theme.ChampGhost
import ch.stackops.ghostpass.theme.EcranGhost
import ch.stackops.ghostpass.theme.FiletDeSection
import ch.stackops.ghostpass.theme.LocalCouleurs
import ch.stackops.ghostpass.theme.SectionGhost
import ch.stackops.ghostpass.theme.carteDeVerre
import ch.stackops.ghostpass.theme.reperes

/**
 * Le second facteur du compte.
 *
 * **Il protège la connexion au serveur, pas le coffre lui-même** : celui-ci reste chiffré
 * par le mot de passe maître, que le serveur ne connaît pas. Quelqu'un qui volerait le
 * second facteur n'obtiendrait que des enveloppes illisibles — mais il obtiendrait aussi la
 * possibilité de les **effacer**, ce qui suffit à justifier cette protection.
 *
 * Porté de `apps/ios/Ghostpass/Views/MfaView.swift`, avec la correction que celui-ci a dû
 * faire : « chargement » et « indisponible » sont deux états distincts. Les aplatir faisait
 * tourner une roue indéfiniment dès que le serveur refusait la route.
 */
@Composable
fun EcranDuSecondFacteur(
    modele: ModeleDuCoffre,
    surFermer: () -> Unit,
) {
    var configuration by remember { mutableStateOf<ConfigurationDuSecondFacteur?>(null) }
    var confirme by remember { mutableStateOf(false) }
    var motDePasse by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { modele.lireLeSecondFacteur() }

    val etat = modele.secondFacteur
    EcranGhost(identifiant = "screen.mfa") {
        BarreDeFeuille(
            titre = "Second facteur",
            gauche = if (configuration == null || confirme) "Terminé" else "Annuler",
            identifiantGauche = "button.closeMfa",
            surGauche = surFermer,
        )

        when {
            // **L'ordre compte.** L'indisponibilité passe avant le chargement : un serveur
            // qui ne connaît pas la route a déjà répondu, et laisser tourner la roue
            // reviendrait à faire attendre quelque chose qui n'arrivera jamais.
            etat is EtatDuSecondFacteur.Indisponible -> Indisponible(etat.cause)
            etat is EtatDuSecondFacteur.EnLecture -> EnLecture()
            confirme -> Reussite()
            configuration != null -> AScanner(
                configuration = configuration!!,
                code = code,
                surCode = { code = it },
                actif = code.length == 6 && !modele.occupe,
                message = modele.message,
            ) {
                modele.confirmerLeSecondFacteur(code) { ok -> if (ok) confirme = true }
            }
            etat is EtatDuSecondFacteur.Lu && etat.actif -> Desactivation(
                motDePasse = motDePasse,
                code = code,
                surMotDePasse = { motDePasse = it },
                surCode = { code = it },
                actif = motDePasse.isNotEmpty() && code.length == 6 && !modele.occupe,
                message = modele.message,
            ) {
                modele.retirerLeSecondFacteur(motDePasse, code) { ok ->
                    if (ok) {
                        motDePasse = ""
                        code = ""
                    }
                }
            }
            else -> Activation(
                motDePasse = motDePasse,
                surMotDePasse = { motDePasse = it },
                actif = motDePasse.isNotEmpty() && !modele.occupe,
                message = modele.message,
            ) {
                modele.preparerLeSecondFacteur(motDePasse) { pret ->
                    if (pret != null) {
                        configuration = pret
                        motDePasse = ""
                    }
                }
            }
        }
    }
}

@Composable
private fun EnLecture() {
    val couleurs = LocalCouleurs.current
    Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = couleurs.accentTexte, strokeWidth = 2.dp)
    }
}

/**
 * Ce serveur ne propose pas la fonction.
 *
 * **Ce n'est pas une panne**, et le dire ainsi évite d'envoyer chercher un problème de
 * réseau qui n'existe pas. C'est l'état qu'iOS confondait avec le chargement.
 */
@Composable
private fun Indisponible(cause: String) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🔓", fontSize = 30.sp)
        Text(
            "Second facteur indisponible",
            color = couleurs.encre,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.reperes("text.mfaUnavailable"),
        )
        Text(cause, color = couleurs.attenue, fontSize = 13.sp)
    }
}

@Composable
private fun Activation(
    motDePasse: String,
    surMotDePasse: (String) -> Unit,
    actif: Boolean,
    message: String?,
    surConfigurer: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(marge = 14.dp),
    ) {
        Text(
            "🛡 Un code à six chiffres sera demandé à chaque connexion, en plus du mot de " +
                "passe maître.",
            color = couleurs.attenue,
            fontSize = 13.sp,
        )
    }

    SectionGhost(
        titre = "Mot de passe maître",
        note = "Il est vérifié sur cet appareil et n'en sort pas : le serveur n'en reçoit " +
            "qu'une empreinte.",
    ) {
        Box(Modifier.padding(14.dp)) {
            ChampGhost(
                // Sans intitulé : la section au-dessus porte déjà « Mot de passe maître ».
                intitule = "",
                valeur = motDePasse,
                invite = "Votre mot de passe",
                identifiant = "field.mfaMaster",
                secret = true,
                typeDeClavier = KeyboardType.Password,
                onChange = surMotDePasse,
            )
        }
    }

    BoutonPrincipal("Configurer", actif = actif, identifiant = "button.mfaSetup") {
        surConfigurer()
    }
    Erreur(message)
}

@Composable
private fun AScanner(
    configuration: ConfigurationDuSecondFacteur,
    code: String,
    surCode: (String) -> Unit,
    actif: Boolean,
    message: String?,
    surActiver: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val contexte = LocalContext.current
    var copie by remember { mutableStateOf(false) }

    SectionGhost(
        titre = "À enregistrer dans votre application d'authentification",
        note = "Ce secret ne sera plus affiché. Sans lui et sans votre application, la " +
            "connexion deviendra impossible — gardez un moyen de secours.",
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                configuration.secret,
                color = couleurs.encre,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                // À chasse fixe : un secret TOTP se recopie à la main, et distinguer un
                // « I » d'un « 1 » n'est pas optionnel.
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.reperes("text.mfaSecret"),
            )
            BoutonSecondaire(
                texte = if (copie) "Secret copié" else "Copier le secret",
                identifiant = "button.copyMfaSecret",
            ) {
                copierDansLePressePapiers(contexte, configuration.secret)
                copie = true
            }
        }
    }

    SectionGhost(
        titre = "Confirmer",
        note = "Tant que ce code n'est pas validé, le compte reste accessible sans second " +
            "facteur. C'est ce qui évite de s'enfermer dehors avec une application mal " +
            "configurée.",
    ) {
        Box(Modifier.padding(14.dp)) {
            ChampGhost(
                intitule = "",
                valeur = code,
                invite = "123456",
                identifiant = "field.mfaCode",
                typeDeClavier = KeyboardType.Number,
                onChange = surCode,
            )
        }
    }

    BoutonPrincipal("Activer", actif = actif, identifiant = "button.mfaActivate") { surActiver() }
    Erreur(message)
}

@Composable
private fun Reussite() {
    val couleurs = LocalCouleurs.current
    Column(
        Modifier.fillMaxWidth().carteDeVerre(),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(76.dp).background(couleurs.succes.copy(alpha = 0.14f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("✓", color = couleurs.succes, fontSize = 34.sp)
        }
        Text(
            "Le second facteur est actif.",
            color = couleurs.encre,
            fontSize = 16.sp,
            modifier = Modifier.reperes("text.mfaActive"),
        )
        Text(
            "Un code vous sera demandé à chaque connexion. Vos appareils déjà connectés le " +
                "restent.",
            color = couleurs.attenue,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun Desactivation(
    motDePasse: String,
    code: String,
    surMotDePasse: (String) -> Unit,
    surCode: (String) -> Unit,
    actif: Boolean,
    message: String?,
    surDesactiver: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth().carteDeVerre(marge = 14.dp).reperes("text.mfaEnabled"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("✓", color = couleurs.succes, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text("Le second facteur est actif sur ce compte.", color = couleurs.succes, fontSize = 13.sp)
    }

    SectionGhost(
        titre = "Le retirer",
        note = "Les deux sont exigés : le mot de passe maître et un code valide. Un " +
            "téléphone déverrouillé trouvé sur une table ne doit pas suffire à retirer la " +
            "protection.",
    ) {
        Column {
            Box(Modifier.padding(14.dp)) {
                ChampGhost(
                    intitule = "Mot de passe maître",
                    valeur = motDePasse,
                    invite = "Votre mot de passe",
                    identifiant = "field.mfaMasterOff",
                    secret = true,
                    typeDeClavier = KeyboardType.Password,
                    onChange = surMotDePasse,
                )
            }
            FiletDeSection()
            Box(Modifier.padding(14.dp)) {
                ChampGhost(
                    intitule = "Code à six chiffres",
                    valeur = code,
                    invite = "123456",
                    identifiant = "field.mfaCodeOff",
                    typeDeClavier = KeyboardType.Number,
                    onChange = surCode,
                )
            }
        }
    }

    BoutonSecondaire(
        texte = "Désactiver le second facteur",
        actif = actif,
        destructif = true,
        identifiant = "button.mfaDisable",
    ) { surDesactiver() }
    Erreur(message)
}

@Composable
private fun Erreur(message: String?) {
    val couleurs = LocalCouleurs.current
    if (message != null) {
        Text(
            "⚠ $message",
            color = couleurs.danger,
            fontSize = 12.sp,
            modifier = Modifier.reperes("text.mfaError"),
        )
    }
}

/**
 * Le secret dans le presse-papiers.
 *
 * `EXTRA_IS_SENSITIVE` demande à Android de **ne pas afficher l'aperçu** que les versions
 * récentes montrent après une copie. Sans lui, un secret TOTP s'affiche en grand au bas de
 * l'écran, par-dessus le `FLAG_SECURE` de l'application — qui ne protège que *nos* fenêtres,
 * pas la vignette du système.
 */
private fun copierDansLePressePapiers(contexte: Context, valeur: String) {
    val presse = contexte.getSystemService(ClipboardManager::class.java) ?: return
    val donnees = ClipData.newPlainText("", valeur)
    donnees.description.extras = android.os.PersistableBundle().apply {
        putBoolean("android.content.extra.IS_SENSITIVE", true)
    }
    presse.setPrimaryClip(donnees)
}
