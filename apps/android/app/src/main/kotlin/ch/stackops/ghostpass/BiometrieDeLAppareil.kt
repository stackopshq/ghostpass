package ch.stackops.ghostpass

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * **De quelle biométrie cet appareil dispose-t-il ?** — pour le dire à l'écran sans mentir.
 *
 * Android écrivait « Déverrouiller par empreinte », en dur, sur tous les appareils. C'est
 * faux sur un téléphone à reconnaissance faciale, et le genre de faux qui ne casse rien :
 * l'utilisateur appuie, son visage est reconnu, le coffre s'ouvre, et l'application vient
 * simplement de lui décrire un geste qu'il n'a pas fait. Personne ne signale ce défaut —
 * on le lit comme une maladresse du produit.
 *
 * iOS n'a pas ce problème parce que `LAContext.biometryType` **dit** lequel des deux est
 * en service. Android n'a pas d'équivalent : `BiometricManager` répond « oui, une
 * biométrie forte est utilisable », jamais laquelle. Les drapeaux matériels du
 * [PackageManager] sont le meilleur signal disponible, et il faut savoir ce qu'ils valent :
 *
 *  - ils décrivent le **matériel présent**, pas le capteur que le système choisira. Un
 *    appareil qui porte les deux dira [Genre.PLUSIEURS], et le libellé reste alors
 *    générique — ce qui est exact, plutôt que de tirer à pile ou face ;
 *  - `FEATURE_FACE` et `FEATURE_IRIS` n'existent qu'à partir de l'API 29. En deçà, seule
 *    l'empreinte est déclarable, ce qui correspond à la réalité de ces versions.
 *
 * La règle est celle du repli : **quand on ne sait pas, on le dit**. « Déverrouiller par
 * biométrie » n'apprend rien de plus que ce qu'on sait, et c'est précisément sa qualité.
 */
object BiometrieDeLAppareil {

    enum class Genre {
        EMPREINTE,
        VISAGE,
        IRIS,
        PLUSIEURS,
        INCONNU,
    }

    fun genre(contexte: Context): Genre {
        val paquets = contexte.packageManager
        val presents = buildList {
            if (paquets.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) add(Genre.EMPREINTE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (paquets.hasSystemFeature(PackageManager.FEATURE_FACE)) add(Genre.VISAGE)
                if (paquets.hasSystemFeature(PackageManager.FEATURE_IRIS)) add(Genre.IRIS)
            }
        }
        return when {
            presents.isEmpty() -> Genre.INCONNU
            presents.size > 1 -> Genre.PLUSIEURS
            else -> presents.first()
        }
    }

    /**
     * Le nom du geste, tel qu'il se prononce — l'équivalent de `Biometrics.label` d'iOS.
     *
     * Il sert à deux endroits qui doivent s'accorder : l'étiquette d'accessibilité du bouton
     * de l'écran d'entrée, et le libellé du réglage qui active ou désactive le raccourci.
     * Deux formulations différentes pour la même fonction feraient douter qu'il s'agisse de
     * la même.
     */
    fun nom(contexte: Context): String = when (genre(contexte)) {
        Genre.EMPREINTE -> "empreinte"
        Genre.VISAGE -> "reconnaissance faciale"
        Genre.IRIS -> "reconnaissance de l'iris"
        Genre.PLUSIEURS, Genre.INCONNU -> "biométrie"
    }

    /**
     * Le symbole qui va avec ce nom se dessine — voir `IconeBiometrique` dans le thème.
     *
     * **Aucun emoji ici, et le motif mérite d'être gardé.** Le premier jet en employait :
     * l'application s'en sert déjà pour son ornement de barre d'outils, et c'était la
     * solution la plus courte. Sauf qu'Unicode n'a pas de glyphe d'empreinte digitale avant
     * la version 16 (2024) — `U+1FAC6` —, qu'aucun appareil sous le `minSdk` du produit ne
     * connaît. Il s'y serait affiché en **tofu** : un rectangle vide.
     *
     * C'est exactement le repli silencieux qu'on cherche à éviter. Un bouton dont l'icône
     * manque ne se lit pas « icône manquante », il se lit « bouton vide » — et sur l'écran
     * d'entrée, c'est le bouton par lequel on rentre. Le défaut aurait été invisible sur
     * l'émulateur récent qui sert à développer, et visible sur le Redmi de Clara.
     *
     * Les icônes sont donc **tracées**, et ne dépendent d'aucune police.
     */
}
