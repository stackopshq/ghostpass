import Foundation

/// Export du coffre en CSV, au format que produit la web app — et que relit l'import de
/// cette application. Un coffre doit pouvoir sortir aussi librement qu'il est entré : un
/// gestionnaire dont on ne peut pas partir n'est pas un coffre, c'est une nasse.
///
/// Le fichier contient les mots de passe **en clair**. C'est inhérent à un export CSV, et
/// c'est pourquoi l'écran qui le déclenche demande le mot de passe maître et rappelle
/// d'effacer le fichier.
enum CsvExport {
    /// L'en-tête, dans l'ordre de la web app. Le relire avec `CsvImport` doit redonner le
    /// même coffre : les deux formats se répondent, et un test l'exige.
    static let entete = "name,folder,url,username,password,totp"

    static func texte(_ entries: [VaultEntry]) -> String {
        var lignes = [entete]
        for entry in entries {
            let login = entry.login
            lignes.append(
                [
                    entry.item.name,
                    entry.item.folder ?? "",
                    login?.uris.first ?? "",
                    login?.username ?? "",
                    login?.password ?? "",
                    login?.totp ?? "",
                ]
                .map(echapper).joined(separator: ","))
        }
        return lignes.joined(separator: "\n")
    }

    /// Tout est mis entre guillemets, guillemets internes doublés : c'est la seule forme
    /// qui survit à une virgule, à un saut de ligne et à un guillemet dans un mot de passe.
    private static func echapper(_ valeur: String) -> String {
        "\"" + valeur.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// Le nom du fichier proposé. La date évite d'écraser un export précédent sans le dire.
    static func nomDeFichier(_ date: Date = Date()) -> String {
        let formateur = DateFormatter()
        formateur.locale = Locale(identifier: "en_US_POSIX")
        formateur.dateFormat = "yyyy-MM-dd"
        return "ghostpass-export-\(formateur.string(from: date)).csv"
    }
}
