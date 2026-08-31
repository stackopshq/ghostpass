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
    ///
    /// Les guillemets ne protègent que la structure du fichier, pas son lecteur : un
    /// tableur les retire puis évalue ce qui commence par `=`, `+`, `-` ou `@`. Un nom
    /// d'élément est du texte que quelqu'un d'autre a pu écrire — un CSV qu'on vous fait
    /// importer, un élément semé dans une collection d'équipe — et il ressort ici, à côté
    /// des mots de passe en clair, dans un fichier qu'on ouvre justement avec un tableur.
    private static func echapper(_ valeur: String) -> String {
        "\"" + neutraliserLaFormule(valeur).replacingOccurrences(of: "\"", with: "\"\"")
            + "\""
    }

    /// Les caractères qui font d'une cellule une formule, pour les tableurs courants.
    static let amorcesDeFormule: Set<Character> = ["=", "+", "-", "@", "\t", "\r"]

    /// La valeur serait-elle interprétée comme une formule ?
    ///
    /// Récursif sur l'apostrophe : `'=SOMME(…)` doit être neutralisé lui aussi, sinon
    /// l'import retirerait son apostrophe et rendrait la formule à un futur export.
    static func amorceUneFormule(_ valeur: String) -> Bool {
        guard let premier = valeur.first else { return false }
        if amorcesDeFormule.contains(premier) { return true }
        if premier == "'" { return amorceUneFormule(String(valeur.dropFirst())) }
        return false
    }

    /// Préfixe d'une apostrophe ce qu'un tableur évaluerait.
    ///
    /// **Réversible, et c'est la contrainte qui a dicté la forme.** L'import retire
    /// exactement cette apostrophe (`CsvImport.rendreSaFormule`), si bien qu'un coffre
    /// exporté puis réimporté redonne les mêmes valeurs — ce qu'un test exige. Un préfixe
    /// posé sans retrait aurait fait grossir les noms d'une apostrophe à chaque
    /// aller-retour.
    static func neutraliserLaFormule(_ valeur: String) -> String {
        amorceUneFormule(valeur) ? "'" + valeur : valeur
    }

    /// Le nom du fichier proposé. La date évite d'écraser un export précédent sans le dire.
    static func nomDeFichier(_ date: Date = Date()) -> String {
        let formateur = DateFormatter()
        formateur.locale = Locale(identifier: "en_US_POSIX")
        formateur.dateFormat = "yyyy-MM-dd"
        return "ghostpass-export-\(formateur.string(from: date)).csv"
    }
}
