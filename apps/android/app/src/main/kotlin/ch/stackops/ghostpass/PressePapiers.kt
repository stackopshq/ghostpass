package ch.stackops.ghostpass

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle

/**
 * Copie de secrets dans le presse-papiers, **toujours avec une échéance**.
 *
 * Pendant de `apps/ios/Ghostpass/Services/Clipboard.swift`. Le presse-papiers est lisible
 * par l'application au premier plan et, selon l'appareil, synchronisé ailleurs : un mot de
 * passe qui y reste jusqu'à la prochaine copie est un mot de passe posé sur la table.
 *
 * Deux protections, et aucune ne suffit seule :
 *
 *  - `IS_SENSITIVE` : Android 13 et suivants n'affichent pas l'aperçu de la copie, qui
 *    sinon montre le secret en grand, par-dessus le `FLAG_SECURE` de l'application ;
 *  - l'**effacement après [DUREE_S] secondes**, que le système ne fait pas pour nous.
 *
 * **L'effacement ne vérifie pas toujours que la copie est encore la nôtre.** Depuis
 * Android 10, une application en arrière-plan ne peut plus lire le presse-papiers — or
 * c'est précisément là qu'on est, puisqu'on vient de copier pour coller ailleurs. Quand on
 * peut lire, on n'efface que notre propre copie ; quand on ne peut pas, on efface : perdre
 * une copie faite dans les trente secondes coûte moins qu'un secret qui reste.
 */
object PressePapiers {

    /** Trente secondes : le temps de coller, pas celui d'oublier. Le chiffre d'iOS. */
    const val DUREE_S = 30

    /** L'étiquette qui reconnaît nos copies quand le système nous laisse les relire. */
    private const val ETIQUETTE = "ghostpass"

    private val principal = Handler(Looper.getMainLooper())
    private var effacement: Runnable? = null

    fun copier(contexte: Context, valeur: String) {
        val presse = contexte.getSystemService(ClipboardManager::class.java) ?: return
        val donnees = ClipData.newPlainText(ETIQUETTE, valeur)
        donnees.description.extras = PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
        presse.setPrimaryClip(donnees)

        // Une seule échéance à la fois : la dernière copie repousse l'effacement, sans quoi
        // la première minuterie effacerait la seconde copie avant son terme.
        effacement?.let { principal.removeCallbacks(it) }
        val tache = Runnable { effacerSiNotre(presse, valeur) }
        effacement = tache
        principal.postDelayed(tache, DUREE_S * 1000L)
    }

    private fun effacerSiNotre(presse: ClipboardManager, valeur: String) {
        effacement = null
        val actuel = try {
            presse.primaryClip
        } catch (_: SecurityException) {
            null
        }
        if (actuel != null) {
            val notre = actuel.description?.label == ETIQUETTE &&
                actuel.itemCount > 0 &&
                actuel.getItemAt(0).text?.toString() == valeur
            if (!notre) return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            presse.clearPrimaryClip()
        } else {
            presse.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }
}
