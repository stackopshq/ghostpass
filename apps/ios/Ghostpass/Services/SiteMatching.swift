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

    /// L'item convient-il à l'un des domaines demandés ?
    static func matches(_ item: VaultItem, domains: [String]) -> Bool {
        guard case .login(let login) = item.data else { return false }
        let cibles = domains.map(host(of:)).filter { !$0.isEmpty }
        guard !cibles.isEmpty else { return false }
        let adresses = login.uris.map(host(of:)).filter { !$0.isEmpty }
        return adresses.contains { adresse in cibles.contains { sameSite(adresse, $0) } }
    }
}
