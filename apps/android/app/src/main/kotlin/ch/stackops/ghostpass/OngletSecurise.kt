package ch.stackops.ghostpass

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/**
 * L'onglet de navigateur dans lequel se déroule le SSO — **et jamais une `WebView`**.
 *
 * C'est le point de sécurité du §8, et il n'est pas négociable : une `WebView` s'exécute
 * dans notre processus, avec nos droits. Nous pourrions y lire le mot de passe que
 * l'utilisateur saisit **chez son fournisseur d'identité**, injecter du script dans sa page,
 * ou consulter ses cookies. Un gestionnaire de mots de passe qui ferait cela annulerait
 * exactement l'intérêt du SSO — dont tout le principe est que le secret ne nous atteint pas.
 *
 * Ce n'est pas seulement une question de bonne foi : les fournisseurs d'identité détectent
 * et refusent les `WebView` pour cette raison, et l'utilisateur y perd aussi sa session
 * existante, ses clés de sécurité et son gestionnaire de mots de passe système.
 *
 * `CustomTabsIntent` s'appuie sur le navigateur de l'utilisateur, hors de notre processus.
 * Si aucun navigateur ne prend en charge les onglets personnalisés, il **retombe sur une
 * intention de navigation ordinaire** — un navigateur complet, toujours pas une `WebView`.
 * Il n'y a donc aucun chemin par lequel cette classe puisse dégrader vers le cas interdit.
 */
object OngletSecurise {

    fun ouvrir(contexte: Context, adresse: String) {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            // Le retour se fait par le schéma d'URL de l'application ; l'onglet n'a donc
            // pas à survivre à ce retour.
            .setUrlBarHidingEnabled(false)
            .build()
            .launchUrl(contexte, Uri.parse(adresse))
    }
}
