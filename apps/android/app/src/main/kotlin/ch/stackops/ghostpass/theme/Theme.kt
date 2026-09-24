package ch.stackops.ghostpass.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Le système visuel néon de la suite, porté depuis `apps/ios/Ghostpass/Theme/Theme.swift`.
 *
 * La structure est commune à tous les produits : une base sombre dérivée de Dracula, des
 * surfaces de verre fumé, et un halo coloré diffusé depuis le haut. Ce qui les distingue
 * est leur teinte néon, celle de leur logo — pour GhostPass, le **bleu `#2E7DFF`**.
 *
 * Le néon n'est pas dans la couleur mais dans son rayonnement : deux halos superposés,
 * l'un serré et vif, l'autre large et discret. Voir [neon].
 *
 * **Ce fichier ne reprend pas seulement la palette, mais le langage visuel.** C'est la
 * règle §10 du brief, et elle vient d'un retour de Clara sur le portage Flutter de
 * GhostCal — « oh c'est moche comparé à l'app de ghostpass ». Reprendre les couleurs sans
 * les formes donne des composants Material simplement recolorés, et ça se voit
 * immédiatement : c'est le rayon des cartes, l'épaisseur du filet, la surface creusée des
 * champs et le halo des boutons qui font l'identité, pas le bleu.
 */

// ─── Base sombre commune à la suite (Dracula) ───

private val BaseSombre = Color(0xFF21222C)
private val BaseClair = Color(0xFFF5F8FC)
private val SurfaceSombre = Color(0xFF282A36)
private val SurfaceClair = Color(0xFFFFFFFF)
private val Surface2Sombre = Color(0xFF323445)
private val Surface2Clair = Color(0xFFEEF3F9)
private val EncreSombre = Color(0xFFF8F8F2)
private val EncreClair = Color(0xFF0F1B2D)
private val AttenueSombre = Color(0xFF8B9CC8)
private val AttenueClair = Color(0xFF5B6B82)

// ─── Teinte de marque : bleu néon ───

private val AccentSombre = Color(0xFF2E7DFF)
private val AccentClair = Color(0xFF1A4FCC)
private val AccentTexteSombre = Color(0xFF7FB2FF)
private val AccentTexteClair = Color(0xFF1A4FCC)

/**
 * La teinte du halo. **Fixe** : un néon garde sa couleur, c'est ce qui le fait lire comme
 * une source lumineuse plutôt que comme une ombre portée teintée.
 */
val Neon = Color(0xFF2E7DFF)

private val DangerSombre = Color(0xFFFF5555)
private val DangerClair = Color(0xFFD11F45)
private val SuccesSombre = Color(0xFF50FA7B)
private val SuccesClair = Color(0xFF15803D)

/** Les couleurs du produit, au-delà de ce que porte [MaterialTheme]. */
data class CouleursGhost(
    val base: Color,
    val surface: Color,
    val surface2: Color,
    val encre: Color,
    val attenue: Color,
    val accent: Color,
    val accentTexte: Color,
    val surAccent: Color,
    val bordure: Color,
    val bordureForte: Color,
    val danger: Color,
    val succes: Color,
    val sombre: Boolean,
)

val LocalCouleurs = staticCompositionLocalOf {
    couleursDe(sombre = true)
}

private fun couleursDe(sombre: Boolean) = CouleursGhost(
    base = if (sombre) BaseSombre else BaseClair,
    surface = if (sombre) SurfaceSombre else SurfaceClair,
    surface2 = if (sombre) Surface2Sombre else Surface2Clair,
    encre = if (sombre) EncreSombre else EncreClair,
    attenue = if (sombre) AttenueSombre else AttenueClair,
    accent = if (sombre) AccentSombre else AccentClair,
    accentTexte = if (sombre) AccentTexteSombre else AccentTexteClair,
    surAccent = Color.White,
    bordure = if (sombre) Color.White.copy(alpha = 0.08f) else Color(0xFF0F172A).copy(alpha = 0.10f),
    bordureForte = if (sombre) Color.White.copy(alpha = 0.16f) else Color(0xFF0F172A).copy(alpha = 0.16f),
    danger = if (sombre) DangerSombre else DangerClair,
    succes = if (sombre) SuccesSombre else SuccesClair,
    sombre = sombre,
)

