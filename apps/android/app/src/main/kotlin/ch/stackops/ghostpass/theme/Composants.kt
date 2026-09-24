package ch.stackops.ghostpass.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.height
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/**
 * Les composants du langage visuel de la suite.
 *
 * Portés de `Theme.swift`, pas approchés : ce sont eux qui font que l'application est le
 * petit frère de celle d'iOS plutôt qu'un cousin (§10).
 */

/**
 * Les deux repères d'un composant — et les confondre a coûté une icône.
 *
 * `identifiant` est ce par quoi un témoin **désigne** le composant ; `description` est ce
 * qu'un lecteur d'écran **prononce**. Ils logeaient au même endroit : la
 * `contentDescription` portait l'identifiant. Un composant ne pouvait donc pas avoir les
 * deux à la fois — lui donner une voix lui faisait perdre son nom de témoin, et garder son
 * nom de témoin le faisait annoncer « button.biometric » à haute voix.
 *
 * Le blocage était visible à l'écran : iOS pose sur son bouton biométrique une **icône
 * seule**, dont le nom parlé (« Déverrouiller avec Face ID ») est distinct de
 * l'identifiant de test. Android ne pouvait pas le suivre, et affichait un libellé en
 * toutes lettres à la place.
 *
 * `testTag` est l'emplacement prévu pour le premier. Le drapeau `testTagsAsResourceId`,
 * posé une fois à la racine du thème (voir [ThemeGhostPass]), le fait remonter dans l'arbre
 * d'accessibilité comme `resource-id` — un champ qu'UiAutomator lit par `By.res`, et qui
 * **ne se prononce pas**. Les deux repères redeviennent indépendants.
 */
fun Modifier.reperes(identifiant: String?, description: String? = null): Modifier = this
    .then(if (identifiant != null) Modifier.testTag(identifiant) else Modifier)
    .then(
        if (description != null) {
            Modifier.semantics { contentDescription = description }
        } else {
            Modifier
        },
    )

/**
 * Action principale : un bloc d'accent plein, pleine largeur, qui **rayonne**.
 *
 * Seule l'action disponible rayonne. Faire luire un bouton inerte reviendrait à appeler
 * l'œil vers ce sur quoi on ne peut pas appuyer.
 */
