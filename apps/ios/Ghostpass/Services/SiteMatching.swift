import Foundation

/// Rapprochement entre l'adresse d'un champ de saisie et les adresses d'un item.
///
/// Partagé par l'application et l'extension : c'est le même code qui décide, des deux
/// côtés, si un identifiant vaut pour un site. Deux règles qui divergeraient donneraient
/// des suggestions différentes selon l'endroit d'où l'on regarde.
enum SiteMatching {
    /// Ramène une URL ou un domaine à son hôte : minuscules, sans schéma, sans chemin,
    /// sans port, sans `www.`.
    static func host(of value: String) -> String {
        var texte = value.trimmingCharacters(in: .whitespaces).lowercased()
        if let separateur = texte.range(of: "://") {
            texte = String(texte[separateur.upperBound...])
        }
        texte = texte.components(separatedBy: "/").first ?? texte
        texte = texte.components(separatedBy: "?").first ?? texte
        // Un IPv6 entre crochets n'a pas de port à retirer de cette façon.
        if !texte.hasPrefix("[") { texte = texte.components(separatedBy: ":").first ?? texte }
        if texte.hasPrefix("www.") { texte.removeFirst(4) }
        return texte
    }

    /// `login.example.com` doit correspondre à `example.com` : les sites déplacent leur
    /// formulaire d'authentification sur un sous-domaine sans prévenir personne.
    static func sameSite(_ a: String, _ b: String) -> Bool {
        guard !a.isEmpty, !b.isEmpty else { return false }
        return a == b || a.hasSuffix("." + b) || b.hasSuffix("." + a)
    }

    /// Le nom d'un item, quand il **est** un nom d'hôte.
    ///
    /// Un coffre importé range très souvent le domaine dans le nom et laisse l'adresse
    /// vide : « accounts.google.com (admin@exemple.ch) », « app.indy.fr (compta@…) ».
    /// C'est le format que produisent la plupart des exports de navigateur, et le
    /// rapprochement ne le voyait pas — le domaine était sous les yeux du code, dans le
    /// champ d'à côté.
    ///
    /// On ne prend que le **premier mot**, et seulement s'il ressemble à un hôte : au
    /// moins un point, aucun espace, et rien qui trahisse une phrase. « Google » ne
    /// donne donc rien, et c'est voulu — un nom sans point ne peut correspondre à aucun
    /// domaine, et deviner au-delà créerait des suggestions fausses. Une suggestion
    /// fausse est pire qu'une absence de suggestion : elle fait remplir un formulaire
    /// avec le mauvais mot de passe.
    static func hostDansLeNom(_ nom: String) -> String {
        let premier = nom.split(whereSeparator: { $0 == " " || $0 == "\t" }).first.map(String.init) ?? ""
        let candidat = host(of: premier)
        guard candidat.contains("."),
              !candidat.hasPrefix("."), !candidat.hasSuffix("."),
              candidat.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" })
        else { return "" }
        return candidat
    }

    /// L'item convient-il à l'un des domaines demandés ?
    static func matches(_ item: VaultItem, domains: [String]) -> Bool {
        guard case .login(let login) = item.data else { return false }
        let cibles = domains.map(host(of:)).filter { !$0.isEmpty }
        guard !cibles.isEmpty else { return false }

        // Les adresses déclarées d'abord — c'est la source la plus sûre. Puis le nom, s'il
        // est lui-même un hôte : sans ce repli, un coffre importé ne suggère jamais rien,
        // et l'extension s'ouvre sur tout le coffre en vrac.
        var adresses = login.uris.map(host(of:)).filter { !$0.isEmpty }
        let duNom = hostDansLeNom(item.name)
        if !duNom.isEmpty { adresses.append(duNom) }

        return adresses.contains { adresse in cibles.contains { sameSite(adresse, $0) } }
    }
}