/**
 * Mesures partagées, relevées dans `suite/docs/charte-mobile.md` §5.
 *
 * **Les jetons de `ghost-theme.css` font foi, pas l'implémentation d'iOS.** La charte le
 * dit d'expérience : sa première version avait été écrite en observant GhostPass iOS, qui
 * avait dérivé du web — cartes à 16 au lieu de 18 — et un document écrit en observant une
 * implémentation ne fait que graver sa dérive. Les valeurs ci-dessous viennent donc du CSS.
 *
 * Trois rayons distincts, et l'écart entre eux est délibéré : **un champ moins arrondi
 * qu'un bouton creuse la hiérarchie** entre ce qu'on remplit et ce sur quoi on appuie.
 * Les aplatir sur une seule valeur ferait disparaître cette lecture.
 */
object GP {
    /** `--radius-sm` : les champs de saisie. */
    val rayonChamp: Dp = 8.dp

    /**
     * `--radius` : les boutons.
     *
     * **Pas `--radius-pill`**, et c'est une exception assumée de la charte (§5, §7) : le web
     * arrondit ses boutons en pilule, iOS les garde rectangulaires parce que sa barre de
     * recherche appartient au système et ne peut pas devenir une pilule. Android reprend le
     * rectangle — non par imitation d'iOS, mais parce que le champ de recherche de Material
     * n'est pas une pilule non plus, et qu'un bouton en pilule posé à côté jurerait de la
     * même façon. Le motif est le même ; il a été revérifié plutôt que transposé.
     */
    val rayon: Dp = 12.dp

    /** `--radius-lg` : les cartes. */
    val rayonCarte: Dp = 18.dp

    val ecart: Dp = 12.dp
    val marge: Dp = 16.dp
    /** Marge intérieure d'une carte — absente du CSS, propre au mobile. */
    val margeCarte: Dp = 24.dp
    /** Écart entre deux champs. */
    val ecartChamps: Dp = 18.dp
    /** Écart d'un libellé à son champ. */
    val ecartLibelle: Dp = 7.dp
    /** Au-delà, sur tablette, les champs s'étirent et le formulaire perd sa forme. */
    val largeurMax: Dp = 420.dp
}

