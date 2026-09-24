package ch.stackops.ghostpass

import java.security.SecureRandom
import kotlin.math.log2
import kotlin.math.min

/**
 * Les réglages du générateur — mêmes valeurs par défaut que le web et qu'iOS.
 *
 * Vingt caractères et les quatre jeux : ce n'est pas un compromis local, c'est le même
 * choix partout. Deux appareils du même compte doivent produire des mots de passe **de même
 * nature**, sans quoi on finit par savoir d'où vient un mot de passe rien qu'en le
 * regardant.
 */
data class ReglagesDuGenerateur(
    val longueur: Int = 20,
    val minuscules: Boolean = true,
    val majuscules: Boolean = true,
    val chiffres: Boolean = true,
    val symboles: Boolean = true,
)

/**
 * Générateur de mots de passe, transposition fidèle de `apps/web/src/lib/generator.ts` et de
 * `apps/ios/Ghostpass/Services/PasswordGenerator.swift` : mêmes jeux de caractères, mêmes
 * valeurs par défaut, mêmes garanties.
 *
 * **Ce n'est pas de la cryptographie, et c'est pour cela que le cœur Rust ne l'expose pas.**
 * Tirer un entier au hasard dans un jeu de caractères ne chiffre ni ne scelle rien ; la
 * règle « aucune crypto réimplémentée en Kotlin » ne s'y applique pas, et iOS a tranché de
 * la même façon. Ce qui compte est que l'**aléa** vienne du système — [SecureRandom] ici,
 * `SecRandomCopyBytes` là-bas, `crypto.getRandomValues` sur le web — et jamais de
 * `kotlin.random.Random`, dont la graine est prévisible.
 *
 * Il vit dans `:noyau` plutôt que dans `:app` pour une raison qui vaut plus que le rangement :
 * c'est ce qui le rend éprouvable sur la JVM du poste, en quelques secondes, sans émulateur.
 * Un générateur qu'on ne peut éprouver que sur appareil est un générateur qu'on n'éprouve
 * pas — et ses défauts ne se voient pas à l'œil : une sortie biaisée a exactement l'air
 * d'une sortie aléatoire.
 */
object GenerateurDeMotDePasse {

    const val MINUSCULES = "abcdefghijklmnopqrstuvwxyz"
    const val MAJUSCULES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    const val CHIFFRES = "0123456789"
    const val SYMBOLES = "!@#\$%^&*()-_=+[]{};:,.?/"

    /** En deçà de 8, la longueur ne protège plus de rien ; au-delà de 64, l'écran ment. */
    const val LONGUEUR_MIN = 8
    const val LONGUEUR_MAX = 64

    private val alea = SecureRandom()

    /**
     * Un entier uniforme dans `[0, borne)`.
     *
     * Le rejet des valeurs hautes évite le biais qu'un simple modulo introduirait : sans
     * lui, les premiers caractères du jeu sortiraient un peu plus souvent que les derniers.
     * Sur un jeu de 86 caractères et 2³¹ tirages possibles le biais est minuscule — et
     * c'est bien le problème : il est invisible à l'œil, invisible à l'usage, et il réduit
     * l'entropie réelle en dessous de celle qu'on affiche à l'écran.
     *
     * `SecureRandom.nextInt(borne)` fait déjà ce rejet. On ne le refait pas à la main :
     * réécrire ce que la plateforme garantit, c'est se donner une occasion de plus de se
     * tromper.
     */
    private fun index(borne: Int): Int {
        require(borne > 0) { "un jeu de caractères vide n'a pas d'index" }
        return alea.nextInt(borne)
    }

    fun generer(reglages: ReglagesDuGenerateur): String {
        val jeux = buildList {
            if (reglages.minuscules) add(MINUSCULES)
            if (reglages.majuscules) add(MAJUSCULES)
            if (reglages.chiffres) add(CHIFFRES)
            if (reglages.symboles) add(SYMBOLES)
            // Tout décocher ne doit pas rendre un mot de passe vide. Un champ vide se lit
            // « le générateur est cassé », alors que la consigne reçue était vide.
            if (isEmpty()) add(MINUSCULES)
        }

        val demandee = if (reglages.longueur > 0) reglages.longueur else 20
        val longueur = maxOf(jeux.size, min(LONGUEUR_MAX, demandee))
        val bassin = jeux.joinToString("")

        // Un caractère au moins de chaque jeu demandé : cocher « chiffres » et n'en obtenir
        // aucun serait un mot de passe qui ne respecte pas la consigne reçue — et certains
        // sites la refusent alors sans dire laquelle.
        val caracteres = jeux.mapTo(ArrayList(longueur)) { jeu -> jeu[index(jeu.length)] }
        while (caracteres.size < longueur) caracteres.add(bassin[index(bassin.length)])

        // Mélange de Fisher-Yates. Sans lui, les caractères garantis resteraient en tête, et
        // **la position d'un chiffre trahirait la façon dont le mot de passe a été fait** —
        // ce qui réduit l'espace à fouiller pour qui sait quel outil l'a produit.
        for (i in caracteres.indices.reversed()) {
            if (i == 0) break
            val j = index(i + 1)
            val garde = caracteres[i]
            caracteres[i] = caracteres[j]
            caracteres[j] = garde
        }
        return caracteres.joinToString("")
    }

    /**
     * L'entropie, en bits, de ce que ces réglages **peuvent** produire.
     *
     * Une jauge indicative, fondée sur la seule chose qu'on puisse mesurer ici : le nombre
     * de combinaisons possibles. Elle ne dit rien d'une fuite — un mot de passe à 128 bits
     * tiré au hasard peut figurer dans une base volée —, seulement de ce qu'il en coûterait
     * de le deviner. La santé du coffre répond à l'autre question.
     */
    fun bits(reglages: ReglagesDuGenerateur): Double {
        var taille = 0
        if (reglages.minuscules) taille += MINUSCULES.length
        if (reglages.majuscules) taille += MAJUSCULES.length
        if (reglages.chiffres) taille += CHIFFRES.length
        if (reglages.symboles) taille += SYMBOLES.length
        if (taille == 0) taille = MINUSCULES.length
        return reglages.longueur * log2(taille.toDouble())
    }

    /** Les quatre paliers d'iOS, aux mêmes seuils — un même mot de passe doit s'y lire pareil. */
    enum class Force { FAIBLE, CORRECT, SOLIDE, EXCELLENT }

    fun force(bits: Double): Force = when {
        bits >= 100 -> Force.EXCELLENT
        bits >= 72 -> Force.SOLIDE
        bits >= 50 -> Force.CORRECT
        else -> Force.FAIBLE
    }
}
