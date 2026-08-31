package ch.stackops.ghostpass

/**
 * La couleur d'une équipe : celle qu'on lui a choisie, ou celle qu'on lui attribue.
 *
 * Port de `apps/ios/Ghostpass/Theme/CouleurDEquipe.swift`, calcul pour calcul. Un
 * utilisateur qui n'a rien réglé doit voir **la même couleur** sur les trois clients ; la
 * règle est donc volontairement bête, pour être reproductible partout.
 *
 * **Aucun hachage de bibliothèque.** `hashCode` en Kotlin ne se distingue de `hashValue`
 * en Swift que par la raison de son instabilité : il n'est garanti stable ni entre
 * versions de la JVM, ni entre implémentations, et rien n'oblige deux exécutions à
 * s'accorder. La couleur d'une équipe changerait à l'ouverture de l'application. La somme
 * des octets UTF-8, elle, ne dépend d'aucune implémentation.
 */
object CouleurDEquipe {

    /**
     * Huit teintes qui restent distinguables les unes des autres, y compris pour les
     * formes courantes de daltonisme — on n'oppose jamais un rouge à un vert seuls.
     */
    val palette: List<String> = listOf(
        "#4C8DFF", // bleu
        "#B57BFF", // violet
        "#00C2A8", // turquoise
        "#FF8A3D", // orange
        "#E75480", // rose
        "#3FBF5F", // vert
        "#FFC53D", // ambre
        "#7A8CFF", // indigo
    )

    /**
     * La couleur attribuée d'office, stable pour un identifiant donné.
     *
     * `somme = chaque octet UTF-8 de l'identifiant, additionné ; couleur = palette[somme % 8]`.
     *
     * Le `and 0xFF` n'est pas décoratif : en Kotlin un `Byte` est **signé**, et tout octet
     * au-delà de 0x7F — c'est-à-dire chaque octet d'un caractère non ASCII — arriverait
     * négatif. La somme d'un identifiant accentué différerait alors de celle que calcule
     * Swift, qui itère `String.utf8` en `UInt8`. Personne ne le verrait avant qu'une
     * équipe au nom accentué n'ait deux couleurs selon le téléphone.
     */
    fun attribuee(identifiant: String): String {
        if (identifiant.isEmpty()) return palette[0]
        val somme = identifiant.toByteArray(Charsets.UTF_8).sumOf { it.toInt() and 0xFF }
        return palette[somme % palette.size]
    }

    /** La couleur retenue : celle du registre si elle existe, sinon celle attribuée. */
    fun hex(identifiant: String, choisies: Map<String, String>): String =
        choisies[identifiant] ?: attribuee(identifiant)

    /**
     * Un `#RRGGBB` en couleur ARGB, ou `null` sur une chaîne qu'on ne sait pas lire.
     *
     * Le registre est écrit par d'autres clients, et une valeur inattendue ne doit pas
     * donner du noir sans qu'on sache pourquoi : l'appelant retombe sur la couleur
     * attribuée. `toIntOrNull(16)` refuse aussi bien « bleu » que « #GGGGGG », là où un
     * analyseur indulgent rendrait 0 — c'est-à-dire du noir, exactement ce qu'on évite.
     */
    fun couleurArgb(hex: String): Int? {
        var texte = hex.trim()
        if (texte.startsWith("#")) texte = texte.substring(1)
        if (texte.length != 6) return null
        val valeur = texte.toIntOrNull(16) ?: return null
        return 0xFF000000.toInt() or valeur
    }

    /** Le `#RRGGBB` d'une couleur ARGB — la forme que le web sait relire. */
    fun hexDe(argb: Int): String = "#%02X%02X%02X".format(
        (argb shr 16) and 0xFF,
        (argb shr 8) and 0xFF,
        argb and 0xFF,
    )
}
