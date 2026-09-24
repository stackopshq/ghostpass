package ch.stackops.ghostpass

import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import ch.stackops.ghostpass.ui.EtatDIcone
import ch.stackops.ghostpass.ui.MemoireDesIcones
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import kotlin.concurrent.thread

/**
 * **Aucun fichier de l'application ne nomme un domaine du coffre.**
 *
 * Ce qui se joue. Les URL du relais d'icônes portent `?domain=github.com`. Toute couche qui
 * les écrit sur le disque — cache HTTP, journal, index de bibliothèque d'images —
 * transforme la **liste des sites du coffre** en fichier lisible. Le coffre reste chiffré,
 * mais ce que le chiffrement de bout en bout visait précisément à cacher — quels sites vous
 * avez — cesse de l'être. La donnée sensible n'est ni dans le corps ni chiffrable : elle est
 * dans le **chemin**, et le chemin est ce que toute couche journalise par défaut.
 *
 * Le témoin ne relit pas le code, il regarde le disque : il fait passer une icône par le
 * vrai chargeur, contre un vrai serveur, puis fouille tout le stockage de l'application —
 * noms **et** contenus. Une bibliothèque d'images ajoutée demain avec son cache par défaut
 * le ferait rougir sans qu'on ait à relire sa configuration.
 *
 * ## Il sait rougir, et le nom n'aurait pas suffi
 *
 * Mesuré, pas supposé. En installant un `HttpResponseCache` sur `cacheDir` **et** en
 * remettant `useCaches = true` dans le chargeur, le témoin tombe et nomme le fichier :
 *
 *     contenu : /data/user/0/ch.stackops.ghostpass/cache/http/f2f7eedab7882a0d08286ce612b8fc92.0
 *
 * Le nom de ce fichier est un MD5. **Chercher le domaine dans les noms de fichiers n'aurait
 * rien trouvé** — c'est le contrôle du *contenu* qui l'a vu, et c'est la raison pour
 * laquelle ce témoin lit les octets plutôt que l'arborescence. Une couche de cache nomme
 * ses entrées par empreinte et écrit l'URL à l'intérieur ; l'inverse serait une exception.
 *
 * La même expérience avec le seul `HttpResponseCache`, le chargeur laissé tel quel, reste
 * **verte** : c'est `useCaches = false` qui tient, et non l'absence d'un cache installé. La
 * garantie ne dépend donc pas de ce que fait le reste de l'application.
 *
 * ## Pourquoi un serveur dans le test
 *
 * Le chargeur doit **réellement** aller chercher des octets et les décoder, sinon l'absence
 * de trace sur le disque ne prouverait rien — un chargeur qui n'a rien chargé ne laisse rien
 * derrière lui. Le premier `assert` est donc là pour empêcher le témoin d'être vert pour la
 * mauvaise raison.
 */
class IconesSansDisqueTest {

    /**
     * Un domaine qui n'apparaît **nulle part ailleurs** dans l'application.
     *
     * « github.com » aurait pu venir d'un cache de coffre, d'une préférence ou d'un test
     * voisin : le témoin aurait accusé le chargeur d'une trace qui n'est pas la sienne.
     */
    private val domaine = "temoin-du-cache-d-icones.example"

    @Test
    fun aucunFichierDeLApplicationNeNommeUnDomaine() {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        val png = pngMinuscule()

        val serveur = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val fil = thread(isDaemon = true) { servirUneFois(serveur, png) }
        val url = try {
            val u = "http://127.0.0.1:${serveur.localPort}/api/icons" +
                "?domain=$domaine&t=jeton-du-temoin"

            val etat = runBlocking { MemoireDesIcones.charger(domaine, u) }
            // Sans ce premier contrôle, le témoin serait vert sur un chargeur qui ne
            // charge rien — le vert le plus trompeur qui soit.
            assertTrue(
                "Le chargeur n'a pas rendu d'image : le reste du témoin ne prouverait rien.",
                etat is EtatDIcone.Trouvee,
            )
            u
        } finally {
            runCatching { serveur.close() }
            fil.join(2_000)
        }

        // Tout ce que l'application peut écrire : caches, fichiers, préférences, code
        // compilé. `dataDir` les contient tous — on part de là plutôt que d'une liste de
        // sous-dossiers qui se périmerait.
        val racines = listOf(contexte.dataDir, contexte.cacheDir, contexte.filesDir)
            .filterNotNull()
            .distinct()

        val coupables = mutableListOf<String>()
        for (racine in racines) {
            racine.walkTopDown().filter { it.isFile }.forEach { fichier ->
                if (fichier.name.contains(domaine)) {
                    coupables += "nom : ${fichier.absolutePath}"
                } else if (contient(fichier, domaine)) {
                    coupables += "contenu : ${fichier.absolutePath}"
                }
            }
        }

        assertTrue(
            "Le domaine demandé est écrit sur le disque de l'application. " +
                "L'URL était « $url ».\n" + coupables.joinToString("\n"),
            coupables.isEmpty(),
        )
    }

    /** Le fichier contient-il ce texte ? Borné : on cherche une URL, pas une aiguille. */
    private fun contient(fichier: File, texte: String): Boolean {
        if (fichier.length() > 8L * 1024 * 1024) return false
        return try {
            // Latin-1 plutôt qu'UTF-8 : un binaire contenant des octets invalides en UTF-8
            // serait remplacé par des « ? » et la recherche raterait le texte qui l'entoure.
            fichier.readBytes().toString(Charsets.ISO_8859_1).contains(texte)
        } catch (_: Exception) {
            false
        }
    }

    /** Un PNG de huit pixels sur huit — de vrais octets, décodables par le chargeur. */
    private fun pngMinuscule(): ByteArray {
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(0xFF4C8DFF.toInt())
        val sortie = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, sortie)
        return sortie.toByteArray()
    }

    /** Une réponse, une seule : le chargeur ne demande qu'une icône. */
    private fun servirUneFois(serveur: ServerSocket, corps: ByteArray) {
        runCatching {
            serveur.accept().use { client ->
                val entree = client.getInputStream().bufferedReader()
                // On lit les en-têtes jusqu'à la ligne vide, sinon la pile refermerait la
                // connexion avant que la réponse ne soit lue.
                while (true) {
                    val ligne = entree.readLine() ?: break
                    if (ligne.isEmpty()) break
                }
                client.getOutputStream().apply {
                    write(
                        (
                            "HTTP/1.1 200 OK\r\n" +
                                "Content-Type: image/png\r\n" +
                                "Content-Length: ${corps.size}\r\n" +
                                "Cache-Control: private, max-age=86400\r\n" +
                                "Connection: close\r\n\r\n"
                            ).toByteArray()
                    )
                    write(corps)
                    flush()
                }
            }
        }
    }
}
