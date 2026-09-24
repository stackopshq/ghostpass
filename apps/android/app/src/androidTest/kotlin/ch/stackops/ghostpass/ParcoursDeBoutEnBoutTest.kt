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
import java.util.regex.Pattern
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

        etape("2 ter. L'accueil fond les deux origines") {
            lAccueilFondLesDeuxOrigines()
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
            ouvrirLElement(nom)
            poser("field.username", "clara.vanacker")
            toucherJusqua("button.save", By.res("button.settings"), "le retour au coffre")
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
                By.res("field.master"),
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
                By.res("field.master"),
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

    /**
     * **Le SSO, du bouton jusqu'au coffre ouvert.**
     *
     * Lancé séparément par `tools/android/temoin-du-sso-a-l-ecran.sh`, parce qu'il exige un
     * état vierge et un banc à fournisseur d'identité. Ce que les autres témoins du SSO ne
     * couvrent pas :
     *
     *  - `temoin-du-sso-mobile.sh` éprouve le **client** — PKCE, état, échange — mais mène
     *    lui-même le flux en ligne de commande. Le navigateur n'y entre jamais ;
     *  - `SsoMobileTest` éprouve le calcul et la lecture du retour, hors de tout appareil.
     *
     * Restait le chaînon qui les relie et qu'aucun des deux ne touche : l'onglet de
     * navigateur s'ouvre-t-il, la chaîne de redirections revient-elle **dans l'application**
     * par son schéma d'URL, et l'application en fait-elle une session ? C'est là que vit le
     * défaut qu'iOS a connu — un schéma qui ne correspond pas à l'identifiant du paquet, et
     * le navigateur se referme sur une page morte sans que rien ne l'explique.
     *
     * Le SSO **authentifie, il n'ouvre pas le coffre** : le mot de passe maître reste
     * demandé ensuite, et ce test l'exige.
     */
    @Test
    fun leSsoDepuisLEcran() {
        ouvrirLApplication()

        etape("1. Le bouton d'authentification unique") {
            poser("field.server", serveur)
            attendre(
                By.res("button.sso"),
                "le bouton d'authentification unique n'apparaît pas alors qu'une adresse de " +
                    "serveur est saisie",
            )
            toucher("button.sso")
        }

        etape("2. Le navigateur suit la chaîne et revient dans l'application") {
            // Une minute : l'onglet s'ouvre, l'IdP signe, trois redirections s'enchaînent, et
            // l'émulateur n'est pas rapide. Un délai court ferait rougir un produit qui
            // marche — le pire des témoins.
            attendre(
                By.textContains("Identité vérifiée"),
                "le retour du navigateur n'a pas atteint l'application. Le schéma d'URL ne " +
                    "correspond peut-être pas à l'identifiant du paquet : le navigateur se " +
                    "referme alors sur une page morte, et rien ne l'explique",
                90_000,
            )
        }

        etape("3. Le SSO n'ouvre pas le coffre : le mot de passe maître reste demandé") {
            attendre(
                By.res("field.master"),
                "l'écran ne demande pas le mot de passe maître après le SSO",
            )
            assertNull(
                "le coffre s'est ouvert sans mot de passe maître : le SSO authentifie " +
                    "l'identité, il n'ouvre pas le coffre. Les confondre est la première " +
                    "erreur de conception d'un client à connaissance nulle",
                appareil.findObject(By.res("button.settings")),
            )
            poser("field.master", motDePasse)
            toucher("button.submit")
            attendre(
                By.text("Forgejo"),
                "le coffre ne s'est pas ouvert avec le mot de passe maître après le SSO",
                40_000,
            )
        }
    }

    // ─── L'accueil, qui contient tout le coffre ───

    /**
     * **Une seule liste, et chaque ligne dit d'où elle vient.**
     *
     * Le défaut que cette étape garde fermé : l'organisation était un lieu où l'on entrait,
     * et l'accueil ne pouvait pas montrer son contenu. Pour un compte dont **tous** les mots
     * de passe vivent en équipe — celui de Clara — l'application ouvrait sur « Ce coffre est
     * vide ». Aucune erreur, et l'apparence exacte d'une perte de données.
     *
     * ## Pourquoi cette étape sait rougir
     *
     * Un témoin qui compterait « au moins un élément » serait vert des deux côtés de la
     * mutation : le coffre personnel suffirait à le satisfaire. Trois affirmations
     * distinctes le rendent falsifiable, et chacune tombe pour une raison différente :
     *
     *  - `Forgejo` **et** `Routeur de l'agence` sur le même écran, sans être entré nulle
     *    part. Retirer la fusion fait disparaître le second ;
     *  - la marque « Équipe StackOps · Coffre partagé » est affichée. Retirer le marquage la
     *    fait disparaître, alors même que la liste resterait complète ;
     *  - la marque est sur la ligne du **routeur**, pas sur celle de Forgejo. Marquer tout
     *    le monde — ou personne — fait tomber celle-ci, et c'est elle qui porte le mot
     *    « distinguables » : une liste unique où rien ne séparerait les deux origines serait
     *    pire que deux listes, puisqu'on croirait tout pouvoir modifier.
     */
    private fun lAccueilFondLesDeuxOrigines() {
        // ─── 1. Les deux origines sont dans la même liste ───
        //
        // Sans recherche, sans être entré nulle part : c'est l'accueil tel qu'il s'ouvre.
        // La liste porte six lignes sur un écran de 540×1200, donc on défile — l'absence
        // d'un élément présent mais plus bas accuserait la fusion à tort.
        faireApparaitre("Forgejo")
        attendre(By.text("Forgejo"), "l'élément personnel « Forgejo » à l'accueil")
        faireApparaitre("Routeur de l'agence")
        attendre(
            By.text("Routeur de l'agence"),
            "l'accueil ne montre pas l'élément d'équipe « Routeur de l'agence ». C'est le " +
                "défaut qui ressemble à une perte de données : pour un compte dont tous les " +
                "mots de passe vivent en organisation, cet écran est vide et ne dit rien",
            30_000,
        )

        // ─── 2. Et chacune se distingue de l'autre ───
        //
        // **La recherche isole une ligne à la fois**, et c'est ce qui rend le contrôle
        // concluant plutôt qu'approximatif. Apparier une marque à sa ligne par les
        // coordonnées s'est révélé faux au premier essai : les lignes illisibles n'ont pas
        // de nom, se rangent donc en tête, et **portent une marque elles aussi** — la
        // première marque de l'écran n'appartenait à aucun nom. Dès qu'une recherche est
        // active, l'écran ne porte plus qu'un élément, et « la marque est là » ne peut plus
        // vouloir dire « la marque est ailleurs ».
        neGarderQue("Routeur de l'agence")
        attendre(
            By.text(MARQUE_DEQUIPE),
            "la ligne d'équipe ne porte pas sa marque « $MARQUE_DEQUIPE ». La liste peut " +
                "être complète et rester illisible : sans marque, on ne sait pas qui voit " +
                "quoi, ni ce qu'on a le droit de modifier",
            15_000,
        )
        // L'étoile n'est pas proposée ici : elle écrit dans un registre du coffre
        // **personnel**, que l'équipe ne relirait jamais.
        assertNull(
            "l'étoile des favoris est proposée sur un élément d'équipe : elle y écrirait un " +
                "favori dans un registre personnel, que personne ne relirait de ce côté",
            appareil.findObject(parPrefixe("button.favorite.")),
        )

        neGarderQue("Forgejo")
        // Le pendant, et c'est lui qui porte le mot « distinguables » : marquer tout le
        // monde reviendrait à ne marquer personne.
        assertNull(
            "l'élément personnel porte lui aussi une marque d'équipe. Les deux origines " +
                "redeviennent indistinguables dans une liste qui les mélange, ce qui est " +
                "pire que deux listes séparées : on croit tout pouvoir modifier",
            appareil.findObject(By.text(MARQUE_DEQUIPE)),
        )
        // Et le contrôle du contrôle : l'étoile **est** là sur un élément personnel. Sans
        // cette ligne, l'assertion d'au-dessus passerait aussi si l'écran n'affichait rien.
        assertNotNull(
            "aucune étoile sur un élément personnel : l'assertion précédente ne mesurerait " +
                "alors qu'un écran vide",
            appareil.findObject(parPrefixe("button.favorite.")),
        )
        neGarderQue("")
    }

    /**
     * Ne laisse à l'écran que les éléments dont le nom contient ce texte.
     *
     * Une recherche vide rend la liste entière. On passe par le champ du produit plutôt que
     * par un défilement : un contrôle qui dépend de ce qui se trouve à l'écran au moment où
     * on regarde n'est pas un contrôle, c'est une coïncidence reproductible.
     */
    private fun neGarderQue(texte: String) {
        poser("field.search", texte)
        appareil.waitForIdle()
    }

    /**
     * Fait défiler la liste jusqu'à ce que ce nom soit visible.
     *
     * L'accueil porte désormais **les deux origines** : il est plus long qu'avant, et sur
     * l'écran de 540×1200 du parcours il déborde. Sans ce défilement, l'étape tomberait sur
     * « introuvable » pour un élément parfaitement présent — un message qui accuse la fusion
     * là où c'est la hauteur de l'écran qui manque.
     */
    private fun faireApparaitre(nom: String) {
        repeat(4) {
            if (appareil.hasObject(By.text(nom))) return
            appareil.swipe(
                appareil.displayWidth / 2,
                (appareil.displayHeight * 0.7).toInt(),
                appareil.displayWidth / 2,
                (appareil.displayHeight * 0.35).toInt(),
                8,
            )
            appareil.waitForIdle()
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
     *  4. une ligne illisible ne s'ouvre pas : enregistrer par-dessus écraserait un contenu
     *     que personne n'a jamais lu ;
     *  5. l'écriture part vers `/api/orgs/…/items`, et ce qu'elle crée **revient à l'accueil
     *     avec sa marque** — c'est ce qui distingue « il est là parce qu'il est d'équipe »
     *     de « il est là parce qu'il a fui dans le coffre personnel ».
     *
     * Entrer dans une organisation n'est plus le seul moyen d'en voir le contenu — l'accueil
     * le montre, et [lAccueilFondLesDeuxOrigines] l'éprouve. Ce chemin-ci reste : il vérifie
     * la vue filtrée par collection, et les écritures qui en partent.
     */
    private fun coffreDEquipe() {
        val organisation = attendre(
            parPrefixe("chip.org."),
            "aucune organisation n'apparaît : l'application n'interroge pas `/api/orgs`, et " +
                "un coffre d'équipe reste invisible — c'est le défaut du coffre vide",
            30_000,
        )
        // Même précaution qu'en ouvrant un élément : cet onglet vit au-dessus de la liste
        // du coffre, qui se recompose toute seule à mesure que les icônes des sites
        // arrivent. La poignée peut donc expirer entre la recherche et le clic.
        avecRepriseSurObsolescence { organisation.click() }
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

        // ─── Une ligne illisible n'est pas modifiable ───
        //
        // Enregistrer par-dessus écraserait un contenu que **personne n'a jamais lu** —
        // la seule façon de perdre pour de bon ce qui n'était que temporairement
        // inaccessible, par exemple en attendant qu'un administrateur remette la bonne clé.
        //
        // La garantie est de type dans `Coffre` : les écritures prennent une entrée lisible
        // et non un identifiant. Ici on vérifie l'autre bout — l'écran ne propose même pas
        // d'ouvrir la ligne.
        toucher(By.text("Élément illisible"), "la ligne illisible")
        assertNull(
            "toucher une ligne illisible a ouvert un éditeur : enregistrer par-dessus " +
                "détruirait un contenu jamais lu",
            appareil.wait(Until.findObject(By.res("button.save")), 3_000),
        )

        // ─── L'écriture d'équipe ───
        //
        // Le compte semé est administrateur de son organisation, donc `manage` sur la
        // collection par défaut : « Nouveau » doit être proposé, et l'enregistrement doit
        // partir vers `/api/orgs/…/items` et non vers le coffre personnel.
        attendre(
            By.res("button.new"),
            "« Nouveau » manque dans une collection où le membre a le droit d'écrire",
        )
        toucher("button.new")
        val nomDEquipe = "Imprimante " + System.currentTimeMillis() % 10000
        poser("field.name", nomDEquipe)
        poser("field.username", "operateur")
        poser("field.password", "papier")
        toucherJusqua("button.save", By.res("button.settings"), "le retour à la collection")
        attendre(
            By.text(nomDEquipe),
            "l'élément créé n'est pas revenu de la collection d'équipe. S'il est parti dans " +
                "le coffre personnel, il a quitté l'équipe sans que rien ne le dise",
            30_000,
        )

        // ─── Et il revient à l'accueil, **marqué** ───
        //
        // Cette assertion était l'inverse : on exigeait que l'élément d'équipe ne figure
        // **pas** dans la liste d'accueil. C'était juste tant que l'accueil signifiait « le
        // coffre personnel » — un élément d'équipe qui s'y trouvait y était arrivé par
        // `/api/vault/items`, donc sorti de l'équipe en silence.
        //
        // Depuis la fusion, l'accueil est le coffre entier, et cette même présence est
        // devenue ce qu'on veut. Ce qu'il faut encore distinguer — « il est là parce qu'il
        // est d'équipe » de « il est là parce qu'il a fui dans le personnel » — c'est
        // exactement ce que dit sa **marque**. Sans elle, les deux mondes rendraient le même
        // écran, et ce contrôle ne mesurerait plus rien.
        toucher("chip.personal")
        attendre(By.text("Forgejo"), "le retour à l'accueil")
        neGarderQue(nomDEquipe)
        attendre(
            By.text(nomDEquipe),
            "l'élément créé dans l'équipe n'apparaît pas à l'accueil : la liste fondue ne " +
                "s'est pas relue après l'écriture",
            30_000,
        )
        assertNotNull(
            "l'élément d'équipe figure à l'accueil **sans** sa marque : il s'y lit comme un " +
                "élément personnel, et c'est le symptôme d'une fuite par /api/vault/items — " +
                "il aurait quitté l'équipe sans que rien ne le dise",
            appareil.findObject(By.text(MARQUE_DEQUIPE)),
        )
        neGarderQue("")
        toucher(parPrefixe("chip.org."), "l'organisation")
        attendre(By.text(nomDEquipe), "le retour à la collection d'équipe", 30_000)

        // La suppression d'équipe est **définitive**, et le libellé doit le dire — il n'y a
        // pas de corbeille de ce côté.
        ouvrirLElement(nomDEquipe)
        attendre(
            By.text("Supprimer définitivement"),
            "le libellé de suppression d'équipe promet une corbeille qui n'existe pas",
        )
        toucherJusqua("button.cancel", By.res("button.settings"), "le retour à la collection")

        // Et l'on revient au coffre personnel, qui doit être intact.
        toucher("chip.personal")
        attendre(By.text("Forgejo"), "le retour au coffre personnel")
    }

    /**
     * Ouvre un élément du coffre, **en vérifiant que l'éditeur s'ouvre**.
     *
     * Un simple toucher ne suffit pas : la liste se recompose après chaque écriture, et le
     * doigt tombe alors à côté. Le symptôme est trompeur — l'étape suivante cherche un champ
     * de l'éditeur, ne le trouve pas, et le message accuse ce champ.
     *
     * `avecRepriseSurObsolescence` autour du clic, et ce n'est pas une ceinture de plus.
     * **Depuis que la liste affiche les icônes des sites, elle se recompose aussi sans
     * qu'on ait rien fait** : chaque pastille remplace son initiale par un logo quand la
     * réponse du serveur arrive, c'est-à-dire à un moment que le témoin ne commande pas. Le
     * nœud trouvé une milliseconde plus tôt est alors périmé, et `click()` lève
     * `StaleObjectException` — que la boucle `repeat` laissait passer, puisqu'elle n'attrape
     * rien. L'échec remontait en « [4. Modification de cet élément] null », un message qui
     * ne dit ni l'écran ni la cause.
     */
    private fun ouvrirLElement(nom: String) {
        repeat(3) {
            avecRepriseSurObsolescence { ligneDuCoffre(nom).click() }
            appareil.waitForIdle()
            if (appareil.wait(Until.hasObject(By.res("field.name")), 5_000) == true) return
        }
        throw AssertionError(
            "l'élément « $nom » ne s'ouvre pas après trois touchers.\nÉcran : ${ecranActuel()}",
        )
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
        toucherJusqua("button.settings", By.res("button.lock"), "le menu de réglages")
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
        // L'état se lit dans l'**identifiant** et non dans le texte : le « ★ » est du texte
        // de nœud, et la description qui le doublait le remplaçait au lieu de s'y ajouter —
        // si bien qu'aucune machine ne voyait le caractère. Le premier jet l'attendait et ne
        // l'a jamais vu, sur un écran qui l'affichait.
        //
        // Depuis `testTag`, l'état vit dans le `resource-id` et la description dit
        // « Ajouter aux favoris » en français : les deux lecteurs sont servis séparément.
        attendre(
            By.res("button.favorite.$identifiant.on"),
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
     * L'identifiant serveur d'un élément, tel que l'étoile le porte dans son `resource-id`.
     *
     * On apparie par **recouvrement vertical**, et non par intersection des boîtes : le nom
     * est à gauche de la ligne, l'étoile à droite, et leurs rectangles ne se touchent pas.
     * Le premier jet les intersectait et ne trouvait jamais rien — « aucune étoile en face
     * de … », sur un écran qui en portait une.
     */
    private fun identifiantDe(nom: String): String {
        val ligne = attendre(By.text(nom), "l'élément « $nom »").visibleBounds
        val etoile = appareil.findObjects(parPrefixe("button.favorite."))
            .firstOrNull { it.visibleBounds.centerY() in ligne.top..ligne.bottom }
            ?: throw AssertionError(
                "aucune étoile sur la ligne de « $nom » — l'étoile n'est proposée que dans " +
                    "le coffre personnel, jamais sur un élément d'équipe",
            )
        return etoile.resourceName
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
        ouvrirLElement(nomDeLElement)
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
        toucherJusqua("button.cancel", By.res("button.settings"), "le retour au coffre")
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
            avecRepriseSurObsolescence { ligneDuCoffre(nomDeLElement).click() }
            appareil.waitForIdle()
            if (appareil.wait(Until.hasObject(By.res("button.delete")), 4_000) == true) return@repeat
        }
        attendre(By.res("button.delete"), "l'éditeur de l'élément")

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
        attendre(By.res("button.settings"), "le retour au coffre après la suppression", 30_000)
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
            if (appareil.wait(Until.hasObject(By.res("field.master")), 15_000) == true) {
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
            By.res("field.master"),
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
     * `TextField` de Compose portant un repère produit **deux** nœuds d'accessibilité aux
     * mêmes coordonnées — l'un porte le repère et aucun texte, l'autre porte le texte et
     * aucun repère. `setText` sur le premier ne fait rien, et ne se plaint pas.
     *
     * On repère donc par l'identifiant, puis on prend le champ de saisie qui occupe la même
     * place. Un clic au bon endroit aurait suffi à un humain ; il faut le dire à la machine.
     *
     * Le dédoublement n'a pas changé avec `testTag` : il vient de la façon dont Compose
     * projette un `TextField` dans l'arbre d'Android, pas de la propriété qu'on y pose.
     */
    private fun champEditable(identifiant: String): UiObject2 {
        val repere = amenerDansLaZoneSure(By.res(identifiant), "le champ « $identifiant »")
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

    /**
     * Un identifiant dont on ne connaît que le début — l'étoile d'un élément, la pastille
     * d'une organisation : leur nom porte un identifiant serveur qu'on ne connaît pas ici.
     *
     * `By.res` n'a pas de variante « commence par », seulement une variante à expression
     * régulière — et elle veut la correspondance **entière**. `Pattern.quote` est ce qui
     * empêche les points de l'identifiant (« chip.org. ») de valoir « n'importe quel
     * caractère » : sans lui, le motif resterait juste, mais par chance.
     */
    private fun parPrefixe(prefixe: String): BySelector =
        By.res(Pattern.compile(Pattern.quote(prefixe) + ".*"))

    private fun toucher(identifiant: String) = toucher(By.res(identifiant), "« $identifiant »")

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
                // **`resourceName` d'abord, et il a failli manquer.** Depuis le passage à
                // `testTag`, c'est lui qui porte les identifiants (« button.save »,
                // « field.master ») : les omettre aurait laissé ce message ne montrer que
                // les textes français, c'est-à-dire précisément ce qu'on ne cherche pas
                // quand un sélecteur ne trouve rien. Le parcours serait resté aussi juste et
                // beaucoup plus difficile à lire quand il tombe.
                val identifiant = runCatching { objet.resourceName }.getOrNull()
                val texte = runCatching { objet.text }.getOrNull()
                val description = runCatching { objet.contentDescription }.getOrNull()
                listOfNotNull(identifiant, texte, description).firstOrNull { it.isNotBlank() }
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

        /**
         * La marque que porte une ligne d'équipe : « équipe · collection ».
         *
         * Les deux moitiés viennent du semeur et du serveur, et les deux comptent :
         * « Équipe StackOps » est le nom donné dans [SemerLeServeur], « Coffre partagé » est
         * la collection par défaut que le serveur crée avec l'organisation
         * (`DEFAULT_COLLECTION_NAME`). Savoir **laquelle** compte dès qu'on appartient à
         * plusieurs équipes, et une collection n'a de sens qu'associée à la sienne.
         *
         * Si l'un des deux noms change de côté serveur, cette constante doit suivre — et la
         * faire tomber est le bon comportement : une marque qui n'affiche plus ce qu'on
         * croit est pire qu'une marque absente.
         */
        const val MARQUE_DEQUIPE = "Équipe StackOps · Coffre partagé"
    }
}
