package ch.stackops.ghostpass

import uniffi.ghost_crypto_ffi.openSend
import uniffi.ghost_crypto_ffi.sealSend

/**
 * Une porte en ligne de commande sur les deux primitives de partage du cœur.
 *
 * Elle n'existe que pour `tools/android/temoin-du-partage-croise.sh`, qui fait dialoguer le
 * cœur Rust avec **WebCrypto** — l'implémentation du navigateur qui ouvrira réellement les
 * liens. Un test écrit d'un seul côté sceller-puis-rouvrir reste vert quel que soit
 * l'algorithme, pourvu qu'il soit le même des deux côtés : c'est exactement le monde cassé
 * qu'on a vécu, où le cœur produisait un nonce de 24 octets que le relais refusait.
 *
 *     sceller <clair>                      → {"key":…,"nonce":…,"ciphertext":…}
 *     ouvrir  <clé> <nonce> <chiffré>      → le clair
 *
 * Tout est en base64 standard, comme le cœur le rend.
 */
object PartageCroise {

    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "sceller" -> {
                val scelle = sealSend(args[1])
                // Du JSON écrit à la main : cet outil ne doit dépendre de rien, pour que
                // son échec ne puisse venir que du cœur.
                println(
                    """{"key":"${scelle.key}","nonce":"${scelle.nonce}",""" +
                        """"ciphertext":"${scelle.ciphertext}"}""",
                )
            }
            "ouvrir" -> println(openSend(args[1], args[2], args[3]))
            else -> {
                System.err.println("usage : sceller <clair> | ouvrir <clé> <nonce> <chiffré>")
                kotlin.system.exitProcess(2)
            }
        }
    }
}
