package ch.stackops.ghostpass.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/**
 * Les composants du langage visuel de la suite.
 *
 * Portés de `Theme.swift`, pas approchés : ce sont eux qui font que l'application est le
 * petit frère de celle d'iOS plutôt qu'un cousin (§10).
 */

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
            .then(if (identifiant != null) Modifier.semantics { contentDescription = identifiant } else Modifier),
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

/** Action secondaire : le même bloc, mais creusé plutôt que plein. */
@Composable
fun BoutonSecondaire(
    texte: String,
    actif: Boolean = true,
    destructif: Boolean = false,
    identifiant: String? = null,
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
            .then(if (identifiant != null) Modifier.semantics { contentDescription = identifiant } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            texte,
            // Le rôle décide de la couleur. Le lire ici plutôt qu'à chaque appel corrige la
            // classe entière, y compris les boutons qui n'existent pas encore : côté iOS,
            // « Supprimer ce groupe » portait bien un rôle destructif et s'affichait en
            // bleu, parce qu'un style personnalisé écrase le rendu que le système donne au
            // rôle. Le défaut paraît juste à la lecture et faux à l'écran.
            color = if (destructif) couleurs.danger else couleurs.accentTexte,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

/** Un lien discret, en pied de carte. */
@Composable
fun LienDiscret(texte: String, actif: Boolean = true, identifiant: String? = null, onClick: () -> Unit) {
    val couleurs = LocalCouleurs.current
    Text(
        texte,
        color = if (actif) couleurs.accentTexte else couleurs.attenue,
        fontSize = 13.sp,
        modifier = Modifier
            .clickable(enabled = actif, onClick = onClick)
            .padding(top = 2.dp)
            .then(if (identifiant != null) Modifier.semantics { contentDescription = identifiant } else Modifier),
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
        IntituleDeSection(intitule)
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
                .then(
                    if (identifiant != null) {
                        Modifier.semantics { contentDescription = identifiant }
                    } else {
                        Modifier
                    },
                ),
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
