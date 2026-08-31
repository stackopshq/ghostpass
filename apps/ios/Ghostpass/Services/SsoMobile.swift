import AuthenticationServices
import CryptoKit
import Foundation

/// Ouvrir une session par SSO depuis l'application.
///
/// Le contrat est décrit dans `docs/sso-mobile.md`. Ce qu'il faut retenir ici :
///
/// **Le PKCE couvre le saut application ↔ serveur**, et non application ↔ fournisseur
/// d'identité. C'est délibéré : sur iOS, n'importe quelle application peut revendiquer un
/// schéma d'URL personnalisé, donc le retour destiné à GhostPass est interceptable. Le code
/// qui y transite ne vaut rien sans le vérificateur, que seule cette application détient.
///
/// Le SSO **authentifie ; il n'ouvre pas le coffre.** Celui-ci reste scellé sous le mot de
/// passe maître, qui sera demandé ensuite. Les confondre est la première erreur de
/// conception d'un client à connaissance nulle.
enum SsoMobile {
    /// Le schéma que l'`ASWebAuthenticationSession` attend en retour.
    ///
    /// Il n'est **pas** déclaré dans `Info.plist`, et c'est voulu : le déclarer ferait de
    /// GhostPass un gestionnaire général de ce schéma, alors que seule la session
    /// d'authentification en cours doit le recevoir.
    static let schema = "ch.stackops.ghostpass"
    static let adresseDeRetour = "\(schema)://sso"

    // ─── PKCE ───

    /// Un vérificateur et son défi, liés par SHA-256.
    struct Pkce {
        let verificateur: String
        let defi: String

        /// Tire un vérificateur aléatoire et calcule son défi.
        init() {
            self.init(verificateur: Self.chaineAleatoire(octets: 32))
        }

        /// Utilisable avec un vérificateur imposé, pour éprouver le calcul contre le
        /// vecteur de la RFC 7636.
        init(verificateur: String) {
            self.verificateur = verificateur
            self.defi = Self.defi(pour: verificateur)
        }

        /// `base64url(sha256(vérificateur))`, sans remplissage.
        ///
        /// SHA-256 rend 32 octets, soit exactement 43 caractères en base64url — la
        /// longueur que le serveur exige. Laisser le remplissage `=` en ferait 44 et le
        /// `start` refuserait, ce qui est le bon comportement : un défi mal formé doit
        /// échouer là où il arrive, pas trois étapes plus loin.
        static func defi(pour verificateur: String) -> String {
            let empreinte = SHA256.hash(data: Data(verificateur.utf8))
            return base64url(Data(empreinte))
        }

        static func chaineAleatoire(octets: Int) -> String {
            var brut = Data(count: octets)
            let resultat = brut.withUnsafeMutableBytes {
                SecRandomCopyBytes(kSecRandomDefault, octets, $0.baseAddress!)
            }
            // `SecRandomCopyBytes` ne peut échouer qu'en cas de défaillance du système ;
            // retomber sur un aléa faible serait pire que s'arrêter, puisque tout le
            // dispositif repose sur l'imprévisibilité de cette valeur.
            precondition(resultat == errSecSuccess, "Le générateur aléatoire du système a échoué.")
            return base64url(brut)
        }

        static func base64url(_ donnees: Data) -> String {
            donnees.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
    }

    // ─── Le retour, et sa lecture ───

    enum ErreurDeRetour: LocalizedError, Equatable {
        /// Le retour ne porte pas de code. C'est **l'unique** critère d'échec.
        case sansCode(motif: String?)
        /// L'état rendu n'est pas celui qu'on a envoyé : ce retour ne répond pas à notre
        /// demande, et l'accepter reviendrait à ouvrir une session qu'un tiers a lancée.
        case etatInattendu

