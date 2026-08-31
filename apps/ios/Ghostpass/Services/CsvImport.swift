import Foundation

/// Import d'un fichier CSV — celui qu'exporte un autre gestionnaire de mots de passe.
///
/// Transposition de `apps/web/src/lib/csv.ts`, y compris la liste des colonnes reconnues :
/// Bitwarden, 1Password, LastPass et Chrome n'emploient pas les mêmes noms, et c'est
/// précisément ce que cette table d'équivalences absorbe. Un même fichier doit produire le
/// même coffre des deux côtés — sans quoi migrer depuis le téléphone et migrer depuis le
/// navigateur donneraient deux résultats différents.
///
/// Rien ne part sur le réseau ici : l'analyse est locale, et le chiffrement reste l'affaire
/// du cœur Rust au moment du dépôt.
enum CsvImport {
    /// Découpe le texte en enregistrements. Gère les guillemets, les guillemets doublés et
    /// les retours à la ligne échappés — un mot de passe peut contenir une virgule, et un
    /// champ « notes » un saut de ligne.
    static func lignes(_ texte: String) -> [[String]] {
        var lignes: [[String]] = []
        var ligne: [String] = []
        var champ = ""
        var dansGuillemets = false
        // Les fins de ligne Windows et classiques Mac se ramènent au saut simple.
        let source = texte.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")

        var index = source.startIndex
        while index < source.endIndex {
            let caractere = source[index]
            if dansGuillemets {
                if caractere == "\"" {
                    let suivant = source.index(after: index)
                    if suivant < source.endIndex, source[suivant] == "\"" {
                        champ.append("\"")
                        index = suivant
                    } else {
                        dansGuillemets = false
                    }
                } else {
                    champ.append(caractere)
                }
            } else if caractere == "\"" {
                dansGuillemets = true
            } else if caractere == "," {
                ligne.append(champ)
                champ = ""
            } else if caractere == "\n" {
                ligne.append(champ)
                lignes.append(ligne)
                ligne = []
                champ = ""
            } else {
                champ.append(caractere)
            }
            index = source.index(after: index)
        }
        if !champ.isEmpty || !ligne.isEmpty {
            ligne.append(champ)
            lignes.append(ligne)
        }
        return lignes
    }

    /// Les enregistrements, indexés par en-tête en minuscules. Une ligne entièrement vide
    /// est ignorée : les exports en sèment volontiers en fin de fichier.
    static func enregistrements(_ texte: String) -> [[String: String]] {
        let toutes = lignes(texte).filter { ligne in
            ligne.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        }
        guard toutes.count >= 2 else { return [] }
        let entetes = toutes[0].map {
            $0.trimmingCharacters(in: .whitespaces).lowercased()
        }
        return toutes.dropFirst().map { cellules in
            var enregistrement: [String: String] = [:]
            for (rang, entete) in entetes.enumerated() {
                let valeur = rang < cellules.count ? cellules[rang] : ""
                enregistrement[entete] = valeur.trimmingCharacters(in: .whitespaces)
            }
            return enregistrement
        }
    }

    /// Les items à déposer. Tout devient un identifiant : c'est ce que fait la web app, et
    /// c'est ce que contiennent les exports des gestionnaires concurrents.
    static func items(_ texte: String) -> [VaultItem] {
        enregistrements(texte).map { ligne in
            // Les noms de colonnes relevés dans les exports réels, et non devinés :
            //   Bitwarden  folder, name, notes, login_uri, login_username, login_password,
            //              login_totp
            //   1Password  Title, Url, Username, Password, OTPAuth, Tags, Notes
            //   LastPass   url, username, password, totp, extra, name, grouping
            //   Dashlane   title, username, password, note, url, category, otpSecret
            //   Chrome     name, url, username, password, note
            //   KeePass    Group, Title, Username, Password, URL, Notes
            let dossier = premier(ligne, "folder", "vault", "group", "grouping", "category", "tags")
            let totp = premier(ligne, "totp", "login_totp", "otpauth", "otpsecret", "otp")
            let adresse = premier(ligne, "url", "login_uri", "website", "uri", "urls")
            // `extra` chez LastPass, `note` au singulier chez Dashlane et Chrome. Les
            // omettre perdait les notes de tout coffre migré — silencieusement.
            let note = premier(ligne, "notes", "note", "extra", "comments")
            let nom = nettoyerLeNom(premier(ligne, "name", "title"))
            return VaultItem(
                name: nom.isEmpty ? NSLocalizedString("(sans nom)", comment: "") : nom,
                notes: note.isEmpty ? nil : note,
                folder: dossier.isEmpty ? nil : dossier,
                data: .login(
                    Login(
                        username: premier(ligne, "username", "login_username", "login", "user"),
                        password: premier(ligne, "password", "login_password"),
                        uris: adresse.isEmpty ? [] : [adresse],
                        totp: totp.isEmpty ? nil : totp)))
        }
    }

    /// Ce qu'on accepte comme nom d'élément importé.
    ///
    /// Deux choses s'y jouent, et aucune ne vient du format CSV lui-même :
    ///
    /// - **Le préfixe de registre.** Les registres internes portent un nom commençant par
    ///   un octet NUL, que personne ne peut taper — mais qu'un fichier peut contenir. Un
    ///   élément importé sous ce nom serait pris pour un registre : il disparaîtrait de la
    ///   liste, et pire, détournerait l'identité du vrai registre, si bien que la
    ///   prochaine écriture de dossiers ou de favoris irait dans le mauvais élément. On le
    ///   refuse en retirant le NUL plutôt qu'en rejetant la ligne : perdre un import
    ///   entier pour un caractère invisible serait disproportionné.
    /// - **L'apostrophe de neutralisation** posée par notre export devant ce qu'un tableur
    ///   évaluerait. La retirer ici est ce qui rend l'aller-retour exact.
    static func nettoyerLeNom(_ valeur: String) -> String {
        rendreSaFormule(valeur.replacingOccurrences(of: "\u{0}", with: ""))
    }

    /// Retire l'apostrophe que l'export a posée, et elle seule.
    static func rendreSaFormule(_ valeur: String) -> String {
        guard valeur.first == "'" else { return valeur }
        let reste = String(valeur.dropFirst())
        return CsvExport.amorceUneFormule(reste) ? reste : valeur
    }

    /// La première colonne renseignée parmi celles qui désignent la même chose.
    private static func premier(_ ligne: [String: String], _ noms: String...) -> String {
        for nom in noms {
            if let valeur = ligne[nom], !valeur.isEmpty { return valeur }
        }
        return ""
    }
}
