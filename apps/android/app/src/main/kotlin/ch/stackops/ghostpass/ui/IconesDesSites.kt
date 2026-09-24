package ch.stackops.ghostpass.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.stackops.ghostpass.CouleurDEquipe
import ch.stackops.ghostpass.IconeDeSite
import ch.stackops.ghostpass.theme.reperes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Les icônes des sites : un chargeur **entièrement en mémoire**, et la pastille qui s'en
 * sert.
 *
 * ## Pourquoi aucune bibliothèque d'images
 *
 * Coil, Glide et Picasso mettent en cache sur **disque par défaut**, et c'est exactement ce
 * qu'il ne faut pas ici. Les URL de cette route portent `?domain=github.com` : toute couche
 * qui les écrit sur le disque — cache HTTP, journal, index — transforme **la liste des
 * sites du coffre** en fichier lisible. Le coffre reste chiffré ; mais ce que le
 * chiffrement de bout en bout visait précisément à cacher — quels sites vous avez — cesse
 * de l'être.
 *
 * Purger à la déconnexion ne traiterait qu'un moment. La donnée sensible n'est ni dans le
 * corps ni chiffrable : elle est dans le **chemin**, et le chemin est ce que toute couche
 * journalise par défaut. C'est le raisonnement d'iOS, où l'application remplace le cache
 * d'URL global par `URLCache(memoryCapacity: 16 MiB, diskCapacity: 0)` — zéro disque, pas
 * un disque qu'on nettoie.
 *
 * Écrire le chargeur ici coûte une cinquantaine de lignes et ferme la classe entière : il
 * n'existe aucun chemin vers le disque, pas même celui qu'une mise à jour de dépendance
 * rallumerait sans qu'on la relise. `HttpURLConnection` n'a de cache sur disque que si l'on
 * installe un `HttpResponseCache` ; l'application n'en installe aucun, et `useCaches` est
 * mis à `false` de toute façon — une garantie qui ne dépend d'aucune absence.
 *
 * Le témoin `IconesSansDisqueTest` vérifie qu'après avoir affiché des logos, aucun fichier
 * du stockage de l'application ne nomme un domaine.
 */

/** Ce qu'on sait d'une icône. */
internal sealed interface EtatDIcone {
    /** La requête est partie, ou n'a pas encore été lancée. La pastille montre l'initiale. */
    data object Chargement : EtatDIcone

    /** Le serveur n'a rien — ou a refusé. On retombe sur l'initiale, sans un mot. */
    data object Absente : EtatDIcone

    data class Trouvee(val image: ImageBitmap) : EtatDIcone
}

/**
 * La mémoire des icônes. **Rien ici ne touche le disque.**
 *
 * La clé est le domaine et non l'URL : le jeton change à chaque rafraîchissement du coffre
 * ([IconeDeSite.cle] le dit), et une mémoire indexée dessus se viderait à chaque fois.
 *
 * Les échecs sont mémorisés au même titre que les succès. Sans cela, un site sans favicon
 * ferait repartir une requête à chaque défilement de la liste — une charge inutile, et un
 * domaine répété au serveur pour rien.
 *
 * `internal` et non `private` : `IconesSansDisqueTest` doit pouvoir faire **réellement**
 * passer une icône par ce chemin avant d'aller fouiller le stockage. Un témoin qui
 * simulerait le chargement ne prouverait rien du chargeur.
 */
internal object MemoireDesIcones {

    private const val TAILLE_MAX_OCTETS = 8 * 1024 * 1024
    private const val TAILLE_MAX_REPONSE = 512 * 1024

    private val cache = object : LruCache<String, EtatDIcone>(TAILLE_MAX_OCTETS) {
        override fun sizeOf(key: String, value: EtatDIcone): Int = when (value) {
            is EtatDIcone.Trouvee -> value.image.width * value.image.height * 4
            // Une absence pèse ce que pèse sa clé : assez pour être expulsée un jour, assez
            // peu pour que mille absences ne chassent pas une seule icône.
            else -> 64
        }
    }

    fun enMemoire(cle: String): EtatDIcone? = cache.get(cle)

    /** Oublie tout. Appelé au verrouillage et à la déconnexion : voir [oublierLesIcones]. */
    fun vider() = cache.evictAll()

    suspend fun charger(cle: String, url: String): EtatDIcone {
        enMemoire(cle)?.let { return it }
        val etat = withContext(Dispatchers.IO) { aller(url) }
        cache.put(cle, etat)
        return etat
    }

