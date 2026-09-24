package ch.stackops.ghostpass

/**
 * Import d'un fichier CSV — celui qu'exporte un autre gestionnaire de mots de passe.
 *
 * Transposition de `apps/web/src/lib/csv.ts` et de `apps/ios/Ghostpass/Services/CsvImport.swift`,
 * **y compris la liste des colonnes reconnues**. Bitwarden, Dashlane, 1Password, LastPass et
 * Chrome n'emploient pas les mêmes noms, et c'est précisément ce que cette table
 * d'équivalences absorbe. Un même fichier doit produire le même coffre des trois côtés —
 * sans quoi migrer depuis le téléphone et migrer depuis le navigateur donneraient deux
 * résultats différents, et personne ne saurait lequel est le bon.
 *
 * Rien ne part sur le réseau ici : l'analyse est locale, et le chiffrement reste l'affaire
 * du cœur Rust au moment du dépôt.
 */
object ImportCsv {

    /**
     * Découpe le texte en enregistrements.
     *
     * Gère les guillemets, les guillemets doublés et les retours à la ligne échappés. Ce
     * n'est pas du zèle : **un mot de passe contient souvent une virgule**, et un champ
     * « notes » souvent un saut de ligne. Un découpage naïf sur la virgule décalerait alors
     * toutes les colonnes de cette ligne — et le résultat n'est pas une erreur, c'est un
     * élément dont le mot de passe est devenu l'adresse.
     */
    fun lignes(texte: String): List<List<String>> {
        val lignes = ArrayList<List<String>>()
        var ligne = ArrayList<String>()
        val champ = StringBuilder()
        var dansGuillemets = false
        // Les fins de ligne Windows et classiques Mac se ramènent au saut simple. Un export
        // vient rarement du même système que celui qui l'importe.
        val source = texte.replace("\r\n", "\n").replace('\r', '\n')

        var i = 0
        while (i < source.length) {
            val c = source[i]
            when {
                dansGuillemets -> when {
                    c != '"' -> champ.append(c)
                    i + 1 < source.length && source[i + 1] == '"' -> {
                        champ.append('"')
                        i++
                    }
                    else -> dansGuillemets = false
                }
                c == '"' -> dansGuillemets = true
                c == ',' -> {
                    ligne.add(champ.toString())
                    champ.setLength(0)
                }
                c == '\n' -> {
                    ligne.add(champ.toString())
                    lignes.add(ligne)
                    ligne = ArrayList()
                    champ.setLength(0)
                }
                else -> champ.append(c)
            }
            i++
        }
        if (champ.isNotEmpty() || ligne.isNotEmpty()) {
            ligne.add(champ.toString())
            lignes.add(ligne)
        }
        return lignes
    }

    /**
     * Les enregistrements, indexés par en-tête en minuscules.
     *
     * Une ligne entièrement vide est ignorée : les exports en sèment volontiers en fin de
     * fichier, et une ligne vide importée donnerait un élément « (sans nom) » sans mot de
     * passe — que l'utilisateur devrait retrouver et supprimer à la main.
     */
    fun enregistrements(texte: String): List<Map<String, String>> {
        val toutes = lignes(texte).filter { ligne -> ligne.any { it.isNotBlank() } }
        if (toutes.size < 2) return emptyList()
        val entetes = toutes[0].map { it.trim().lowercase() }
        return toutes.drop(1).map { cellules ->
            entetes.withIndex().associate { (rang, entete) ->
                entete to (cellules.getOrNull(rang) ?: "").trim()
            }
        }
    }

