package ch.stackops.ghostpass

import android.content.Intent
import android.graphics.Rect
import android.view.accessibility.AccessibilityWindowInfo
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * **Le troisième point du §7, celui qu'aucun scan de chaînes ne prouve.**
 *
 * `tools/android/verifier-l-autonomie.sh` sait dire que l'APK ne vend rien et ne nomme aucun
 * serveur de l'éditeur. Il écrit lui-même, en toutes lettres, ce qu'il ne prouve pas : qu'un
 * **premier lancement aboutit à un coffre utilisable contre une instance quelconque**. Tant
 * que cela n'est pas rejoué par une machine, ce contrôle reste vert et ne dit rien du point
 * qui compte le plus — celui sur lequel un relecteur d'App Store jugerait.
 *
 * Ce parcours le rejoue, du premier écran au champ rempli :
 *
 * ```
 *   connexion → coffre lu → création → modification → verrouillage
 *   → redéverrouillage → remplissage d'un formulaire tiers
 * ```
 *
 * ## Ce qui le rend falsifiable
 *
 * Un parcours qui ne peut pas rougir ne mesure rien. Trois choses le rendent falsifiable, et
 * la troisième est celle qu'on oublie :
 *
 *  - chaque étape **affirme** ce qu'elle attend à l'écran, avec un message qui dit ce qui
 *    manquait — pas un simple « échec » ;
 *  - `tools/android/temoin-du-parcours.sh` perturbe le monde (mauvais mot de passe maître)
 *    et exige que ce parcours tombe ;
 *  - **la résolution de noms est coupée pendant l'exécution** par le script qui l'appelle.
 *    L'adresse du serveur est une adresse IP littérale ; tout ce qui aurait besoin d'un nom
 *    de domaine — celui de l'éditeur, par exemple — échouerait. C'est la seule preuve à
 *    notre portée que le parcours ne s'appuie sur aucun hôte extérieur, et elle vaut mieux
 *    qu'un `grep` sur des chaînes.
 *
 * ## Pourquoi UiAutomator et pas `adb shell input`
 *
 * Mesuré : sur un champ Compose et un émulateur ARM, `input text` perd ou double des
 * caractères sans le dire. Un parcours dont la saisie est aléatoire ne mesure pas le
 * produit — il mesure l'émulateur. `setText` passe par l'action d'accessibilité et pose la
 * valeur d'un coup.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'utilise **pas la biométrie** : le déverrouillage se fait au mot de passe maître, y
 * compris dans l'écran de remplissage. C'est délibéré — un test ne peut pas poser un doigt
 * sur un capteur, et le raccourci biométrique a son propre témoin
 * (`tools/android/temoin-de-l-invalidation.sh`). Le chemin éprouvé ici est celui qui doit
 * marcher **avant** toute biométrie, et c'est celui du premier lancement.
 */
@TemoinPilote
class ParcoursDeBoutEnBoutTest {

    private val appareil: UiDevice
        get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    private val arguments = InstrumentationRegistry.getArguments()
    private val serveur: String get() = exiger("serveur")
    private val email: String get() = exiger("email")
    private val motDePasse: String get() = exiger("motdepasse")

    private fun exiger(nom: String): String =
        arguments.getString(nom) ?: throw AssertionError(
            "Argument d'instrumentation « $nom » manquant. Ce parcours ne s'exécute pas seul : " +
                "lancez tools/android/parcours-de-bout-en-bout.sh, qui sème un serveur local " +
                "et passe son adresse ici.",
        )