    private fun aller(url: String): EtatDIcone {
        var connexion: HttpURLConnection? = null
        return try {
            connexion = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 15_000
                // Explicite, et non par confiance dans l'absence d'un `HttpResponseCache` :
                // c'est la ligne qui dit *pourquoi* on ne cache pas, et celle qu'une
                // relecture verra. Voir l'en-tête de ce fichier.
                useCaches = false
            }
            val statut = connexion.responseCode
            // 401 (jeton mort), 404 (pas d'icône), 5xx : la liste reste lisible avec ses
            // initiales, et une bannière pour des logos serait du bruit. Le jeton, lui, se
            // redemande au rafraîchissement suivant — ce n'est pas à cet appel de le faire.
            if (statut !in 200..299) return EtatDIcone.Absente
            val octets = connexion.inputStream.use { flux ->
                // Borné : le relais sert des favicons, et une réponse démesurée n'aurait
                // aucune raison d'être décodée en mémoire.
                val tampon = flux.readBytes(TAILLE_MAX_REPONSE + 1)
                if (tampon.size > TAILLE_MAX_REPONSE) null else tampon
            } ?: return EtatDIcone.Absente
            val bitmap = BitmapFactory.decodeByteArray(octets, 0, octets.size)
                ?: return EtatDIcone.Absente
            EtatDIcone.Trouvee(bitmap.asImageBitmap())
        } catch (_: Exception) {
            EtatDIcone.Absente
        } finally {
            connexion?.disconnect()
        }
    }

    /** Lit au plus [max] octets, sans jamais allouer plus que ce qui arrive. */
    private fun java.io.InputStream.readBytes(max: Int): ByteArray {
        val sortie = java.io.ByteArrayOutputStream()
        val tampon = ByteArray(8 * 1024)
        while (sortie.size() <= max) {
            val lus = read(tampon)
            if (lus < 0) break
            sortie.write(tampon, 0, lus)
        }
        return sortie.toByteArray()
    }
}

/**
 * Vide la mémoire des icônes.
 *
 * Elle ne touche pas le disque, mais elle contient bel et bien la liste des sites du
 * coffre, sous forme de clés. Un coffre verrouillé ne doit rien laisser derrière lui —
 * c'est la même règle que pour les clés d'équipe.
 */
fun oublierLesIcones() = MemoireDesIcones.vider()

/**
 * Ce qu'il faut savoir pour demander une icône : le réglage, l'adresse du serveur, le
 * jeton.
 *
 * Passé par un `CompositionLocal` plutôt que par paramètre : la pastille est au fond de la
 * liste, et faire descendre trois valeurs à travers quatre composables pour une décoration
 * les ferait traverser aussi tous les écrans qui n'en ont que faire.
 *
 * Le défaut est **éteint** : un aperçu, ou un écran hors de l'activité principale —
 * l'activité de remplissage, par exemple — ne tire aucune requête sans qu'on l'ait voulu.
 */
data class ContexteDIcones(
    val actif: Boolean = false,
    val serveur: String = "",
    val jeton: String? = null,
)

val LocalIconesDesSites = compositionLocalOf { ContexteDIcones() }

/**
 * La pastille d'un élément : l'icône du site si on peut l'obtenir, sinon l'initiale sur
 * fond coloré — celui-ci se calcule sur l'appareil et ne demande rien à personne.
 *
 * La couleur de repli suit [CouleurDEquipe] : la même couleur pour le même nom sur les
 * trois clients, la somme des octets UTF-8 modulo huit. Aucun hachage de bibliothèque,
 * parce qu'aucun n'est garanti stable d'une exécution à l'autre.
 *
 * ## L'identifiant dit lequel des deux est affiché
 *
 * `FLAG_SECURE` rend toute capture noire : l'arbre d'accessibilité est le seul regard
 * possible sur cet écran. Un témoin qui ne pourrait pas distinguer un logo d'une initiale
 * ne pourrait pas non plus dire si la fonction marche — et le repli est justement ce qui
 * s'affiche quand elle ne marche pas. L'état entre donc dans le `testTag`, comme il le fait
 * déjà pour l'étoile des favoris.
 */
@Composable
fun PastilleDuSite(nom: String, adresse: String? = null, taille: Dp = 32.dp) {
    val contexte = LocalIconesDesSites.current
    val cle = if (contexte.actif && !adresse.isNullOrEmpty()) IconeDeSite.cle(adresse) else null
    val url = if (cle != null) {
        IconeDeSite.url(adresse!!, contexte.serveur, contexte.jeton)
    } else {
        null
    }

    // `remember(url)` : l'URL change quand le jeton se renouvelle, mais la mémoire est
    // indexée sur le domaine — la relecture retrouve donc l'icône sans repartir en réseau.
    var etat by remember(url) {
        mutableStateOf(
            if (url == null) EtatDIcone.Absente else MemoireDesIcones.enMemoire(cle!!)
                ?: EtatDIcone.Chargement,
        )
    }
    LaunchedEffect(url) {
        if (url != null && etat is EtatDIcone.Chargement) {
            etat = MemoireDesIcones.charger(cle!!, url)
        }
    }

    val trouvee = etat as? EtatDIcone.Trouvee
    val forme = RoundedCornerShape(taille * 0.31f)
    val argb = CouleurDEquipe.couleurArgb(CouleurDEquipe.attribuee(nom))!!
    Box(
        Modifier
            .size(taille)
            // Fond blanc sous une icône — beaucoup sont transparentes et taillées pour du
            // clair —, teinté sous une initiale.
            .background(
                if (trouvee != null) Color.White else Color(argb).copy(alpha = 0.9f),
                forme,
            )
            .reperes(
                identifiant = if (trouvee != null) "icon.site.logo" else "icon.site.initiale",
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (trouvee != null) {
            androidx.compose.foundation.Image(
                bitmap = trouvee.image,
                // L'image est décorative : le nom de l'élément est juste à côté, et le
                // lecteur d'écran le lit déjà. Une description ici le redirait deux fois.
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(taille * 0.18f),
            )
        } else {
            Text(
                IconeDeSite.initiale(nom),
                color = Color.White,
                fontSize = taille.value.times(0.44f).sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
