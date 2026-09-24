package ch.stackops.ghostpass

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher

/**
 * La cérémonie biométrique, en un seul endroit.
 *
 * Elle sert deux appelants qui n'ont rien d'autre en commun : l'écran de déverrouillage et
 * l'écran de remplissage. Deux copies auraient divergé sur le détail qui compte — les
 * *authentificateurs autorisés*.
 *
 * ## `BIOMETRIC_STRONG` seul, et pas « ou le code de l'appareil »
 *
 * `setAllowedAuthenticators(BIOMETRIC_STRONG)` doit correspondre exactement à ce que
 * [CleDEnveloppe] a demandé à la génération de la clé. Un écart entre les deux ne produit
 * pas un refus lisible : `authenticate()` lève une `IllegalArgumentException` sur un
 * `CryptoObject` quand le code de l'appareil est autorisé, parce qu'une authentification
 * par code ne peut pas déverrouiller une clé liée à la biométrie. Les tenir ensemble est
 * la raison d'être de ce fichier.
 *
 * Le bouton de refus est obligatoire dès lors qu'on n'autorise pas le code de l'appareil.
 * Il dit « Mot de passe maître » plutôt que « Annuler » : refuser la biométrie n'abandonne
 * pas, cela revient au chemin long, et l'écrire évite de laisser croire qu'on est coincé.
 */
object Biometrie {

    /** Le type d'authentification exigé, ici et à la génération de la clé. Un seul endroit. */
    const val AUTHENTIFICATEURS = BiometricManager.Authenticators.BIOMETRIC_STRONG

    /**
     * L'appareil peut-il authentifier **maintenant** ?
     *
     * `BIOMETRIC_SUCCESS` et rien d'autre. `BIOMETRIC_ERROR_NONE_ENROLLED` — le cas le plus
     * fréquent — veut dire que le capteur existe mais qu'aucune empreinte n'est posée : la
     * clé ne pourrait pas même être créée. Le traiter comme un succès ferait échouer
     * l'activation avec un message de cryptographie, là où la vraie phrase est « votre
     * téléphone n'a pas d'empreinte enregistrée ».
     */
    fun disponible(contexte: Context): Boolean =
        BiometricManager.from(contexte).canAuthenticate(AUTHENTIFICATEURS) ==
            BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Demande l'authentification, et rend le `Cipher` **que le système a rendu**.
     *
     * @param chiffreur celui que [CleDEnveloppe] a préparé, initialisé mais pas encore
     *   utilisable : c'est le passage par le `CryptoObject` qui l'autorise.
     */
    fun demander(
        activite: FragmentActivity,
        titre: String,
        sousTitre: String,
        chiffreur: Cipher,
        surSucces: (Cipher) -> Unit,
        surEchec: (String?) -> Unit,
    ) {
        val invite = BiometricPrompt.PromptInfo.Builder()
            .setTitle(titre)
            .setSubtitle(sousTitre)
            .setAllowedAuthenticators(AUTHENTIFICATEURS)
            .setNegativeButtonText(activite.getString(R.string.biometrie_mot_de_passe_maitre))
            .setConfirmationRequired(false)
            .build()

        val prompt = BiometricPrompt(
            activite,
            ContextCompat.getMainExecutor(activite),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(resultat: BiometricPrompt.AuthenticationResult) {
                    // Le `Cipher` du résultat, jamais celui qu'on avait passé : c'est lui
                    // qui porte la preuve d'authentification.
                    val obtenu = resultat.cryptoObject?.cipher
                    if (obtenu == null) surEchec(null) else surSucces(obtenu)
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    // Un refus volontaire n'est pas une erreur à afficher : l'utilisateur a
                    // choisi le mot de passe maître, et lui dire « erreur » serait faux.
                    val volontaire = code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        code == BiometricPrompt.ERROR_USER_CANCELED ||
                        code == BiometricPrompt.ERROR_CANCELED
                    surEchec(if (volontaire) null else message.toString())
                }
            },
        )
        prompt.authenticate(invite, BiometricPrompt.CryptoObject(chiffreur))
    }
}
