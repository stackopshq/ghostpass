package ch.stackops.ghostpass

import kotlin.math.min
import kotlin.math.roundToInt

/**
 * L'état de santé du coffre, calculé **entièrement sur l'appareil**.
 *
 * Le barème est celui de la web app et d'iOS, au point près : longueur et variété de
 * caractères. Ce n'est pas une science — aucune formule ne dit si un mot de passe a fuité —
 * mais c'est une mesure reproductible, et surtout **la même des deux côtés**. Un mot de
 * passe jugé faible dans le navigateur doit l'être aussi sur le téléphone, sans quoi les
 * deux écrans se contrediraient sur le même coffre, et l'utilisateur n'aurait aucun moyen
 * de savoir lequel croire.
 */
object SanteDuCoffre {

    /** De 0 (très faible) à 4 (très bon) — les cinq paliers d'iOS. */
    @JvmInline
    value class Force(val niveau: Int) {
        val libelle: String
            get() = when (niveau) {
                0 -> "Très faible"
                1 -> "Faible"
                2 -> "Moyen"
                3 -> "Bon"
                else -> "Très bon"
            }

        /** Le seuil qui fait entrer un mot de passe dans la liste « faibles ». */
        val estFaible: Boolean get() = niveau <= 1
    }

    fun force(motDePasse: String): Force {
        if (motDePasse.isEmpty()) return Force(0)
        var score = 0
        if (motDePasse.length >= 8) score++
        if (motDePasse.length >= 14) score++
        if (motDePasse.length >= 20) score++

        val classes = listOf<(Char) -> Boolean>(
            Char::isLowerCase, Char::isUpperCase, Char::isDigit,
        ).count { estDeLaClasse -> motDePasse.any(estDeLaClasse) }
        val autres = motDePasse.any { !it.isLetterOrDigit() }
        val varietes = classes + if (autres) 1 else 0
        if (varietes >= 2) score++
        if (varietes >= 3) score++

        // Cinq points ramenés à quatre paliers. Les valeurs intermédiaires ne tombent
        // jamais sur une demie (0 · 0,8 · 1,6 · 2,4 · 3,2 · 4), si bien que l'arrondi de
        // Kotlin et celui de Swift ne peuvent pas diverger ici. Ce serait moins évident
        // avec six points, et c'est pourquoi le test l'écrit palier par palier.
        return Force(min(4, (score / 5.0 * 4).roundToInt()))
    }

    /**
     * Ce qu'un coffre a de fragile. **Trois listes plutôt qu'une note globale** : une note
     * ne dit pas quoi corriger, et c'est la seule chose qui compte ici.
     */
    data class Bilan(
        val faibles: List<EntreeDuCoffre.Lisible> = emptyList(),
        val reutilises: List<EntreeDuCoffre.Lisible> = emptyList(),
        val sansCode: List<EntreeDuCoffre.Lisible> = emptyList(),
        /** Ce qui a été examiné — et [aRevoir] ne se lit pas sans lui. */
        val examines: Int = 0,
    ) {
        val estSain: Boolean get() = faibles.isEmpty() && reutilises.isEmpty()
        val aRevoir: Int get() = faibles.size + reutilises.size
    }

    /**
     * Le bilan d'une liste de lignes de coffre.
     *
     * **Les lignes illisibles ne sont pas comptées, et ne peuvent pas l'être** : leur mot de
     * passe vit dans le chiffré, sous une clé qu'on n'a pas. Les faire entrer dans
     * `examines` donnerait un compte rassurant sur des éléments qu'on n'a pas regardés —
     * c'est le repli silencieux que le §5 du brief combat, déplacé dans un compteur.
     *
     * Les **registres** sont écartés pour la raison inverse : ce sont des données de
     * l'application — favoris, dossiers — déguisées en éléments de coffre. Les compter
     * ferait apparaître « gp:folders » dans la liste des mots de passe faibles, et
     * gonflerait « éléments examinés » d'entrées que l'utilisateur n'a jamais créées.
     */
    fun bilan(entrees: List<EntreeDuCoffre>): Bilan {
        val lisibles = entrees
            .filterIsInstance<EntreeDuCoffre.Lisible>()
            .filterNot { it.element.estUnRegistre }

        // Combien de fois chaque mot de passe apparaît. C'est ce compte — et non une
        // comparaison deux à deux — qui rend la réutilisation détectable en un passage.
        val occurrences = HashMap<String, Int>()
        for (entree in lisibles) {
            val mot = entree.element.identifiants?.password
            if (!mot.isNullOrEmpty()) occurrences[mot] = (occurrences[mot] ?: 0) + 1
        }

        val faibles = ArrayList<EntreeDuCoffre.Lisible>()
        val reutilises = ArrayList<EntreeDuCoffre.Lisible>()
        val sansCode = ArrayList<EntreeDuCoffre.Lisible>()
        for (entree in lisibles) {
            val identifiants = entree.element.identifiants ?: continue
            if (identifiants.password.isNotEmpty()) {
                if (force(identifiants.password).estFaible) faibles.add(entree)
                if ((occurrences[identifiants.password] ?: 0) > 1) reutilises.add(entree)
            }
            if (identifiants.totp.isNullOrEmpty()) sansCode.add(entree)
        }
        return Bilan(faibles, reutilises, sansCode, examines = lisibles.size)
    }
}
