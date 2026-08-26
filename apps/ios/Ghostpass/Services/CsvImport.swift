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
            let dossier = premier(ligne, "folder", "vault", "group")
            let totp = premier(ligne, "totp", "login_totp", "otpauth")
            let adresse = premier(ligne, "url", "login_uri", "website", "uri")
            return VaultItem(
                name: premier(ligne, "name", "title").isEmpty
                    ? NSLocalizedString("(sans nom)", comment: "")
                    : premier(ligne, "name", "title"),
                notes: nil,
                folder: dossier.isEmpty ? nil : dossier,
                data: .login(
                    Login(
                        username: premier(ligne, "username", "login_username", "login"),
                        password: premier(ligne, "password", "login_password"),
                        uris: adresse.isEmpty ? [] : [adresse],
                        totp: totp.isEmpty ? nil : totp)))
        }
    }

    /// La première colonne renseignée parmi celles qui désignent la même chose.
    private static func premier(_ ligne: [String: String], _ noms: String...) -> String {
        for nom in noms {
            if let valeur = ligne[nom], !valeur.isEmpty { return valeur }
        }
        return ""
    }
}