        var errorDescription: String? {
            switch self {
            case .etatInattendu:
                return String(localized: "La réponse ne correspond pas à la demande. Réessayez.")
            case .sansCode(let motif):
                switch motif {
                case "not_provisioned":
                    // Le serveur ne crée jamais de compte par SSO : le coffre est scellé
                    // sous le mot de passe maître, donc un compte provisionné à la volée
                    // n'aurait rien à ouvrir.
                    return String(localized: "Cette adresse n'a pas de compte GhostPass sur ce serveur.")
                default:
                    return String(localized: "L'authentification a échoué.")
                }
            }
        }
    }

    /// Lit le retour du navigateur.
    ///
    /// **L'échec est l'absence de `code`, pas la présence d'`error`.** Un client qui teste
    /// `error` et poursuit sinon appellerait l'échange avec un code vide, et lirait le refus
    /// du serveur comme une panne réseau plutôt que comme un rejet d'authentification.
    static func codeDuRetour(_ url: URL, etatAttendu: String) -> Result<String, ErreurDeRetour> {
        let elements = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func valeur(_ nom: String) -> String? {
            let brut = elements.first { $0.name == nom }?.value
            return (brut?.isEmpty ?? true) ? nil : brut
        }

        // L'état se vérifie avant tout le reste : un retour qui n'est pas le nôtre ne
        // mérite pas qu'on lise ce qu'il transporte.
        guard valeur("state") == etatAttendu else { return .failure(.etatInattendu) }
        guard let code = valeur("code") else { return .failure(.sansCode(motif: valeur("error"))) }
        return .success(code)
    }

    /// L'adresse d'ouverture du flux, telle que le serveur l'attend.
    static func adresseDeDepart(serveur: URL, defi: String, etat: String) -> URL? {
        var composants = URLComponents(
            url: serveur.appendingPathComponent("api/auth/sso/mobile/start"),
            resolvingAgainstBaseURL: false)
        composants?.queryItems = [
            URLQueryItem(name: "code_challenge", value: defi),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: etat),
            URLQueryItem(name: "redirect_uri", value: adresseDeRetour),
        ]
        return composants?.url
    }

    // ─── Le navigateur ───

    /// Ouvre la session web et rend le code, ou jette.
    @MainActor
    static func obtenirUnCode(serveur: URL, pkce: Pkce, ancre: ASPresentationAnchor) async throws
        -> String
    {
        let etat = Pkce.chaineAleatoire(octets: 16)
        guard let depart = adresseDeDepart(serveur: serveur, defi: pkce.defi, etat: etat) else {
            throw APIError.badURL
        }

        let retour: URL = try await withCheckedThrowingContinuation { suite in
            let session = ASWebAuthenticationSession(
                url: depart, callbackURLScheme: schema
            ) { url, erreur in
                if let url {
                    suite.resume(returning: url)
                } else {
                    suite.resume(throwing: erreur ?? ErreurDeRetour.sansCode(motif: nil))
                }
            }
            session.presentationContextProvider = Ancre.partagee(ancre)
            // Session éphémère : les cookies du fournisseur d'identité ne sont pas partagés
            // avec Safari. Sur un téléphone prêté, une session laissée ouverte permettrait à
            // la personne suivante d'entrer sans rien saisir.
            session.prefersEphemeralWebBrowserSession = true
            session.start()
        }

        switch codeDuRetour(retour, etatAttendu: etat) {
        case .success(let code): return code
        case .failure(let erreur): throw erreur
        }
    }

    /// `ASWebAuthenticationSession` exige un fournisseur d'ancre retenu en mémoire : passé
    /// en local, il serait libéré avant que la session s'affiche.
    private final class Ancre: NSObject, ASWebAuthenticationPresentationContextProviding {
        private static var vivante: Ancre?
        private let fenetre: ASPresentationAnchor

        private init(_ fenetre: ASPresentationAnchor) { self.fenetre = fenetre }

        static func partagee(_ fenetre: ASPresentationAnchor) -> Ancre {
            let ancre = Ancre(fenetre)
            vivante = ancre
            return ancre
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            fenetre
        }
    }
}