    /** Le parcours entier, dans l'ordre où un utilisateur le vit. */
    @Test
    fun leParcoursDePremierLancement() {
        ouvrirLApplication()

        etape("1. Connexion à une instance quelconque") {
            poser("field.server", serveur)
            poser("field.email", email)
            poser("field.master", motDePasse)
            toucher("button.submit")
        }

        etape("2. Le coffre est lu et déchiffré") {
            attendre(
                By.text("Forgejo"),
                "le coffre n'affiche pas l'élément semé « Forgejo » : la connexion, la " +
                    "lecture ou le déchiffrement a échoué",
                40_000,
            )
            attendre(By.text("GitHub"), "le second élément semé manque")

            // §5 — ce qui ne se déchiffre pas s'affiche quand même. L'élément scellé par un
            // autre compte doit être là, et dire pourquoi.
            attendre(
                By.text("Élément illisible"),
                "l'élément scellé par un autre compte a disparu de la liste. C'est la règle " +
                    "§5, et son absence se lit « il n'y a rien »",
            )

            // §2 — les registres à nom réservé ne s'affichent pas. On cherche le nom en
            // clair : s'il apparaissait, ce serait sous cette forme.
            assertNull(
                "un registre à nom réservé apparaît comme une ligne du coffre",
                appareil.findObject(By.textContains("gp:folders")),
            )
        }

        val nom = "Journal " + System.currentTimeMillis() % 100000
        etape("3. Création d'un élément") {
            toucher("button.new")
            poser("field.name", nom)
            poser("field.username", "clara")
            poser("field.password", "tr0ubad0ur")
            poser("field.uris", "connexion.example.com")
            toucher("button.save")
            attendre(
                By.text(nom),
                "l'élément créé n'apparaît pas dans le coffre. `Coffre.creer` relit ce que " +
                    "le serveur a rangé : son absence signale une écriture refusée ou un " +
                    "aller-retour qui n'a pas rendu l'élément",
            )
        }

        etape("4. Modification de cet élément") {
            toucher(By.text(nom), "l'élément créé")
            poser("field.username", "clara.vanacker")
            toucher("button.save")
            attendre(
                By.text("clara.vanacker"),
                "la modification n'est pas revenue du serveur",
            )
        }

        etape("5. Verrouillage") {
            toucher(By.text("Verrouiller"), "le bouton de verrouillage")
            attendre(
                By.desc("field.master"),
                "le verrouillage n'a pas ramené à l'écran d'entrée",
            )
        }

        etape("6. Un lien otpauth arrive coffre fermé") {
            lienDeSecondFacteurCoffreFerme(nom)
        }

        etape("7. Le remplissage automatique d'un formulaire tiers") {
            remplirLeFormulaireDEssai(nom)
        }
    }

    // ─── Les liens de second facteur (§9) ───

    /**
     * Le cas que le §9 décrit, et qu'aucun test unitaire n'atteint.
     *
     * « Le lien arrive souvent coffre fermé — on scanne un QR code, le système réveille
     * l'application, qui demande d'abord le mot de passe maître. Le jeter à ce moment-là
     * fait qu'on déverrouille pour rien. »
     *
     * On le rejoue donc exactement ainsi : **le coffre est verrouillé**, le lien arrive, on
     * déverrouille, et le formulaire doit s'ouvrir pré-rempli. Puis on annule — et rien ne
     * doit avoir été écrit. C'est la deuxième règle du §9, et celle qui compte le plus :
     * une URL venue du dehors qui écrirait seule serait un moyen d'ajouter des lignes dans
     * le coffre de quelqu'un d'autre.
     */
    private fun lienDeSecondFacteurCoffreFerme(nomDeLElementCree: String) {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        contexte.startActivity(
            Intent(Intent.ACTION_VIEW, android.net.Uri.parse(LIEN))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )

        // Le coffre est fermé : l'écran d'entrée doit rester à l'écran, et le lien être
        // **retenu** plutôt que jeté.
        poser("field.master", motDePasse)
        toucher("button.submit")

        attendre(
            By.text("Nouvel élément"),
            "le lien reçu coffre fermé n'a pas rouvert de formulaire après le " +
                "déverrouillage : il a été jeté au lieu d'être retenu, et l'utilisateur " +
                "aurait déverrouillé pour rien",
            40_000,
        )
        assertEquals(
            "le nom n'est pas pré-rempli depuis l'étiquette du lien",
            "Cachet",
            champEditable("field.name").text,
        )
        assertEquals(
            "l'identifiant n'est pas pré-rempli depuis l'étiquette du lien",
            "clara@example.com",
            champEditable("field.username").text,
        )
        assertEquals(
            "le champ de second facteur doit porter le lien **entier** — n'en garder que " +
                "le secret perdrait la période, le nombre de chiffres et l'algorithme",
            LIEN,
            champEditable("field.totp").text,
        )

        // Et rien ne s'écrit sans geste.
        toucher("button.cancel")
        attendre(By.text(nomDeLElementCree), "le coffre après l'annulation")
        assertNull(
            "un élément a été créé alors que l'utilisateur a annulé : une URL venue du " +
                "dehors ne doit jamais écrire seule dans le coffre",
            appareil.findObject(By.text("Cachet")),
        )
    }

