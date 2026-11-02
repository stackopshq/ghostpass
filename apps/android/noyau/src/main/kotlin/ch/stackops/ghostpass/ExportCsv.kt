package ch.stackops.ghostpass

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Export du coffre en CSV — le pendant d'[ImportCsv], et le seul endroit d'Android où des
 * secrets quittent le chiffré.
 *
 * Un gestionnaire dont on ne peut pas partir n'est pas un coffre, c'est une nasse. iOS
 * (`CsvExport.swift`) et la web app (`apps/web-next/src/lib/export.ts`) le proposent depuis
 * longtemps ; Android ne l'avait pas, alors que les deux fiches de magasin promettent
 * « Export de vos données, à tout moment, en clair et sans condition ».
 *
 * ## Ce que cet objet ne reçoit pas
 *
 * Il prend une liste d'entrées, et l'appelant décide lesquelles. Ce n'est pas de la
 * politesse d'API : la web app porte la cicatrice du cas inverse — elle exportait `items`,
 * qui fusionne le coffre personnel et les collections d'équipe, si bien qu'un membre
 * pouvait déposer les secrets de toute son organisation en clair dans un fichier sans que
 * l'équipe l'apprenne. Sortir un secret partagé du coffre est une décision qui appartient à
 * l'équipe, pas à la personne qui appuie. Voir [ModeleDuCoffre.exportables].
 */
object ExportCsv {

    /**
     * L'en-tête, **mot pour mot celui de la web app et d'iOS**.
     *
     * `EN_TETE_CSV` dans `export.ts`, `CsvExport.entete` dans `CsvExport.swift`. Les trois
     * doivent s'accorder : un fichier exporté d'un téléphone doit se relire dans le
     * navigateur, et réciproquement. Un `ContractTests` l'exige déjà côté iOS.
     *
     * Ce que l'en-tête **ne porte pas** : ni les notes, ni les champs de carte bancaire. La
     * conséquence est réelle et commune aux trois plateformes — une note secrète ressort
     * avec son nom et son dossier, et son contenu reste derrière. Ce n'est pas corrigé ici
     * parce qu'un septième champ ferait diverger Android des deux autres, ce que tout le
     * reste de ce fichier s'applique à éviter ; c'est relevé pour un changement coordonné.
     */
    const val EN_TETE = "name,folder,url,username,password,totp"

    /**
     * Le séparateur des adresses **dans** la cellule `url`.
     *
     * Une entrée porte plusieurs adresses — `connect.ulys.com` et `user.ulys.com` valent
     * pour le même compte. Le CSV n'a qu'une colonne pour les loger.
     *
     * Le retour à la ligne, et c'est le choix de la web app, pour des raisons qui tiennent
     * toutes à ce qu'on sait vérifier : il est légal dans une cellule entre guillemets
     * (RFC 4180) et [ImportCsv.lignes] le relit déjà comme tel ; la virgule apparaît dans
     * de vraies URL et la prendre pour un séparateur couperait une adresse en deux ; et
     * c'est la forme qu'`EcranDeLElement` présente déjà à l'écran.
     *
     * **iOS fait autrement, et c'est iOS qui a tort** : `CsvExport.texte` n'écrit que
     * `uris.first`, si bien qu'un coffre exporté depuis l'iPhone revient amputé de ses
     * adresses secondaires. Suivre iOS par souci de parité aurait recopié le défaut.
     */
    private const val SEPARATEUR_ADRESSES = "\n"

    /**
     * Le CSV des entrées données.
     *
     * Les notes secrètes et les cartes sortent avec leur nom et leur dossier, et des
     * colonnes de connexion vides — comme chez iOS et la web app. Les omettre serait pire :
     * leur ligne disparaîtrait d'un fichier censé être complet, sans qu'un compte d'entrées
     * ne le révèle.
     */
    fun texte(entrees: List<EntreeDuCoffre.Lisible>): String {
        val lignes = ArrayList<String>(entrees.size + 1)
        lignes.add(EN_TETE)
        for (entree in entrees) {
            val element = entree.element
            val identifiants = element.identifiants
            lignes.add(
                listOf(
                    element.name,
                    element.folder.orEmpty(),
                    identifiants?.uris?.joinToString(SEPARATEUR_ADRESSES).orEmpty(),
                    identifiants?.username.orEmpty(),
                    identifiants?.password.orEmpty(),
                    identifiants?.totp.orEmpty(),
                ).joinToString(",", transform = ::echapper),
            )
        }
        return lignes.joinToString("\n")
    }

    /**
     * Tout entre guillemets, guillemets internes doublés : la seule forme qui survit à une
     * virgule, à un saut de ligne et à un guillemet dans un mot de passe.
     *
     * Les guillemets ne protègent que la structure du fichier, pas son lecteur : un tableur
     * les retire, puis évalue ce qui commence par `=`, `+`, `-` ou `@`. Un nom d'élément est
     * du texte que quelqu'un d'autre a pu écrire — un CSV qu'on vous a fait importer, un
     * élément semé dans une collection d'équipe — et il ressort ici, à côté des mots de
     * passe en clair, dans un fichier qu'on ouvre justement avec un tableur.
     */
    private fun echapper(valeur: String): String =
        "\"" + neutraliserLaFormule(valeur).replace("\"", "\"\"") + "\""

    /**
     * Préfixe d'une apostrophe ce qu'un tableur évaluerait.
     *
     * **Réversible, et c'est la contrainte qui a dicté la forme.** L'import retire
     * exactement cette apostrophe ([ImportCsv.rendreSaFormule]), si bien qu'un coffre
     * exporté puis réimporté redonne les mêmes valeurs. Un préfixe posé sans retrait aurait
     * fait grossir les noms d'une apostrophe à chaque aller-retour.
     *
     * Le test de ce qui amorce une formule n'est **pas redéfini ici** : c'est
     * [ImportCsv.amorceUneFormule], celui-là même dont dépend le retrait. Deux listes de
     * caractères, une par sens, auraient pu diverger — et le symptôme n'aurait pas été une
     * erreur, mais une apostrophe de plus à chaque cycle sur les seuls caractères que l'une
     * connaît et l'autre pas.
     */
    fun neutraliserLaFormule(valeur: String): String =
        if (ImportCsv.amorceUneFormule(valeur)) "'$valeur" else valeur

    /**
     * Le nom de fichier proposé. La date évite d'écraser un export précédent sans le dire.
     *
     * `Locale.US` plutôt que celle de l'appareil : c'est l'équivalent de l'`en_US_POSIX`
     * d'iOS. Un calendrier non grégorien ou des chiffres non latins donneraient un nom que
     * ni un tri ni un autre gestionnaire ne saurait lire.
     */
    fun nomDeFichier(date: Date = Date()): String =
        "ghostpass-export-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(date) + ".csv"
}
