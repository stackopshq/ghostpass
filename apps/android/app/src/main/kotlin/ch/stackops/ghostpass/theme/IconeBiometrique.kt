package ch.stackops.ghostpass.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.stackops.ghostpass.BiometrieDeLAppareil.Genre

/**
 * L'icône du geste biométrique **attendu sur cet appareil**.
 *
 * C'est le pendant de `Image(systemName: store.biometryIcon)` d'iOS, qui choisit entre
 * `faceid`, `touchid` et un bouclier neutre. Android n'a ni catalogue de symboles du
 * système ni glyphe Unicode fiable pour l'empreinte digitale (voir
 * [ch.stackops.ghostpass.BiometrieDeLAppareil]) : les quatre formes sont donc tracées.
 *
 * Tracées plutôt qu'embarquées en vectoriel, et c'est un choix de taille : quatre glyphes
 * ne justifient pas `material-icons-extended`, qui pèse plusieurs mégaoctets. Tracées
 * plutôt qu'en police, parce qu'une police qui n'a pas le glyphe rend un rectangle vide
 * sans rien signaler — et un bouton d'entrée vide est la pire des deux issues.
 *
 * Elles ne portent **aucune** sémantique : le bouton qui les contient porte déjà son nom
 * parlé (« Déverrouiller avec … ») et son identifiant. Une icône qui s'annoncerait en plus
 * ferait entendre deux fois la même chose à un lecteur d'écran.
 */
@Composable
fun IconeBiometrique(
    genre: Genre,
    couleur: Color,
    taille: Dp = 22.dp,
    epaisseur: Dp = 1.8.dp,
) {
    Canvas(Modifier.size(taille)) {
        val trait = Stroke(width = epaisseur.toPx(), cap = StrokeCap.Round)
        val c = Offset(size.width / 2f, size.height / 2f)
        val r = size.minDimension / 2f

        when (genre) {
            // Trois arcs concentriques ouverts vers le bas et une crête centrale : la
            // lecture d'une empreinte tient à ce que les courbes soient **incomplètes**.
            // Des cercles entiers se liraient comme une cible.
            Genre.EMPREINTE -> {
                for ((facteur, balayage) in listOf(0.95f to 200f, 0.62f to 230f, 0.3f to 260f)) {
                    val rayon = r * facteur
                    drawArc(
                        color = couleur,
                        startAngle = 180f - (balayage - 180f) / 2f,
                        sweepAngle = balayage,
                        useCenter = false,
                        topLeft = Offset(c.x - rayon, c.y - rayon),
                        size = Size(rayon * 2, rayon * 2),
                        style = trait,
                    )
                }
                drawLine(couleur, Offset(c.x, c.y - r * 0.1f), Offset(c.x, c.y + r * 0.5f), trait.width, StrokeCap.Round)
            }

            // Le cadre d'encadrement de Face ID : quatre coins, jamais un rectangle
            // fermé — c'est l'ouverture des côtés qui dit « on vous cadre » plutôt que
            // « voici une boîte ». Deux yeux et une bouche à l'intérieur.
            Genre.VISAGE -> {
                val d = r * 0.95f
                val coin = d * 0.45f
                val chemin = Path()
                for ((sx, sy) in listOf(-1f to -1f, 1f to -1f, 1f to 1f, -1f to 1f)) {
                    val x = c.x + sx * d
                    val y = c.y + sy * d
                    chemin.moveTo(x - sx * coin, y)
                    chemin.lineTo(x, y)
                    chemin.lineTo(x, y - sy * coin)
                }
                drawPath(chemin, couleur, style = trait)
                for (sx in listOf(-1f, 1f)) {
                    drawLine(
                        couleur,
                        Offset(c.x + sx * r * 0.32f, c.y - r * 0.32f),
                        Offset(c.x + sx * r * 0.32f, c.y - r * 0.05f),
                        trait.width, StrokeCap.Round,
                    )
                }
                drawArc(
                    color = couleur,
                    startAngle = 25f,
                    sweepAngle = 130f,
                    useCenter = false,
                    topLeft = Offset(c.x - r * 0.42f, c.y - r * 0.2f),
                    size = Size(r * 0.84f, r * 0.7f),
                    style = trait,
                )
            }

            // L'amande de l'œil et sa pupille.
            Genre.IRIS -> {
                val amande = Path().apply {
                    moveTo(c.x - r, c.y)
                    quadraticTo(c.x, c.y - r * 0.95f, c.x + r, c.y)
                    quadraticTo(c.x, c.y + r * 0.95f, c.x - r, c.y)
                }
                drawPath(amande, couleur, style = trait)
                drawCircle(couleur, radius = r * 0.3f, center = c, style = trait)
            }

            // Un bouclier : il dit « sécurité » sans promettre un geste qu'on n'a pas su
            // lire. C'est le `lock.shield` d'iOS, et la même honnêteté.
            Genre.PLUSIEURS, Genre.INCONNU -> {
                val l = r * 0.8f
                val h = r * 0.95f
                val bouclier = Path().apply {
                    moveTo(c.x, c.y - h)
                    lineTo(c.x + l, c.y - h * 0.55f)
                    lineTo(c.x + l, c.y + h * 0.05f)
                    // La pointe basse : c'est elle qui distingue un bouclier d'un écusson.
                    quadraticTo(c.x + l * 0.8f, c.y + h * 0.8f, c.x, c.y + h)
                    quadraticTo(c.x - l * 0.8f, c.y + h * 0.8f, c.x - l, c.y + h * 0.05f)
                    lineTo(c.x - l, c.y - h * 0.55f)
                    close()
                }
                drawPath(bouclier, couleur, style = trait)
            }
        }
    }
}
