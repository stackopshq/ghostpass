package ch.stackops.ghostpass.essai

import android.app.Activity
import android.os.Bundle
import ch.stackops.ghostpass.R

/**
 * Un formulaire de connexion **de la variante `debug` seulement**, pour éprouver le
 * remplissage automatique sur appareil.
 *
 * Pourquoi il existe : le remplissage est la fonction principale du produit, et la seule
 * qu'on ne puisse pas éprouver depuis un test — elle demande une *autre* application qui
 * déclare des champs, et le système au milieu. Sur l'émulateur, Chrome reste bloqué dans son
 * assistant de premier lancement ; sans cet écran, la chaîne « service → intention en
 * attente → biométrie → jeu de valeurs » n'aurait jamais été vue fonctionner.
 *
 * **Il ne part dans aucun paquet livré** : `src/debug` n'est compilé que pour la variante de
 * développement. C'est ce qui permet de l'écrire sans se demander s'il ouvre une surface —
 * il n'en ouvre aucune là où cela compterait.
 *
 * Deux `EditText` ordinaires, avec leurs `autofillHints` : c'est exactement ce qu'une
 * application tierce déclare, et donc exactement ce que le service doit savoir reconnaître.
 */
class ActiviteDEssaiDeConnexion : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.essai_de_connexion)
    }
}
