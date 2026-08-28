import Foundation

/// L'adresse du serveur, telle qu'on peut raisonnablement l'écrire.
///
/// `URL(string:)` accepte « ghostpass.stackops.ch » sans broncher : il en fait une URL
/// *relative*, sans schéma ni hôte. Rien n'échoue tout de suite — c'est plus tard, quand on
/// construit une requête dessus, que tout se casse, avec un message qui accuse l'adresse
/// sans dire ce qui lui manque. Quelqu'un qui tape le nom de son serveur, ce qui est le
/// geste naturel, se voit donc répondre « adresse invalide » alors qu'elle ne l'est pas.
///
/// On complète donc ce qui manque plutôt que de refuser : `https` par défaut, espaces
/// retirés, barre oblique finale enlevée.
enum ServerAddress {
    /// Rend une URL utilisable, ou `nil` si rien de sensé ne peut en être tiré.
    static func normaliser(_ saisie: String) -> URL? {
        let propre = saisie.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !propre.isEmpty else { return nil }

        // `https` par défaut — sauf en boucle locale, où le défaut sensé est `http`.
        //
        // Un serveur de développement sur `127.0.0.1` parle en clair : lui imposer `https`
        // produit « une erreur TLS a provoqué l'échec de la connexion sécurisée », un
        // message qui décrit la conséquence et cache la cause. L'exception s'arrête à la
        // boucle locale : un serveur sur un réseau privé peut légitimement être en `https`
        // avec son propre certificat, et rétrograder son adresse serait un service qu'on
        // ne rend à personne.
        let avecSchema: String
        if propre.contains("://") {
            avecSchema = propre
        } else {
            avecSchema = (estEnBoucleLocale(propre) ? "http://" : "https://") + propre
        }

        // Une barre finale double les séparateurs des chemins construits ensuite.
        let sansBarre =
            avecSchema.hasSuffix("/") ? String(avecSchema.dropLast()) : avecSchema

        guard let url = URL(string: sansBarre), let hote = url.host, !hote.isEmpty,
            let schema = url.scheme, schema == "http" || schema == "https"
        else { return nil }
        return url
    }

    /// L'hôte désigne-t-il cette machine ? On coupe au premier « : » ou « / » pour
    /// ignorer un port ou un chemin.
    private static func estEnBoucleLocale(_ saisie: String) -> Bool {
        let hote = saisie.split(whereSeparator: { $0 == ":" || $0 == "/" }).first.map(String.init)
        guard let hote = hote?.lowercased() else { return false }
        return hote == "localhost" || hote == "127.0.0.1" || hote == "[::1]" || hote == "::1"
    }

    /// L'adresse telle qu'on l'enregistre et l'affiche : normalisée, ou la saisie brute si
    /// elle ne mène à rien — mieux vaut réafficher ce qui a été tapé que de le perdre.
    static func pourAffichage(_ saisie: String) -> String {
        normaliser(saisie)?.absoluteString ?? saisie.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
