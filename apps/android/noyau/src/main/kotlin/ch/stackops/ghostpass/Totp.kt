package ch.stackops.ghostpass

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Codes TOTP (RFC 6238), transposition de `apps/ios/Ghostpass/Services/Totp.swift`.
 *
 * Le secret vit dans l'élément chiffré et ne quitte jamais l'appareil. Le HMAC vient de
 * `javax.crypto`, présent sur la JVM du poste comme sur Android : rien n'est réimplémenté,
 * seule la mécanique de la RFC est ici — et elle s'éprouve sans émulateur.
 *
 * **Jusqu'au 2026-11-13, Android gardait le secret sans jamais calculer le code.** Le champ
 * se saisissait, se scannait, s'exportait ; personne ne pouvait lire son code dans
 * l'application, là où iOS l'affiche dans la fiche et le remplit dans les formulaires.
 */
object Totp {

    enum class Algorithme(val jca: String) { SHA1("HmacSHA1"), SHA256("HmacSHA256"), SHA512("HmacSHA512") }

    data class Reglage(
        val secret: String,
        val periode: Int = 30,
        val chiffres: Int = 6,
        val algorithme: Algorithme = Algorithme.SHA1,
    )

    /** Le code, et les secondes qu'il lui reste à vivre. */
    data class Code(val code: String, val restant: Int, val periode: Int)

    /**
     * Accepte un secret base32 brut ou une URI `otpauth://`. Rend `null` si le champ est
     * vide ou inexploitable — un élément sans TOTP est le cas courant, pas une erreur.
     */
    fun lire(saisie: String?): Reglage? {
        val propre = saisie?.trim().orEmpty()
        if (propre.isEmpty()) return null

        var secret = propre
        var periode = 30
        var chiffres = 6
        var algorithme = Algorithme.SHA1
        if (propre.lowercase().startsWith("otpauth://")) {
            secret = LienOtpauth.parametre(propre, "secret").orEmpty()
            periode = LienOtpauth.parametre(propre, "period")?.toIntOrNull() ?: 30
            chiffres = LienOtpauth.parametre(propre, "digits")?.toIntOrNull() ?: 6
            algorithme = when (LienOtpauth.parametre(propre, "algorithm")?.uppercase()) {
                "SHA256" -> Algorithme.SHA256
                "SHA512" -> Algorithme.SHA512
                else -> Algorithme.SHA1
            }
        }
        val normalise = secret.filterNot { it.isWhitespace() }.uppercase()
        if (normalise.isEmpty()) return null
        // Des paramètres absurdes valent mieux corrigés que propagés jusqu'au calcul.
        if (periode <= 0) periode = 30
        if (chiffres !in 1..9) chiffres = 6
        return Reglage(normalise, periode, chiffres, algorithme)
    }

    /** Le code à l'instant donné, en millisecondes depuis l'époque Unix. */
    fun code(reglage: Reglage, instantMs: Long = System.currentTimeMillis()): Code? {
        val cle = base32(reglage.secret)
        if (cle.isEmpty()) return null

        val secondes = instantMs / 1000
        val compteur = secondes / reglage.periode
        val message = ByteArray(8) { i -> (compteur ushr (8 * (7 - i))).toByte() }

        val mac = Mac.getInstance(reglage.algorithme.jca)
        mac.init(SecretKeySpec(cle, reglage.algorithme.jca))
        val empreinte = mac.doFinal(message)

        // Troncature dynamique de la RFC : les quatre derniers bits désignent l'offset.
        val decalage = empreinte[empreinte.size - 1].toInt() and 0x0f
        val binaire = ((empreinte[decalage].toInt() and 0x7f) shl 24) or
            ((empreinte[decalage + 1].toInt() and 0xff) shl 16) or
            ((empreinte[decalage + 2].toInt() and 0xff) shl 8) or
            (empreinte[decalage + 3].toInt() and 0xff)
        // En 64 bits : 10^10 déborde d'un Int, et un `digits` fantaisiste ne doit pas faire
        // tomber l'application.
        var modulo = 1L
        repeat(reglage.chiffres) { modulo *= 10 }
        val valeur = binaire.toLong() % modulo
        val texte = valeur.toString().padStart(reglage.chiffres, '0')
        val restant = (reglage.periode - (secondes % reglage.periode)).toInt()
        return Code(texte, restant, reglage.periode)
    }

    /** Raccourci : le code courant d'un champ TOTP tel qu'il est stocké, ou `null`. */
    fun codeCourant(champ: String?, instantMs: Long = System.currentTimeMillis()): Code? =
        lire(champ)?.let { code(it, instantMs) }

    private fun base32(texte: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val sortie = java.io.ByteArrayOutputStream()
        var bits = 0
        var valeur = 0
        for (c in texte.uppercase()) {
            if (c == '=') continue
            val index = alphabet.indexOf(c)
            if (index < 0) continue
            valeur = (valeur shl 5) or index
            bits += 5
            if (bits >= 8) {
                sortie.write((valeur shr (bits - 8)) and 0xff)
                bits -= 8
            }
        }
        return sortie.toByteArray()
    }
}