@Composable
fun BoutonPrincipal(
    texte: String,
    actif: Boolean,
    occupe: Boolean = false,
    identifiant: String? = null,
    description: String? = null,
    onClick: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val interactions = remember { MutableInteractionSource() }
    val presse by interactions.collectIsPressedAsState()
    val forme = RoundedCornerShape(GP.rayon)
    val opacite = if (actif) (if (presse) 0.8f else 1f) else 0.35f

    Box(
        Modifier
            .fillMaxWidth()
            .neon(if (actif) (if (presse) 0.5f else 0.85f) else 0f)
            .background(couleurs.accent.copy(alpha = opacite), forme)
            .clickable(
                interactionSource = interactions,
                indication = null,
                enabled = actif && !occupe,
                onClick = onClick,
            )
            .padding(vertical = 14.dp)
            .reperes(identifiant, description),
        contentAlignment = Alignment.Center,
    ) {
        if (occupe) {
            CircularProgressIndicator(
                Modifier.padding(0.dp),
                color = couleurs.surAccent,
                strokeWidth = 2.dp,
            )
        } else {
            Text(
                texte,
                color = couleurs.surAccent,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Action secondaire : le même bloc, mais creusé plutôt que plein.
 *
 * `contenu` remplace le texte quand le geste se reconnaît mieux à un symbole qu'il ne se
 * lit — le bouton biométrique d'iOS, qui porte une icône seule. Le bouton garde alors sa
 * forme, sa surface et sa zone de toucher ; seul ce qu'il montre change. `texte` reste
 * exigé parce qu'il sert de repli : un composant qui n'aurait *que* son icône n'aurait
 * rien à dire si l'icône venait à manquer, et une icône absente se lit comme un bouton
 * vide plutôt que comme un défaut.
 */
@Composable
fun BoutonSecondaire(
    texte: String,
    actif: Boolean = true,
    destructif: Boolean = false,
    identifiant: String? = null,
    description: String? = null,
    contenu: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    val interactions = remember { MutableInteractionSource() }
    val presse by interactions.collectIsPressedAsState()
    val forme = RoundedCornerShape(GP.rayon)

    Box(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface2.copy(alpha = if (presse) 0.6f else 1f), forme)
            .border(1.dp, couleurs.bordure, forme)
            .clickable(
                interactionSource = interactions,
                indication = null,
                enabled = actif,
                onClick = onClick,
            )
            .padding(vertical = 12.dp)
            .reperes(identifiant, description),
        contentAlignment = Alignment.Center,
    ) {
        if (contenu != null) {
            contenu()
        } else {
            Text(
                texte,
                // Le rôle décide de la couleur. Le lire ici plutôt qu'à chaque appel corrige
                // la classe entière, y compris les boutons qui n'existent pas encore : côté
                // iOS, « Supprimer ce groupe » portait bien un rôle destructif et s'affichait
                // en bleu, parce qu'un style personnalisé écrase le rendu que le système donne
                // au rôle. Le défaut paraît juste à la lecture et faux à l'écran.
                color = if (destructif) couleurs.danger else couleurs.accentTexte,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

/** Un lien discret, en pied de carte. */
@Composable
fun LienDiscret(
    texte: String,
    actif: Boolean = true,
    identifiant: String? = null,
    // Le placement appartient à l'appelant, pas au composant : un lien posé dans une carte
    // et un lien posé en pleine page n'ont pas la même marge, et coder l'une des deux ici
    // obligerait l'autre à la défaire.
    modifierExterne: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = if (actif) couleurs.accentTexte else couleurs.attenue,
        fontSize = 13.sp,
        modifier = modifierExterne
            .clickable(enabled = actif, onClick = onClick)
            .padding(top = 2.dp)
            .reperes(identifiant),
    )
}

/**
 * Intitulé de section : petites capitales espacées, comme sur le web et sur iOS.
 */
@Composable
fun IntituleDeSection(texte: String) {
    val couleurs = LocalCouleurs.current
    Text(
        texte.uppercase(),
        color = couleurs.attenue,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp,
    )
}

/**
 * Un champ : son intitulé en petites capitales, puis la saisie sur surface creusée.
 *
 * `TextFieldDefaults` est vidé de ses indicateurs : le soulignement de Material est
 * exactement ce qui trahirait un composant du système simplement recoloré (§10).
 */
@Composable
fun ChampGhost(
    intitule: String,
    valeur: String,
    invite: String,
    identifiant: String? = null,
    secret: Boolean = false,
    typeDeClavier: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Column(verticalArrangement = Arrangement.spacedBy(GP.ecartLibelle)) {
        // Un intitulé vide **n'affiche rien**, plutôt qu'une ligne vide. Le cas se présente
        // quand le champ vit déjà dans une section qui porte son nom : répéter « Mot de
        // passe maître » juste au-dessus du champ du même nom fait lire deux réglages là
        // où il n'y en a qu'un.
        if (intitule.isNotBlank()) IntituleDeSection(intitule)
        TextField(
            value = valeur,
            onValueChange = onChange,
            singleLine = true,
            visualTransformation =
                if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = typeDeClavier),
            placeholder = {
                // Le gris par défaut disparaît sur nos surfaces : l'invite se pose à la
                // teinte atténuée du thème, adoucie.
                Text(invite, color = couleurs.attenue.copy(alpha = 0.7f), fontSize = 15.sp)
            },
            textStyle = LocalTextStyle.current.copy(color = couleurs.encre, fontSize = 15.sp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                cursorColor = couleurs.accentTexte,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .champGhost()
                .reperes(identifiant),
        )
    }
}

/** Une valeur qu'on montre sans pouvoir la modifier — le compte d'une session enregistrée. */
@Composable
fun ValeurFigee(intitule: String, valeur: String) {
    val couleurs = LocalCouleurs.current
    Column(verticalArrangement = Arrangement.spacedBy(GP.ecartLibelle)) {
        IntituleDeSection(intitule)
        Box(Modifier.fillMaxWidth().champGhost().padding(horizontal = 14.dp, vertical = 16.dp)) {
            Text(valeur, color = couleurs.attenue, style = TextStyle(fontSize = 15.sp))
        }
    }
}

/**
 * La carte d'une section — le `GhostSection` d'iOS, sans son intitulé.
 *
 * Opacité 0,7 comme là-bas, et non les 0,65 de `carteDeVerre` : une section de réglages
 * porte des lignes séparées par des filets, et le fond doit y être un peu plus posé que
 * sous un formulaire. L'écart vient d'iOS, où les deux existent déjà.
 */
@Composable
fun CarteDeSection(contenu: @Composable () -> Unit) {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonCarte)
    Box(
        Modifier
            .fillMaxWidth()
            .background(couleurs.surface.copy(alpha = 0.7f), forme)
            .border(1.dp, couleurs.bordure, forme),
    ) { contenu() }
}

/** Un filet de séparation entre deux lignes d'une même carte — le `GhostDivider` d'iOS. */
@Composable
fun FiletDeSection() {
    val couleurs = LocalCouleurs.current
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 14.dp)
            .height(1.dp)
            .background(couleurs.bordure),
    )
}

/**
 * Une section entière : son intitulé en petites capitales, sa carte, et sa note en pied.
 *
 * C'est le `GhostSection` d'iOS au complet. La **note compte autant que le reste** : c'est
 * elle qui dit pourquoi une liste est là — « Trop courts, ou faits d'une seule sorte de
 * caractères », « Seuls les cinq premiers caractères de l'empreinte sont envoyés ». Une
 * liste de noms sans sa note laisse deviner le critère, et on devine mal.
 */
@Composable
fun SectionGhost(
    titre: String? = null,
    note: String? = null,
    contenu: @Composable () -> Unit,
) {
    val couleurs = LocalCouleurs.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (titre != null) IntituleDeSection(titre)
        CarteDeSection { contenu() }
        if (note != null) {
            Text(
                note,
                color = couleurs.attenue,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 2.dp),
            )
        }
    }
}

/**
 * L'ossature d'un écran de la suite : le fond, le défilement, et les marges.
 *
 * Le `GhostScreen` d'iOS. Les trois valeurs — 20 de marge latérale, 22 entre sections, 40
 * en pied — viennent de là-bas ; la quatrième est propre à Android : **le pied est plus
 * généreux qu'il n'y paraît** parce que la navigation par gestes se réserve une bande en
 * bas d'écran et avale les touchers qui y tombent. Un bouton parfaitement visible y est
 * parfaitement inerte, et cela se lit comme une panne.
 */
@Composable
fun EcranGhost(
    identifiant: String? = null,
    contenu: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        FondGhost()
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 96.dp)
                .reperes(identifiant),
            verticalArrangement = Arrangement.spacedBy(22.dp),
            content = contenu,
        )
    }
}

/**
 * La barre d'une feuille modale : une action à gauche, le titre au centre, une à droite.
 *
 * Android n'a pas de barre de navigation modale, et `TopAppBar` de Material en donnerait
 * une qui ne ressemble à rien d'autre dans le produit (§10). Celle-ci est faite des mêmes
 * boutons que le reste.
 */
@Composable
fun BarreDeFeuille(
    titre: String,
    gauche: String,
    identifiantGauche: String,
    surGauche: () -> Unit,
    droite: String? = null,
    identifiantDroite: String? = null,
    droiteActive: Boolean = true,
    surDroite: () -> Unit = {},
) {
    val couleurs = LocalCouleurs.current
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.widthIn(max = 100.dp)) {
            BoutonSecondaire(gauche, identifiant = identifiantGauche) { surGauche() }
        }
        Text(
            titre,
            color = couleurs.encre,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f).padding(horizontal = 10.dp),
        )
        if (droite != null) {
            Box(Modifier.widthIn(max = 100.dp)) {
                BoutonSecondaire(
                    texte = droite,
                    actif = droiteActive,
                    identifiant = identifiantDroite,
                ) { surDroite() }
            }
        }
    }
}