    // ─── Le remplissage ───

    /**
     * Le parcours complet du remplissage, vu du dehors.
     *
     * L'écran de connexion d'essai est celui de la variante `debug`
     * ([ch.stackops.ghostpass.essai.ActiviteDEssaiDeConnexion]) : deux `EditText` ordinaires
     * avec leurs `autofillHints`, exactement ce qu'une application tierce déclare.
     *
     * La suggestion « Déverrouiller GhostPass » est une fenêtre **du système**. C'est la
     * raison pour laquelle ce parcours passe par UiAutomator : rien d'autre ne la voit.
     */
    private fun remplirLeFormulaireDEssai(nomAttendu: String) {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        contexte.startActivity(
            Intent().setClassName(
                contexte.packageName, "ch.stackops.ghostpass.essai.ActiviteDEssaiDeConnexion",
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        // ─── Toucher le champ, puis la suggestion — avec une seconde tentative ───
        //
        // Mesuré : ce passage échouait environ une fois sur deux, en s'arrêtant sur une
        // fenêtre du système (`paquet=android`) sans rien de nommé. Le service de
        // remplissage *augmenté* de Google s'intercale parfois entre le toucher et notre
        // écran, et la suggestion se referme sans rien ouvrir.
        //
        // Un témoin qui passe une fois sur deux est pire qu'un témoin absent : on le
        // relance jusqu'à ce qu'il passe, et il finit par ne plus rien dire. On retente donc
        // **une** fois, de façon bornée et visible, plutôt que de laisser le hasard décider.
        var ouvert = false
        for (tentative in 1..2) {
            attendre(
                By.res("ch.stackops.ghostpass:id/essai_identifiant"),
                "le formulaire d'essai ne s'est pas ouvert",
            ).click()

            attendre(
                By.textContains("Déverrouiller GhostPass"),
                "le système n'a proposé aucune ligne GhostPass. Le service de remplissage " +
                    "n'est peut-être pas celui de l'appareil — le script le règle avant de " +
                    "lancer ce parcours",
                15_000,
            ).click()

            // On attend **notre écran**, pas un champ : la distinction compte, car c'est
            // l'écran qui manquait, pas le champ.
            if (appareil.wait(Until.hasObject(By.desc("field.master")), 15_000) == true) {
                ouvert = true
                break
            }
            if (tentative == 1) {
                appareil.pressBack()
                appareil.waitForIdle()
            }
        }
        assertTrue(
            "l'écran de remplissage ne s'est pas ouvert après deux tentatives : " +
                "l'intention en attente du service n'aboutit pas",
            ouvert,
        )

        // L'écran de remplissage : ici le coffre est **fermé** — c'est le cas que
        // `docs/adr/0002` décrit, le service lié alors que l'interface n'a rien ouvert.
        poser("field.master", motDePasse)
        toucher("button.submit")

        toucher(By.text(nomAttendu), "l'identifiant proposé")

        // Et le champ est rempli. C'est la seule assertion qui compte de tout ce fichier :
        // c'est la fonction principale du produit.
        val identifiant = attendre(
            By.res("ch.stackops.ghostpass:id/essai_identifiant"),
            "le formulaire n'est pas revenu au premier plan après le choix",
        )
        assertEquals(
            "LE CHAMP N'A PAS ÉTÉ REMPLI. C'est la fonction principale du produit.\n" +
                "Vérifiez le niveau d'authentification du remplissage : posée sur la " +
                "réponse, elle attend une FillResponse ; posée sur le jeu, un Dataset. Se " +
                "tromper ne produit aucune erreur — seulement un champ vide et " +
                "« invalid index (65535) » au journal.",
            "clara.vanacker",
            identifiant.text,
        )
        val motDePasseRempli = appareil.findObject(
            By.res("ch.stackops.ghostpass:id/essai_mot_de_passe"))
        assertNotNull("le champ de mot de passe a disparu", motDePasseRempli)
        assertEquals(
            "le mot de passe n'a pas la longueur attendue — le second champ du jeu n'a pas " +
                "été posé",
            "tr0ubad0ur".length,
            motDePasseRempli.text.length,
        )
    }

    // ─── Outillage ───

    private fun ouvrirLApplication() {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        val intention = contexte.packageManager
            .getLaunchIntentForPackage(contexte.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ?: throw AssertionError("GhostPass n'est pas installé sur cet appareil.")
        contexte.startActivity(intention)
        attendre(
            By.desc("field.master"),
            "l'écran d'entrée ne s'est pas affiché. L'application a-t-elle bien été " +
                "réinitialisée (`pm clear`) avant ce parcours ?",
            20_000,
        )
    }

    private fun etape(intitule: String, corps: () -> Unit) {
        try {
            corps()
        } catch (e: Throwable) {
            // Le nom de l'étape dans le message : sans lui, un parcours de six étapes rend
            // « expected X but was Y » et laisse chercher où l'on en était.
            throw AssertionError("[$intitule] ${e.message}", e)
        }
    }

    /**
     * Le nœud **éditable** d'un champ, qui n'est pas celui qui porte son identifiant.
     *
     * Mesuré, et c'est le genre d'écart qui fait chercher au mauvais endroit : un
     * `TextField` de Compose portant `Modifier.semantics { contentDescription = … }` produit
     * **deux** nœuds d'accessibilité aux mêmes coordonnées — l'un porte la description et
     * aucun texte, l'autre porte le texte et aucune description. `setText` sur le premier
     * ne fait rien, et ne se plaint pas.
     *
     * On repère donc par la description, puis on prend le champ de saisie qui occupe la
     * même place. Un clic au bon endroit aurait suffi à un humain ; il faut le dire à la
     * machine.
     */
    private fun champEditable(identifiant: String): UiObject2 {
        val repere = amenerDansLaZoneSure(By.desc(identifiant), "le champ « $identifiant »")
        val zone = repere.visibleBounds
        val editable = appareil.findObjects(By.clazz("android.widget.EditText"))
            .firstOrNull { Rect.intersects(it.visibleBounds, zone) }
        return editable ?: repere
    }

    /**
     * Pose une valeur dans un champ, **et vérifie qu'elle y est**.
     *
     * La vérification n'est pas de la superstition : c'est elle qui a fait abandonner
     * `adb shell input text`, et c'est elle qui a révélé le double nœud ci-dessus. Un champ
     * à moitié rempli produit plus loin une erreur d'authentification, et on cherche un
     * défaut du produit là où il n'y en a pas.
     *
     * Les champs secrets ne rendent que des puces : on compare alors les longueurs.
     */
    private fun poser(identifiant: String, valeur: String) {
        // **La poignée est retrouvée avant chaque geste, jamais réutilisée.**
        //
        // Mesuré : `UiObject2` garde une référence à un nœud d'accessibilité, et Compose le
        // remplace à la moindre recomposition — un curseur qui clignote suffit. Le premier
        // jet gardait la poignée entre le clic et la saisie, et tombait de temps en temps
        // sur `StaleObjectException`. « De temps en temps » est la pire fréquence : on
        // relance, ça passe, et on apprend à ne plus lire le rouge.
        avecRepriseSurObsolescence { champEditable(identifiant).click() }
        appareil.waitForIdle()
        avecRepriseSurObsolescence { champEditable(identifiant).setText(valeur) }
        appareil.waitForIdle()

        val relu = avecRepriseSurObsolescence { champEditable(identifiant).text }
        val pose = relu == valeur || (relu != null && relu.length == valeur.length &&
            relu.toSet().size == 1)
        assertTrue(
            "la saisie du champ « $identifiant » n'a pas pris : attendu ${valeur.length} " +
                "caractères, l'écran en montre ${relu?.length ?: 0}",
            pose,
        )
    }

    private fun toucher(identifiant: String) = toucher(By.desc(identifiant), "« $identifiant »")

    private fun toucher(selecteur: BySelector, quoi: String) {
        avecRepriseSurObsolescence { amenerDansLaZoneSure(selecteur, quoi).click() }
        appareil.waitForIdle()
    }

    /**
     * Rejoue un geste dont la poignée a expiré.
     *
     * `StaleObjectException` ne dit pas que le produit a un défaut : elle dit que l'arbre
     * d'accessibilité a changé entre le moment où l'on a trouvé le nœud et celui où on s'en
     * est servi. Sous Compose, cela arrive sans raison particulière. Retrouver et rejouer
     * est la bonne réponse ; laisser passer l'exception ferait accuser le produit.
     *
     * Trois essais et pas davantage : au-delà, ce n'est plus une recomposition, c'est un
     * écran qui bouge sans arrêt — et cela, il faut le voir.
     */
    private fun <T> avecRepriseSurObsolescence(geste: () -> T): T {
        var derniere: StaleObjectException? = null
        repeat(3) {
            try {
                return geste()
            } catch (e: StaleObjectException) {
                derniere = e
                appareil.waitForIdle()
            }
        }
        throw AssertionError(
            "l'arbre d'accessibilité a changé trois fois de suite sous le geste : l'écran " +
                "ne se stabilise pas",
            derniere,
        )
    }

    /**
     * Le bas réellement utilisable de l'écran : au-dessus du clavier s'il est déployé.
     *
     * **C'est la correction qui a débloqué ce parcours, et le diagnostic a mis du temps.**
     * Symptôme : après avoir rempli le formulaire, le clic sur « Se connecter » ne produisait
     * rien — pas d'erreur, pas de requête au serveur, un écran immobile. On cherche alors du
     * côté du réseau, ou d'un bouton désactivé.
     *
     * Cause : le clavier occupe le bas de l'écran et **recouvre le bouton**. `UiObject2.click()`
     * vise le centre des limites du bouton, qui sont celles de la mise en page — le clic
     * atterrit donc sur une touche. Ce n'était pas silencieux une fois qu'on savait regarder :
     * les champs déjà remplis portaient un caractère de trop, « clara.vanackery » pour
     * « clara.vanacker ». La lettre tapée était la preuve, dans la hiérarchie d'accessibilité.
     *
     * On lit donc la **fenêtre d'accessibilité** du clavier et on prend son bord supérieur.
     * Le premier essai pressait « retour » à la place : la fenêtre de type `TYPE_INPUT_METHOD`
     * existe **même clavier replié**, si bien qu'on pressait « retour » sur l'écran d'entrée
     * — ce qui quitte l'application. Sa seule présence ne dit rien ; ce sont ses limites qui
     * parlent.
     */
    private fun basUtile(): Int {
        val hauteur = appareil.displayHeight
        val cadre = Rect()
        val clavier = runCatching {
            InstrumentationRegistry.getInstrumentation().uiAutomation.windows
                .firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
        }.getOrNull()
        clavier?.getBoundsInScreen(cadre)
        // Un clavier replié rend des limites vides, ou posées au ras du bas de l'écran.
        val deploye = cadre.height() > 0 && cadre.top in 1 until hauteur
        return if (deploye) cadre.top else hauteur - MARGE_DE_GESTES
    }

    /**
     * Amène la cible à un endroit où un clic l'atteint vraiment.
     *
     * Fait défiler tant que la cible passe sous le bas utile ([basUtile]) — clavier déployé
     * ou marge de gestes. En dernier recours, si le défilement ne peut plus rien (contenu
     * qui tient dans l'écran) **et** que le clavier est bien déployé, on le referme : à ce
     * moment-là « retour » vise le clavier et non l'écran, et le geste est sans danger.
     */
    private fun amenerDansLaZoneSure(selecteur: BySelector, quoi: String): UiObject2 {
        var cible = attendre(selecteur, quoi)
        repeat(4) {
            if (cible.visibleBounds.bottom <= basUtile()) return cible
            appareil.swipe(
                appareil.displayWidth / 2, (appareil.displayHeight * 0.55).toInt(),
                appareil.displayWidth / 2, (appareil.displayHeight * 0.30).toInt(),
                12,
            )
            appareil.waitForIdle()
            cible = attendre(selecteur, quoi)
        }
        if (basUtile() < appareil.displayHeight - MARGE_DE_GESTES) {
            appareil.pressBack()
            appareil.waitForIdle()
            cible = attendre(selecteur, quoi)
        }
        return cible
    }

    private fun attendre(
        selecteur: BySelector,
        quoi: String,
        // 25 s et non 12 : la dérivation Argon2id demande 64 MiB et trois passes, et sur
        // un émulateur elle prend plusieurs secondes pendant lesquelles l'écran ne bouge
        // pas. Un délai trop court fait rougir un produit qui fonctionne — le pire des
        // témoins, celui qu'on finit par relancer jusqu'à ce qu'il passe.
        millisecondes: Long = 25_000,
    ): UiObject2 =
        appareil.wait(Until.findObject(selecteur), millisecondes)
            ?: throw AssertionError(
                "introuvable après ${millisecondes / 1000} s : $quoi\n" +
                    "Ce que l'écran montrait à cet instant : ${ecranActuel()}\n" +
                    "Hiérarchie complète : ${hierarchieDeSecours()}",
            )

    /**
     * Écrit l'arbre d'accessibilité complet, pour les échecs que le résumé n'explique pas.
     *
     * `ecranActuel()` ne liste que ce qui porte un nom, et il s'est trouvé un cas où il ne
     * listait presque rien alors que l'écran était plein. Le fichier, lui, ne ment pas.
     */
    private fun hierarchieDeSecours(): String = runCatching {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        val fichier = java.io.File(contexte.externalCacheDir, "echec-parcours.xml")
        appareil.dumpWindowHierarchy(fichier)
        fichier.absolutePath
    }.getOrElse { "non écrite (${it.message})" }

    /**
     * Ce qu'il y a à l'écran, pour le message d'échec.
     *
     * Sans cela, un parcours qui tombe dit « introuvable » et laisse deviner où l'on en
     * était — sur un écran de connexion resté en place, sur une boîte du système, ou sur le
     * bureau parce que l'application a disparu. Les trois demandent des corrections
     * différentes, et les distinguer coûte une ligne.
     */
    private fun ecranActuel(): String {
        val vus = appareil.findObjects(By.pkg(appareil.currentPackageName))
            .mapNotNull { objet ->
                val texte = runCatching { objet.text }.getOrNull()
                val description = runCatching { objet.contentDescription }.getOrNull()
                listOfNotNull(texte, description).firstOrNull { it.isNotBlank() }
            }
            .distinct()
            .take(15)
        return "[paquet=${appareil.currentPackageName}] " +
            if (vus.isEmpty()) "(rien de nommé)" else vus.joinToString(" · ")
    }

    private companion object {
        /**
         * La hauteur, en points, que la navigation par gestes se réserve en bas d'écran.
         *
         * 48 dp est la mesure d'Android ; on en prend un peu plus, parce qu'un toucher au
         * ras de la limite est intercepté une fois sur deux — et un parcours qui échoue une
         * fois sur deux est pire qu'un parcours absent.
         */
        const val MARGE_DE_GESTES = 60

        /**
         * Le lien d'essai. `issuer` et le chemin s'accordent ici : ce que le parcours mesure
         * est la **rétention**, pas la règle d'étiquette — celle-ci a ses vecteurs dans
         * [LienOtpauthTest], portés de ceux d'iOS.
         */
        const val LIEN =
            "otpauth://totp/Cachet:clara@example.com?secret=GEZDGNBVGY3TQOJQ&issuer=Cachet"
    }
}