/**
 * **`testTagsAsResourceId` est posé ici, et c'est ce qui rend les `testTag` observables.**
 *
 * Sans ce drapeau, un `testTag` n'existe que pour les tests Compose ; il ne remonte dans
 * l'arbre d'accessibilité d'Android ni pour UiAutomator, ni pour `uiautomator dump`. Avec
 * lui, chaque `testTag` devient le `resource-id` du nœud — un champ qui **ne se prononce
 * pas**, et que `By.res` sait lire.
 *
 * Il est posé à la racine du thème plutôt qu'à chaque activité : les deux activités du
 * produit — l'écran principal et celui du remplissage — passent par ici, et l'oublier dans
 * l'une des deux rendrait ses témoins aveugles **sans rien afficher d'anormal**. C'est
 * exactement la classe de panne silencieuse qu'on cherche à éviter : un témoin qui ne
 * trouve plus rien accuse le produit.
 *
 * ## Vérifié à l'écran, et le premier contrôle mentait
 *
 * `uiautomator dump` montre bien les `resource-id` — le `FLAG_SECURE` du produit noircit les
 * captures d'image, pas l'arbre d'accessibilité. Le premier dépouillement n'en a pourtant
 * montré aucun, et la conclusion « le drapeau ne se propage pas aux descendants » était
 * fausse : **l'APK installé était périmé**. `:app:assembleDebugAndroidTest` compile bien le
 * paquet de test, mais ne reconstruit pas `app-debug.apk` ; l'installer après lui revient à
 * mesurer le code d'avant.
 *
 * Ce n'est pas une anecdote de construction, c'est l'instrument qui n'a pas su rougir : il a
 * rendu un arbre parfaitement bien formé, d'une application parfaitement lancée, et rien
 * dans sa sortie ne disait de quelle version. Reconstruire explicitement et regarder
 * l'horodatage de l'APK avant de l'installer coûte une ligne.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun ThemeGhostPass(
    sombre: Boolean = isSystemInDarkTheme(),
    contenu: @Composable () -> Unit,
) {
    val couleurs = couleursDe(sombre)
    // On suit le réglage du système plutôt que d'imposer l'un des deux thèmes, comme sur le
    // web et sur iOS.
    val schema = if (sombre) {
        darkColorScheme(
            primary = couleurs.accent,
            onPrimary = couleurs.surAccent,
            background = couleurs.base,
            surface = couleurs.surface,
            onSurface = couleurs.encre,
            error = couleurs.danger,
        )
    } else {
        lightColorScheme(
            primary = couleurs.accent,
            onPrimary = couleurs.surAccent,
            background = couleurs.base,
            surface = couleurs.surface,
            onSurface = couleurs.encre,
            error = couleurs.danger,
        )
    }
    CompositionLocalProvider(LocalCouleurs provides couleurs) {
        MaterialTheme(colorScheme = schema) {
            Box(Modifier.semantics { testTagsAsResourceId = true }) { contenu() }
        }
    }
}

/**
 * Le fond de l'application : nuit profonde et halo néon diffusé depuis le haut — la lueur
 * du fantôme, qui donne sa profondeur à l'ensemble sans rien coûter en lisibilité.
 *
 * Le dégradé du fond est celui de la suite : quatre arrêts, teintés de la couleur de
 * marque, qui empêchent le noir d'être plat. Le halo est un dégradé radial centré en haut,
 * flouté — c'est lui qui distingue cet écran d'un fond uni sombre.
 */
@Composable
fun FondGhost(modifier: Modifier = Modifier) {
    val couleurs = LocalCouleurs.current
    val fond = if (couleurs.sombre) {
        Brush.verticalGradient(
            listOf(
                Color(0xFF080D18), Color(0xFF0A1220),
                Color(0xFF080F1A), Color(0xFF090A10),
            ),
        )
    } else {
        Brush.verticalGradient(listOf(couleurs.base, couleurs.base))
    }
    Box(modifier.fillMaxSize().background(fond)) {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(bottom = 0.dp)
                .background(
                    Brush.radialGradient(
                        colors = listOf(
                            Neon.copy(alpha = if (couleurs.sombre) 0.26f else 0.12f),
                            Color.Transparent,
                        ),
                        center = Offset(0.5f, 0f),
                        radius = 900f,
                    ),
                )
                .blur(40.dp),
        )
    }
}

/**
 * Carte de verre fumé : la surface translucide, bordée d'un filet clair.
 *
 * L'opacité de 0,65 n'est pas un détail : c'est ce qui laisse transparaître le halo du
 * fond et fait lire la carte comme posée *sur* quelque chose. Une surface opaque donnerait
 * une boîte, et l'écran d'entrée ressemblerait à n'importe quel formulaire.
 *
 * **Écart avec la charte §4, assumé et à inscrire au tableau §7 : le flou d'arrière-plan
 * manque.** SwiftUI le donne (`.ultraThinMaterial`) ; Compose n'a aucun équivalent. Son
 * `Modifier.blur` floute le composant *lui-même*, pas ce qui est derrière — l'appliquer ici
 * rendrait les champs illisibles au lieu d'adoucir le fond. Un vrai flou d'arrière-plan
 * demande `RenderEffect`, disponible seulement à partir de l'API 31, alors que le `minSdk`
 * du produit est 24 ; le faire dépendre de la version donnerait deux apparences selon
 * l'appareil, ce qui est pire qu'une seule apparence assumée.
 *
 * Ce que la charte redoute — « sans lui la carte n'est qu'un rectangle gris » — est
 * partiellement évité ici parce que le fond n'est pas uni : c'est un dégradé portant un
 * halo radial, et la translucidité en laisse voir la variation. La carte lit donc comme une
 * surface posée sur une lueur, à défaut de lire comme du verre.
 */