    /**
     * Les éléments à déposer. **Tout devient un identifiant** : c'est ce que fait la web
     * app, et c'est ce que contiennent les exports des gestionnaires concurrents.
     */
    fun elements(texte: String): List<ElementDuCoffre> = enregistrements(texte).map { ligne ->
        // Les noms de colonnes sont **relevés dans les exports réels**, et non devinés :
        //   Bitwarden  folder, name, notes, login_uri, login_username, login_password,
        //              login_totp
        //   1Password  Title, Url, Username, Password, OTPAuth, Tags, Notes
        //   LastPass   url, username, password, totp, extra, name, grouping
        //   Dashlane   title, username, password, note, url, category, otpSecret
        //   Chrome     name, url, username, password, note
        //   KeePass    Group, Title, Username, Password, URL, Notes
        val dossier = premier(ligne, "folder", "vault", "group", "grouping", "category", "tags")
        val totp = premier(ligne, "totp", "login_totp", "otpauth", "otpsecret", "otp")
        val adresse = premier(ligne, "url", "login_uri", "website", "uri", "urls")
        // `extra` chez LastPass, `note` au singulier chez Dashlane et Chrome. Les omettre
        // perdait les notes de tout coffre migré — **silencieusement**, puisqu'un élément
        // sans note a exactement l'air d'un élément qui n'en avait pas.
        val note = premier(ligne, "notes", "note", "extra", "comments")
        val nom = nettoyerLeNom(premier(ligne, "name", "title"))
        ElementDuCoffre(
            name = nom.ifEmpty { "(sans nom)" },
            notes = note.ifEmpty { null },
            folder = dossier.ifEmpty { null },
            data = ContenuDElement.Connexion(
                Identifiants(
                    username = premier(ligne, "username", "login_username", "login", "user"),
                    password = premier(ligne, "password", "login_password"),
                    uris = if (adresse.isEmpty()) emptyList() else listOf(adresse),
                    totp = totp.ifEmpty { null },
                ),
            ),
        )
    }

    /**
     * Ce qu'on accepte comme nom d'élément importé.
     *
     * Deux choses s'y jouent, et aucune ne vient du format CSV lui-même :
     *
     *  - **le préfixe de registre.** Les registres internes portent un nom commençant par un
     *    octet NUL, que personne ne peut taper — mais qu'un fichier peut contenir. Un élément
     *    importé sous ce nom serait pris pour un registre : il disparaîtrait de la liste et,
     *    pire, **détournerait l'identité du vrai registre**, si bien que la prochaine écriture
     *    de dossiers ou de favoris irait dans le mauvais élément. On retire le NUL plutôt que
     *    de rejeter la ligne : perdre un import entier pour un caractère invisible serait
     *    disproportionné ;
     *  - **l'apostrophe de neutralisation** que notre propre export pose devant ce qu'un
     *    tableur évaluerait. La retirer ici est ce qui rend l'aller-retour exact ; sans cela,
     *    un nom grossirait d'une apostrophe à chaque cycle export-import.
     */
    fun nettoyerLeNom(valeur: String): String = rendreSaFormule(
        // L'échappement, et **pas un octet NUL littéral dans le source**. Le premier jet en
        // portait un : il compilait, il fonctionnait, et il était invisible à la relecture
        // comme au `grep`. Un caractère qu'on ne peut pas voir dans le code qui le traite
        // est exactement ce qu'on ne veut pas ici.
        valeur.replace("\u0000", ""),
    )

    /** Retire l'apostrophe que l'export a posée, **et elle seule**. */
    fun rendreSaFormule(valeur: String): String {
        if (valeur.firstOrNull() != '\'') return valeur
        val reste = valeur.drop(1)
        return if (amorceUneFormule(reste)) reste else valeur
    }

    /**
     * Cette valeur serait-elle évaluée par un tableur ?
     *
     * `=`, `+`, `-`, `@` en tête suffisent à faire d'une cellule une formule dans Excel comme
     * dans LibreOffice — c'est l'injection de formule CSV. L'apostrophe en tête compte aussi,
     * récursivement, parce que c'est ainsi qu'on neutralise.
     */
    fun amorceUneFormule(valeur: String): Boolean {
        val premier = valeur.firstOrNull() ?: return false
        if (premier in AMORCES) return true
        if (premier == '\'') return amorceUneFormule(valeur.drop(1))
        return false
    }

    private val AMORCES = charArrayOf('=', '+', '-', '@')

    /** La première colonne renseignée parmi celles qui désignent la même chose. */
    private fun premier(ligne: Map<String, String>, vararg noms: String): String {
        for (nom in noms) {
            val valeur = ligne[nom]
            if (!valeur.isNullOrEmpty()) return valeur
        }
        return ""
    }
}
