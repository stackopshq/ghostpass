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

        etape("2 bis. Le coffre d'équipe") {
            coffreDEquipe()
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
            toucherJusqua("button.save", By.desc("button.settings"), "le retour au coffre")
            attendre(
                By.text("clara.vanacker"),
                "la modification n'est pas revenue du serveur",
            )
        }

        etape("5. Les registres à nom réservé s'écrivent") {
            registres(nom)
        }

        etape("6. Le partage de lien") {
            partager(nom)
        }

        etape("7. La corbeille") {
            corbeille(nom)
        }

        etape("8. Verrouillage, à la main puis en passant à l'arrière-plan") {
            ouvrirLesReglages()
            toucher("button.lock")
            attendre(
                By.desc("field.master"),
                "le verrouillage n'a pas ramené à l'écran d'entrée",
            )
            poser("field.master", motDePasse)
            toucher("button.submit")
            attendre(By.text(nom), "le redéverrouillage hors ligne n'a pas rouvert le coffre")

            // **Le passage à l'arrière-plan doit verrouiller.** `onStop` l'annonçait dans son
            // commentaire et ne le faisait pas : le coffre restait ouvert, et un téléphone
            // posé puis repris rouvrait la liste sans rien demander. Rien ne le signalait —
            // l'application marchait *mieux* ainsi.
            ouvrirLeFormulaireDEssai()
            ouvrirLApplication()
            attendre(
                By.desc("field.master"),
                "LE COFFRE EST RESTÉ OUVERT après un passage à l'arrière-plan. C'est ce que " +
                    "le commentaire d'`onStop` annonce depuis le premier jour, et ce que " +
                    "`FLAG_SECURE` suppose en cachant la vignette d'un coffre ouvert",
                20_000,
            )
        }

        etape("9. Un lien otpauth arrive coffre fermé") {
            lienDeSecondFacteurCoffreFerme(nom)
        }

        etape("10. Le remplissage automatique d'un formulaire tiers") {
            remplirLeFormulaireDEssai(nom)
        }
    }

    // ─── Les coffres d'équipe ───

    /**
     * **Le défaut le plus grave qu'ait connu ce portage, et le plus silencieux.**
     *
     * L'application n'appelait que `/api/vault/items`, le coffre personnel. Quelqu'un dont
     * les mots de passe vivent en collection d'équipe se connectait, voyait une liste vide,
     * et concluait que ses données avaient disparu. Aucune erreur, aucun journal, rien à
     * chercher — mesuré sur un vrai téléphone, invisible à toute relecture.
     *
     * Cette étape vérifie les quatre règles d'un coup :
     *
     *  1. l'organisation apparaît et s'ouvre ;
     *  2. son élément se déchiffre **sous l'Org Key**, pas sous la clé du coffre ;
     *  3. l'élément scellé sous une **autre** Org Key garde sa place et dit pourquoi (§5) ;
     *  4. l'éditeur s'y ouvre en **lecture seule** — l'y laisser enregistrer déplacerait
     *     l'élément dans le coffre personnel, où l'équipe ne le retrouverait jamais.
     */
    private fun coffreDEquipe() {
        val organisation = attendre(
            By.descStartsWith("chip.org."),
            "aucune organisation n'apparaît : l'application n'interroge pas `/api/orgs`, et " +
                "un coffre d'équipe reste invisible — c'est le défaut du coffre vide",
            30_000,
        )
        organisation.click()
        appareil.waitForIdle()

        attendre(
            By.text("Routeur de l'agence"),
            "l'élément d'équipe ne s'affiche pas : l'Org Key n'a pas été ouverte, ou les " +
                "éléments ont été déchiffrés sous la mauvaise clé",
            30_000,
        )
        assertNotNull(
            "l'élément scellé sous une autre Org Key a disparu de la collection. C'est la " +
                "règle §5, et elle compte plus encore en équipe : son absence se lirait " +
                "« cette personne ne l'a pas encore créé »",
            appareil.findObject(By.text("Élément illisible")),
        )

        // Lecture seule : ni « Nouveau » dans la barre, ni « Enregistrer » dans l'éditeur.
        assertNull(
            "« Nouveau » est proposé dans une collection d'équipe : l'éditeur écrit dans le " +
                "coffre personnel, et l'élément sortirait de l'équipe sans que personne ne " +
                "sache où il est passé",
            appareil.findObject(By.desc("button.new")),
        )
        toucher(By.text("Routeur de l'agence"), "l'élément d'équipe")
        attendre(
            By.textContains("pas encore le modifier"),
            "l'éditeur d'un élément d'équipe ne dit pas qu'il est en lecture seule",
        )
        assertNull(
            "« Enregistrer » est proposé sur un élément d'équipe",
            appareil.findObject(By.desc("button.save")),
        )
        toucherJusqua("button.cancel", By.desc("button.settings"), "le retour au coffre")

        // Et l'on revient au coffre personnel, qui doit être intact.
        toucher("chip.personal")
        attendre(By.text("Forgejo"), "le retour au coffre personnel")
    }

    /**
     * La ligne du coffre portant ce nom — **la plus basse** des correspondances.
     *
     * Dès qu'une recherche est saisie, le nom figure à l'écran deux fois : dans le champ et
     * dans la ligne. `findObject` rend le premier venu, c'est-à-dire le champ, et le toucher
     * n'ouvre rien. La ligne est toujours sous le champ ; c'est le seul repère fiable.
     */
    private fun ligneDuCoffre(nom: String): UiObject2 {
        attendre(By.text(nom), "l'élément « $nom »")
        return appareil.findObjects(By.text(nom)).maxByOrNull { it.visibleBounds.top }
            ?: throw AssertionError("l'élément « $nom » a disparu entre deux regards")
    }

    /** Ouvre le menu de réglages, où vivent le verrouillage, la corbeille et la biométrie. */
    private fun ouvrirLesReglages() {
        toucherJusqua("button.settings", By.desc("button.lock"), "le menu de réglages")
    }

    /**
     * Touche, **et vérifie que le toucher a produit son effet**.
     *
     * Un écran qui vient de s'ouvrir bouge encore : `UiObject2.click()` vise le centre des
     * limites relevées à l'instant précédent, et une animation d'un dixième de seconde suffit
     * pour que le doigt tombe à côté. Rien ne le signale — le clic « réussit », et c'est
     * l'assertion suivante qui échoue, trente secondes plus tard, en accusant le produit.
     *
     * On rejoue donc jusqu'à trois fois, en attendant à chaque tour ce que le toucher devait
     * provoquer. Ce n'est pas une temporisation déguisée : c'est la différence entre
     * « j'ai cliqué » et « il s'est passé quelque chose ».
     */
    /** La même chose, sur une cible désignée par un sélecteur plutôt qu'un identifiant. */
    private fun toucherJusqua2(cible: BySelector, attendu: BySelector, quoi: String) {
        repeat(3) {
            toucher(cible, quoi)
            if (appareil.wait(Until.hasObject(attendu), 4_000) == true) return
        }
        throw AssertionError(
            "après trois touchers, $quoi n'est toujours pas là.\nÉcran : ${ecranActuel()}",
        )
    }

    private fun toucherJusqua(identifiant: String, attendu: BySelector, quoi: String) {
        repeat(3) {
            toucher(identifiant)
            if (appareil.wait(Until.hasObject(attendu), 4_000) == true) return
        }
        throw AssertionError(
            "après trois touchers de « $identifiant », $quoi n'est toujours pas là.\n" +
                "Écran : ${ecranActuel()}",
        )
    }

    // ─── Les registres en écriture (§2) ───

    /**
     * Favori et dossier vide : deux registres, deux façons de disparaître en silence.
     *
     * Ce qui se joue : un registre écrit de travers ne fait échouer personne. Il se relit
     * vide, l'utilisateur perd ses favoris, et il n'y a aucune erreur à chercher. On vérifie
     * donc la **persistance après relecture du coffre**, pas seulement l'état de l'écran —
     * une étoile allumée dans une composition ne prouve rien tant que le serveur ne l'a pas
     * rendue.
     */
    private fun registres(nomDeLElement: String) {
        val identifiant = identifiantDe(nomDeLElement)
        toucher("button.favorite.$identifiant.off")
        // `rafraichir` suit l'écriture : quand l'étoile revient allumée, elle vient du
        // coffre **relu**, pas d'un état local. C'est la différence entre « on a écrit » et
        // « le serveur a gardé ».
        //
        // L'état se lit dans la description et non dans le texte : une `contentDescription`
        // **remplace** le texte du nœud d'accessibilité au lieu de s'y ajouter, si bien que
        // le « ★ » n'est visible d'aucune machine. Le premier jet attendait ce caractère et
        // ne l'a jamais vu, sur un écran qui l'affichait.
        attendre(
            By.desc("button.favorite.$identifiant.on"),
            "le favori n'est pas revenu du coffre après écriture : le registre a peut-être " +
                "été écrit sous un nom sans octet NUL, ou pas écrit du tout",
            30_000,
        )

        toucher("button.folders")
        poser("field.newFolder", "Essai/Dossier")
        toucher("button.addFolder")
        attendre(
            By.text("Essai/Dossier"),
            "le dossier vide n'a pas été inscrit au registre : un dossier sans élément " +
                "n'existe que là, et sans lui il s'évapore",
            30_000,
        )

        // Et il se retire — le registre se **réécrit**, il ne fait pas que croître.
        toucher(By.text("Retirer"), "le retrait du dossier vide")
        appareil.wait(Until.gone(By.text("Essai/Dossier")), 30_000)
        assertNull(
            "le dossier vide retiré est resté : le registre ne se réécrit pas",
            appareil.findObject(By.text("Essai/Dossier")),
        )
        toucher("button.folders")
    }

    /**
     * L'identifiant serveur d'un élément, tel que l'étoile le porte dans sa description.
     *
     * On apparie par **recouvrement vertical**, et non par intersection des boîtes : le nom
     * est à gauche de la ligne, l'étoile à droite, et leurs rectangles ne se touchent pas.
     * Le premier jet les intersectait et ne trouvait jamais rien — « aucune étoile en face
     * de … », sur un écran qui en portait une.
     */
    private fun identifiantDe(nom: String): String {
        val ligne = attendre(By.text(nom), "l'élément « $nom »").visibleBounds
        val etoile = appareil.findObjects(By.descStartsWith("button.favorite."))
            .firstOrNull { it.visibleBounds.centerY() in ligne.top..ligne.bottom }
            ?: throw AssertionError(
                "aucune étoile sur la ligne de « $nom » — l'étoile n'est proposée que dans " +
                    "le coffre personnel, jamais sur un élément d'équipe",
            )
        return etoile.contentDescription
            .removePrefix("button.favorite.")
            .removeSuffix(".on")
            .removeSuffix(".off")
    }

    // ─── Le partage de lien (§4) ───

    /**
     * Crée un lien de partage et **le dépose pour le script**.
     *
     * Le script l'ouvre ensuite avec **WebCrypto** — l'implémentation du navigateur qui
     * ouvrira réellement le lien chez le destinataire. C'est le seul contrôle qui vaille :
     * `contrat.json` le dit en toutes lettres, « un témoin qui vérifie qu'un côté se relit
     * lui-même passe au vert dans le monde cassé ». Un aller-retour par le seul cœur
     * réussirait aussi bien en XChaCha20 qu'en AES-GCM, et aucun partage ne traverserait.
     */
    private fun partager(nomDeLElement: String) {
        toucher(By.text(nomDeLElement), "l'élément à partager")
        toucher("button.share")
        toucher("button.createShare")

        // Le serveur de cette branche ne rend qu'un identifiant : le lien retombe sur
        // l'adresse saisie, qui est de confiance par construction. Aucune confirmation de
        // destination n'est donc attendue ici — celle-ci demande un serveur à relais.
        val lien = attendre(
            By.textContains("#"),
            "aucun lien de partage n'est apparu",
            30_000,
        ).text
        assertTrue(
            "le lien doit porter la clé dans son fragment, après le « # »",
            lien.substringAfter('#').length >= 40,
        )
        deposer("lien-de-partage.txt", lien)

        toucher("button.closeLink")
        // On attend un repère **propre au coffre**, et non le nom de l'élément : l'éditeur
        // porte ce nom dans son propre champ, si bien qu'attendre le nom était satisfait
        // sans que l'écran ait changé. Les étapes suivantes se déroulaient alors dans
        // l'éditeur, en accusant tout autre chose.
        toucherJusqua("button.cancel", By.desc("button.settings"), "le retour au coffre")
    }

    // ─── La corbeille ───

    /**
     * Supprimer met à la corbeille, et la corbeille rend.
     *
     * Le `DELETE` du serveur est un effacement **doux** : sans cet écran, la nuance était
     * invisible — l'utilisateur croyait détruire, et le serveur gardait tout.
     */
    private fun corbeille(nomDeLElement: String) {
        // On filtre d'abord : une liste réduite à une ligne retire toute ambiguïté de
        // défilement, et fait au passage travailler la recherche. Chercher l'élément dans
        // une liste de six lignes sur un écran qui défile, c'était laisser le hasard décider
        // sur quelle ligne le doigt tombe.
        poser("field.search", nomDeLElement)
        // **La ligne, pas le champ.** Une fois la recherche saisie, le nom apparaît deux
        // fois à l'écran : dans le champ et dans la ligne. `findObject` rendait le premier —
        // le champ — et le toucher n'ouvrait rien. On prend donc le plus bas des deux.
        repeat(3) {
            ligneDuCoffre(nomDeLElement).click()
            appareil.waitForIdle()
            if (appareil.wait(Until.hasObject(By.desc("button.delete")), 4_000) == true) return@repeat
        }
        attendre(By.desc("button.delete"), "l'éditeur de l'élément")

        // Deux gestes, et on **attend le changement de libellé entre les deux**. Les
        // enchaîner à l'aveugle laissait la seconde pression atterrir ailleurs si l'écran
        // avait défilé entre-temps : l'éditeur restait ouvert, et le nom qu'on cherchait
        // était celui de son propre champ. Le test accusait alors le serveur.
        toucherJusqua(
            "button.delete",
            By.text("Confirmer la suppression"),
            "la demande de confirmation",
        )
        toucher("button.delete")

        // L'éditeur doit s'être refermé avant qu'on regarde la liste.
        attendre(By.desc("button.settings"), "le retour au coffre après la suppression", 30_000)
        appareil.wait(Until.gone(By.text(nomDeLElement)), 30_000)
        assertNull(
            "l'élément supprimé est resté dans le coffre.\n" +
                "Écran : ${ecranActuel()}",
            appareil.findObject(By.text(nomDeLElement)),
        )

        ouvrirLesReglages()
        toucher("button.trash")
        attendre(
            By.text(nomDeLElement),
            "l'élément supprimé n'est pas dans la corbeille : le serveur l'aurait détruit " +
                "alors qu'il ne fait que le marquer",
            30_000,
        )
        toucher("button.restore")
        toucher("button.backFromTrash")
        attendre(
            By.text(nomDeLElement),
            "l'élément restauré n'est pas revenu au coffre",
            30_000,
        )
        poser("field.search", "")
    }

    /** Dépose un texte que le script pourra lire. */
    private fun deposer(nom: String, contenu: String) {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        java.io.File(contexte.externalCacheDir, nom).writeText(contenu)
    }

    /** Ouvre le formulaire d'essai, sans rien en attendre. */
    private fun ouvrirLeFormulaireDEssai() {
        val contexte = InstrumentationRegistry.getInstrumentation().targetContext
        contexte.startActivity(
            Intent().setClassName(
                contexte.packageName, "ch.stackops.ghostpass.essai.ActiviteDEssaiDeConnexion",
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        attendre(
            By.res("ch.stackops.ghostpass:id/essai_identifiant"),
            "le formulaire d'essai ne s'est pas ouvert",
        )
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
            .take(40)
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