@Composable
fun Modifier.carteDeVerre(marge: Dp = GP.margeCarte): Modifier {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonCarte)
    return this
        .background(couleurs.surface.copy(alpha = 0.65f), forme)
        .border(1.dp, couleurs.bordure, forme)
        .padding(marge)
}

/**
 * Champ de saisie : surface creusée, bordure discrète, au rayon des **champs** (8).
 *
 * Moins arrondi que les boutons (12), délibérément : c'est ce qui distingue à l'œil ce
 * qu'on remplit de ce sur quoi on appuie.
 */
@Composable
fun Modifier.champGhost(): Modifier {
    val couleurs = LocalCouleurs.current
    val forme = RoundedCornerShape(GP.rayonChamp)
    return this
        .background(couleurs.surface2, forme)
        .border(1.dp, couleurs.bordure, forme)
}

/** La famille de caractères arrondie de l'enseigne, comme le `design: .rounded` d'iOS. */
val PoliceArrondie = FontFamily.SansSerif

/**
 * Fait rayonner un élément dans la teinte de la marque.
 *
 * Transposition du `--brand-glow` partagé — `drop-shadow(0 0 8px …0.6)` puis
 * `drop-shadow(0 0 20px …0.35)`. **Les deux comptent** : un seul halo fait une tache molle,
 * tandis que la superposition d'un noyau net et d'une aura étalée est ce qui donne
 * l'impression d'une source de lumière. Le rayon est réduit en thème clair, où un néon sur
 * fond blanc devient une bavure.
 *
 * Dessiné à la main plutôt que confié à `Modifier.shadow` : les couleurs d'ombre de Compose
 * ne sont honorées qu'à partir de l'API 28, et le `minSdk` du produit est 24. Sur un
 * appareil ancien, `shadow` aurait rendu une ombre grise — c'est-à-dire de la saleté sous
 * un bouton, là où on voulait de la lumière autour. Personne ne l'aurait vu depuis un
 * émulateur récent.
 */
@Composable
fun Modifier.neon(force: Float = 1f, rayon: Dp = GP.rayon): Modifier {
    val couleurs = LocalCouleurs.current
    val echelle = if (couleurs.sombre) force else force * 0.45f
    if (echelle <= 0f) return this
    return this.drawBehind {
        val forme = androidx.compose.ui.geometry.Size(size.width, size.height)
        // L'aura large et discrète, puis le noyau serré et vif, dans cet ordre : le second
        // se pose sur le premier.
        for ((etalement, opacite) in listOf(20.dp to 0.35f, 8.dp to 0.60f)) {
            val marge = etalement.toPx() * echelle
            drawRoundRect(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Neon.copy(alpha = opacite * echelle),
                        Color.Transparent,
                    ),
                    center = androidx.compose.ui.geometry.Offset(
                        forme.width / 2f, forme.height / 2f),
                    radius = (maxOf(forme.width, forme.height) / 2f) + marge,
                ),
                topLeft = androidx.compose.ui.geometry.Offset(-marge, -marge),
                size = androidx.compose.ui.geometry.Size(
                    forme.width + marge * 2, forme.height + marge * 2),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(
                    (rayon.toPx() + marge)),
            )
        }
    }
}
