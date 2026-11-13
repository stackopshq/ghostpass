package ch.stackops.ghostpass.essai

import android.app.Activity
import android.os.Bundle
import ch.stackops.ghostpass.R

/**
 * Le **second** écran d'une connexion en deux temps, de la variante `debug` seulement : un
 * seul champ, celui du code à usage unique.
 *
 * Pourquoi il existe à côté de [ActiviteDEssaiDeConnexion] : le service distingue deux cas,
 * et un seul des deux était éprouvable sur appareil. Quand une vue ne déclare **que** le
 * champ d'un code, `ActiviteDeRemplissage` passe en `seulementLeCode` et ne propose plus que
 * les comptes qui portent un second facteur — ceux qui n'en ont pas n'ont rien à remplir, et
 * les proposer donnerait une liste où presque chaque ligne est un cul-de-sac. Cette règle
 * vivait dans le code sans que rien, hors d'un test, ne l'ait vue tenir sur un téléphone.
 *
 * `autofillHints="smsOTPCode"` est l'un des noms que `ServiceDeRemplissage` reconnaît, avec
 * `2faAppOTPCode` et, pour une page web, l'attribut `autocomplete="one-time-code"` que
 * Chrome transmet. Un seul suffit à poser le cas ; les autres passent par le même chemin.
 *
 * **Il ne part dans aucun paquet livré** : `src/debug` n'est compilé que pour la variante de
 * développement.
 */
class ActiviteDEssaiDeCodeUnique : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.essai_de_code_unique)
    }
}
