import Foundation

/// Erreurs remontées à l'UI. Le message du serveur est repris tel quel : il est
/// délibérément générique côté serveur (anti-énumération), donc le détailler ici
/// n'apporterait rien et risquerait d'en dire plus que voulu.
enum APIError: LocalizedError, Equatable {
    case badURL
    case http(status: Int, message: String)
    case mfaRequired(type: String)
    case malformedResponse
    case reponseTropGrande

    var errorDescription: String? {
        switch self {
        case .badURL: return "Adresse de serveur invalide."
        case .http(_, let message): return message
        case .mfaRequired: return "Second facteur requis."
        case .malformedResponse: return "Réponse inattendue du serveur."
        case .reponseTropGrande:
            return "Le serveur a renvoyé une réponse anormalement volumineuse."
        }
    }
}

struct PreloginResponse: Decodable {
    /// Le serveur stocke les paramètres KDF en colonne TEXT et les renvoie **tels quels** :
    /// `kdfParams` est donc une chaîne contenant du JSON, pas un objet JSON. C'est
    /// exactement ce que le cœur Rust attend, et c'est ce que fait déjà la web app.
    /// La décoder puis la ré-encoder produirait une chaîne doublement échappée, que
    /// `serde` rejette (« invalid type: string, expected struct KdfParams »).
    let kdfParams: String
}

/// Ce que le serveur rend pour tenter une récupération. `kdfParams` est ici aussi une
/// chaîne contenant du JSON, pour la même raison qu'au prélogin.
struct RecoveryBlobResponse: Decodable {
    let kdfParams: String
    let encryptedUserKeyRecovery: String
    let encryptedPrivateKey: String
}

struct LoginResponse: Decodable {
    let token: String
    let kdfParams: String
    let encryptedUserKey: String
    let encryptedPrivateKey: String
}

/// La session rendue par l'échange SSO — `LoginResponse` plus l'adresse, que le client
/// n'a pas saisie puisque c'est le fournisseur d'identité qui l'a établie.
struct SsoSessionResponse: Decodable {
    let token: String
    let email: String
    let kdfParams: String
    let encryptedUserKey: String
    let encryptedPrivateKey: String
}

struct EncryptedItemDTO: Codable, Identifiable {
    let id: String
    let encryptedKey: String
    let encryptedData: String
    /// Horodatages en millisecondes depuis l'epoch : les colonnes sont des `INTEGER`
    /// et le serveur les expose tels quels. Les attendre en `String` faisait échouer
    /// le décodage de la liste entière, donc du coffre entier.
    var updatedAt: Int?
    var deletedAt: Int?
}

private struct ItemsEnvelope: Decodable {
    let items: [EncryptedItemDTO]
}

private struct ItemBody: Encodable {
    let encryptedKey: String
    let encryptedData: String
}

private struct ServerError: Decodable {
    let error: String?
    let mfaRequired: Bool?
    let mfaType: String?
}

// ─── Accès d'urgence ───

/// Un lien d'accès d'urgence, vu depuis l'un ou l'autre bout.
struct EmergencyContactDTO: Decodable, Identifiable {
    let id: String
    let contactEmail: String
    let role: String
    let waitDays: Int
    let status: String
    let requestedAt: Int?
    /// Renseigné seulement dans le sens « je suis le contact » : le délai est-il écoulé.
    var available: Bool?
}

struct EmergencyListDTO: Decodable {
    let asGrantor: [EmergencyContactDTO]
    let asGrantee: [EmergencyContactDTO]
}

/// Coffre du donneur, tel que le serveur le remet au contact une fois l'accès ouvert.
struct EmergencyAccessDTO: Decodable {
    let role: String
    let sealedUserKey: String
    let grantorPublicKey: String
    let grantorEmail: String
    /// Chaîne contenant du JSON, comme au prélogin : colonne TEXT rendue telle quelle.
    let grantorKdfParams: String
    let items: [EncryptedItemDTO]
}

private struct PublicKeyDTO: Decodable {
    let userId: String
    let publicKey: String
}

private struct EmergencyInviteBody: Encodable {
    let email: String
    let role: String
    let waitDays: Int
    let sealedUserKey: String
}

private struct TakeoverBody: Encodable {
    let masterPasswordHash: String
    let encryptedUserKey: String
}

// ─── Organisations ───

struct OrgSummaryDTO: Decodable, Identifiable {
    let orgId: String
    let name: String
    let role: String
    let status: String

    var id: String { orgId }
}

private struct OrgListDTO: Decodable {
    let organizations: [OrgSummaryDTO]
}

/// Ce qu'il faut pour ouvrir le coffre d'une organisation : l'Org Key scellée pour nous, et
/// la clé publique de l'admin qui l'a scellée — sans elle, on ne pourrait pas vérifier
/// qu'elle vient bien de lui, et un serveur actif pourrait en substituer une autre.
struct OrgMembershipDTO: Decodable {
    let role: String
    let status: String
    let encryptedOrgKey: String?
    let sealedByPublicKey: String?
}

struct OrgCollectionDTO: Decodable, Identifiable {
    let id: String
    let name: String
    /// La permission **effective** sur cette collection, telle que le serveur l'établit —
    /// rôle d'administrateur, octroi direct et accès de groupe additionnés.
    ///
    /// Optionnelle : un serveur antérieur au 2026-08-29 ne la renvoie pas, et l'exiger
    /// ferait échouer le décodage de la liste entière. Absente, on retombe sur le rôle
    /// dans l'organisation — moins juste, mais lisible.
    let permission: String?
}

private struct OrgCollectionsDTO: Decodable {
    let collections: [OrgCollectionDTO]
}

/// Un membre d'organisation, vu par un administrateur.
struct OrgMemberDTO: Decodable, Identifiable {
    let userId: String
    let email: String?
    let role: String
    let status: String

    var id: String { userId }
}

private struct OrgMembersDTO: Decodable {
    let members: [OrgMemberDTO]
}

struct OrgGroupMemberDTO: Decodable, Identifiable {
    let userId: String
    let email: String?

    var id: String { userId }
}

struct OrgGroupCollectionDTO: Decodable, Identifiable {
    let collectionId: String
    let permission: String

    var id: String { collectionId }
}

struct OrgGroupDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let members: [OrgGroupMemberDTO]
    let collections: [OrgGroupCollectionDTO]
}

private struct OrgGroupsDTO: Decodable {
    let groups: [OrgGroupDTO]
}

private struct CreateOrgBody: Encodable {
    let name: String
    let encryptedOrgKey: String
}

private struct AddMemberBody: Encodable {
    let email: String
    let role: String
    let encryptedOrgKey: String
}

private struct RoleBody: Encodable {
    let role: String
}

private struct NameBody: Encodable {
    let name: String
}

private struct UserIdBody: Encodable {
    let userId: String
}

private struct PermissionBody: Encodable {
    let permission: String
}

/// Une rotation d'Org Key : la nouvelle clé redistribuée à chaque membre restant, et toutes
/// les item keys ré-enveloppées. Le tout part en une seule requête — le serveur l'applique
/// dans une transaction, faute de quoi une rotation interrompue laisserait un coffre dont
/// une partie serait illisible pour tout le monde.
struct RotationBody: Encodable {
    let revokeUserId: String?
    let members: [MembreScelle]
    let items: [ItemReenveloppe]

    struct MembreScelle: Encodable {
        let userId: String
        let encryptedOrgKey: String
    }

    struct ItemReenveloppe: Encodable {
        let id: String
        let encryptedKey: String
    }
}

// ─── Partage ponctuel ───

private struct SendBody: Encodable {
    let ciphertext: String
    let iv: String
    let expiresInHours: Int
    let maxViews: Int
}

/// Ce que le serveur rend d'un partage créé.
///
/// `url` vient de ghostbit, à qui le partage est relayé : le serveur GhostPass ne
/// l'héberge plus. La reconstruire depuis l'identifiant produirait un lien vers un
/// serveur qui ne connaît pas ce partage — un lien mort, sans la moindre erreur.
private struct SendCreatedDTO: Decodable {
    let id: String
    /// Optionnels **à dessein**. Un serveur antérieur au relais rend `{ id }` seul : les
    /// exiger ferait échouer le décodage, et l'utilisateur verrait une réponse illisible
    /// là où le partage a parfaitement fonctionné. Le client doit savoir parler aux deux.
    let url: String?
    let deleteToken: String?
    let expiresAt: Int?
}

/// Ce que le serveur rend d'un partage : le chiffre et son nonce, jamais la clé.
struct SendContentDTO: Decodable {
    let ciphertext: String
    let iv: String
}

// ─── Second facteur ───

struct MfaStatusDTO: Decodable {
    let enabled: Bool
}

/// Ce que le serveur rend pour configurer un second facteur : le secret, et l'URI que lit
/// une application d'authentification.
struct MfaSetupDTO: Decodable {
    let secret: String
    let otpauthUri: String
}

private struct MasterHashBody: Encodable {
    let masterPasswordHash: String
}

private struct MfaCodeBody: Encodable {
    let code: String
}

private struct MfaDisableBody: Encodable {
    let masterPasswordHash: String
    let code: String
}

// ─── Journal du compte ───

struct LoginEventDTO: Decodable {
    let ip: String?
    let userAgent: String?
    let newDevice: Bool
    let createdAt: Int
}

private struct LoginEventsDTO: Decodable {
    let events: [LoginEventDTO]
}

struct AuditEventDTO: Decodable {
    let action: String
    let target: String?
    let ip: String?
    let createdAt: Int
}

private struct AuditEventsDTO: Decodable {
    let events: [AuditEventDTO]
}

/// D'où vient l'accès d'une personne : son rôle, un octroi direct, ou un groupe.
struct OrgAccessSourceDTO: Decodable, Hashable {
    let kind: String
    let label: String
    let permission: String
}

/// L'accès **effectif** de quelqu'un sur une collection.
///
/// Le serveur additionne les trois sources — rôle d'administrateur, octroi direct, accès
/// de groupe — et rend le maximum, avec le détail. Il n'en a pas toujours été ainsi : la
/// route ne rendait d'abord que les octrois directs, si bien qu'une collection lue et
/// écrite par deux administrateurs affichait « personne ». Cette vue reconstituait alors
/// les deux autres sources de son côté ; elle ne le fait plus, et c'est mieux — le serveur
/// est seul à connaître les groupes de chacun.
///
/// `email` peut être absent — le serveur renvoie `null` s'il ne retrouve pas le compte.
/// `revocable` ne vaut `true` que pour un octroi direct : un rôle se change, une
/// appartenance à un groupe se retire dans le groupe.
struct OrgCollectionAccessDTO: Decodable {
    let userId: String
    let email: String?
    let permission: String
    let sources: [OrgAccessSourceDTO]
    let revocable: Bool
}

private struct OrgCollectionAccessListDTO: Decodable {
    let access: [OrgCollectionAccessDTO]
}

private struct CollectionAccessBody: Encodable {
    let userId: String
    let permission: String
}

/// Client HTTP du serveur GhostPass. Il ne voit jamais que du chiffré : le clair
/// n'existe que de l'autre côté de la frontière FFI.
struct APIClient {
    var baseURL: URL
    /// Bornée : voir `ReseauBorne`. Le seuil s'applique **pendant** la réception, pas
    /// après — une réponse déjà entière en mémoire est déjà le problème qu'on voulait
    /// éviter.
    var reseau: ReseauBorne = .partage

    private func request(
        _ method: String, _ path: String, token: String? = nil, body: Data? = nil,
        headers: [String: String] = [:]
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        for (nom, valeur) in headers {
            req.setValue(valeur, forHTTPHeaderField: nom)
        }
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await reseau.donnees(pour: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.malformedResponse }
        guard (200..<300).contains(http.statusCode) else {
            let parsed = try? JSONDecoder().decode(ServerError.self, from: data)
            if parsed?.mfaRequired == true {
                throw APIError.mfaRequired(type: parsed?.mfaType ?? "totp")
            }
            throw APIError.http(
                status: http.statusCode,
                message: parsed?.error ?? "Erreur serveur (\(http.statusCode)).")
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.malformedResponse
        }
    }

    // ─── Authentification ───

    func prelogin(email: String) async throws -> PreloginResponse {
        let body = try JSONEncoder().encode(["email": email])
        return try decode(
            PreloginResponse.self, from: await request("POST", "api/auth/prelogin", body: body))
    }

    func login(email: String, masterPasswordHash: String, totpCode: String?) async throws
        -> LoginResponse
    {
        var payload: [String: String] = ["email": email, "masterPasswordHash": masterPasswordHash]
        if let totpCode, !totpCode.isEmpty { payload["totpCode"] = totpCode }
        let body = try JSONEncoder().encode(payload)
        return try decode(
            LoginResponse.self, from: await request("POST", "api/auth/login", body: body))
    }

    /// Le SSO est-il actif sur ce serveur ?
    ///
    /// Rien d'autre que ce booléen : le client ne fait aucune découverte OIDC. Un bouton
    /// qui promet une fonction absente du déploiement est pire que son absence — il
    /// déplace l'échec du moment où l'on configure au moment où quelqu'un essaie.
    func ssoActif() async -> Bool {
        struct Etat: Decodable { let enabled: Bool }
        guard let brut = try? await request("GET", "api/auth/sso/status"),
            let etat = try? decode(Etat.self, from: brut)
        else {
            // Un serveur qui ne connaît pas la route est un serveur sans SSO : on masque
            // le bouton plutôt que d'afficher une erreur pour une fonction non demandée.
            return false
        }
        return etat.enabled
    }

    /// Échange le code à usage unique contre une session.
    ///
    /// La réponse a exactement la forme du callback web, `email` en plus : un seul chemin
    /// de session à écrire côté client.
    func ssoEchanger(code: String, verificateur: String) async throws -> SsoSessionResponse {
        let body = try JSONEncoder().encode(["code": code, "codeVerifier": verificateur])
        return try decode(
            SsoSessionResponse.self,
            from: await request("POST", "api/auth/sso/exchange", body: body))
    }

    func logout(token: String) async throws {
        _ = try await request("POST", "api/auth/logout", token: token)
    }

    // ─── Récupération de compte ───
    //
    // Le serveur ne voit jamais la clé de récupération : il reçoit une preuve dérivée
    // d'elle, qu'il re-hache avant de la stocker, et une copie de la clé du coffre
    // enveloppée par cette même clé de récupération. Sans la clé, les deux ne valent rien.

    func enrollRecovery(token: String, recoveryAuthHash: String, encryptedUserKeyRecovery: String)
        async throws
    {
        let body = try JSONEncoder().encode([
            "recoveryAuthHash": recoveryAuthHash,
            "encryptedUserKeyRecovery": encryptedUserKeyRecovery,
        ])
        _ = try await request("POST", "api/account/recovery", token: token, body: body)
    }

    /// Les blobs nécessaires à une tentative de récupération. Le serveur répond de la même
    /// façon pour un compte sans kit — avec des leurres — pour ne pas révéler qui existe.
    func recoveryBlob(email: String) async throws -> RecoveryBlobResponse {
        let body = try JSONEncoder().encode(["email": email])
        return try decode(
            RecoveryBlobResponse.self,
            from: await request("POST", "api/auth/recovery-blob", body: body))
    }

    func recover(
        email: String, recoveryAuthHash: String, newMasterPasswordHash: String,
        newEncryptedUserKey: String
    ) async throws {
        let body = try JSONEncoder().encode([
            "email": email,
            "recoveryAuthHash": recoveryAuthHash,
            "newMasterPasswordHash": newMasterPasswordHash,
            "newEncryptedUserKey": newEncryptedUserKey,
        ])
        _ = try await request("POST", "api/auth/recover", body: body)
    }

    // ─── Coffre ───

    func listItems(token: String) async throws -> [EncryptedItemDTO] {
        try decode(ItemsEnvelope.self, from: await request("GET", "api/vault/items", token: token))
            .items
    }

    func createItem(token: String, encryptedKey: String, encryptedData: String) async throws
        -> EncryptedItemDTO
    {
        let body = try JSONEncoder().encode(
            ItemBody(encryptedKey: encryptedKey, encryptedData: encryptedData))
        return try decode(
            EncryptedItemDTO.self,
            from: await request("POST", "api/vault/items", token: token, body: body))
    }

    func updateItem(token: String, id: String, encryptedKey: String, encryptedData: String)
        async throws -> EncryptedItemDTO
    {
        let body = try JSONEncoder().encode(
            ItemBody(encryptedKey: encryptedKey, encryptedData: encryptedData))
        return try decode(
            EncryptedItemDTO.self,
            from: await request("PUT", "api/vault/items/\(id)", token: token, body: body))
    }

    /// Suppression douce : l'item part à la corbeille côté serveur.
    func deleteItem(token: String, id: String) async throws {
        _ = try await request("DELETE", "api/vault/items/\(id)", token: token)
    }

    // ─── Corbeille ───

    func listTrash(token: String) async throws -> [EncryptedItemDTO] {
        try decode(ItemsEnvelope.self, from: await request("GET", "api/vault/trash", token: token))
            .items
    }

    func restoreItem(token: String, id: String) async throws {
        _ = try await request("POST", "api/vault/trash/\(id)/restore", token: token)
    }

    /// Suppression définitive : l'item ne revient pas.
    func purgeItem(token: String, id: String) async throws {
        _ = try await request("DELETE", "api/vault/trash/\(id)", token: token)
    }

    // ─── Accès d'urgence ───

    /// Clé publique de partage d'un autre utilisateur, pour lui sceller quelque chose.
    func lookupPublicKey(token: String, email: String) async throws -> String {
        var composants = URLComponents()
        composants.path = "api/users/lookup"
        composants.queryItems = [URLQueryItem(name: "email", value: email)]
        guard let chemin = composants.string else { throw APIError.badURL }
        return try decode(PublicKeyDTO.self, from: await request("GET", chemin, token: token))
            .publicKey
    }

    func listEmergency(token: String) async throws -> EmergencyListDTO {
        try decode(EmergencyListDTO.self, from: await request("GET", "api/emergency", token: token))
    }

    /// Désigne un contact. `sealedUserKey` a été scellée par le cœur vers SA clé publique :
    /// le serveur transporte un blob qu'il ne peut pas ouvrir.
    func inviteEmergency(
        token: String, email: String, role: String, waitDays: Int, sealedUserKey: String
    ) async throws {
        let body = try JSONEncoder().encode(
            EmergencyInviteBody(
                email: email, role: role, waitDays: waitDays, sealedUserKey: sealedUserKey))
        _ = try await request("POST", "api/emergency", token: token, body: body)
    }

    /// `accept` et `request` sont du ressort du contact, `approve` et `reject` du donneur.
    func emergencyAction(token: String, id: String, action: String) async throws {
        _ = try await request("POST", "api/emergency/\(id)/\(action)", token: token)
    }

    func removeEmergency(token: String, id: String) async throws {
        _ = try await request("DELETE", "api/emergency/\(id)", token: token)
    }

    /// Le coffre du donneur. Refusé par le serveur tant que le délai d'attente court.
    func emergencyAccess(token: String, id: String) async throws -> EmergencyAccessDTO {
        try decode(
            EmergencyAccessDTO.self,
            from: await request("GET", "api/emergency/\(id)/access", token: token))
    }

    /// Reprise : impose au donneur un nouveau mot de passe maître, calculé par le cœur.
    func emergencyTakeover(
        token: String, id: String, masterPasswordHash: String, encryptedUserKey: String
    ) async throws {
        let body = try JSONEncoder().encode(
            TakeoverBody(
                masterPasswordHash: masterPasswordHash, encryptedUserKey: encryptedUserKey))
        _ = try await request("POST", "api/emergency/\(id)/takeover", token: token, body: body)
    }
    // ─── Organisations ───

    func listOrgs(token: String) async throws -> [OrgSummaryDTO] {
        try decode(OrgListDTO.self, from: await request("GET", "api/orgs", token: token))
            .organizations
    }

    func orgMembership(token: String, org: String) async throws -> OrgMembershipDTO {
        try decode(
            OrgMembershipDTO.self,
            from: await request("GET", "api/orgs/\(org)/membership", token: token))
    }

    func acceptOrg(token: String, org: String) async throws {
        _ = try await request("POST", "api/orgs/\(org)/accept", token: token)
    }

    /// Le serveur ne rend que les collections auxquelles ce membre a droit : la permission
    /// est tranchée là-bas, l'application ne fait qu'afficher ce qu'on lui donne.
    func orgCollections(token: String, org: String) async throws -> [OrgCollectionDTO] {
        try decode(
            OrgCollectionsDTO.self,
            from: await request("GET", "api/orgs/\(org)/collections", token: token)
        ).collections
    }

    func orgItems(token: String, org: String, collection: String) async throws
        -> [EncryptedItemDTO]
    {
        try decode(
            ItemsEnvelope.self,
            from: await request(
                "GET", "api/orgs/\(org)/collections/\(collection)/items", token: token)
        ).items
    }

    func createOrgItem(
        token: String, org: String, collection: String, encryptedKey: String,
        encryptedData: String
    ) async throws -> EncryptedItemDTO {
        let body = try JSONEncoder().encode(
            ItemBody(encryptedKey: encryptedKey, encryptedData: encryptedData))
        return try decode(
            EncryptedItemDTO.self,
            from: await request(
                "POST", "api/orgs/\(org)/collections/\(collection)/items", token: token,
                body: body))
    }

    func updateOrgItem(
        token: String, org: String, collection: String, id: String, encryptedKey: String,
        encryptedData: String
    ) async throws {
        let body = try JSONEncoder().encode(
            ItemBody(encryptedKey: encryptedKey, encryptedData: encryptedData))
        _ = try await request(
            "PUT", "api/orgs/\(org)/collections/\(collection)/items/\(id)", token: token,
            body: body)
    }

    func deleteOrgItem(token: String, org: String, collection: String, id: String) async throws {
        _ = try await request(
            "DELETE", "api/orgs/\(org)/collections/\(collection)/items/\(id)", token: token)
    }

    // ─── Administration d'organisation ───

    /// Crée une équipe. `encryptedOrgKey` est l'Org Key que le créateur s'est scellée à
    /// lui-même : c'est par elle qu'il rouvrira le coffre à sa prochaine session.
    func createOrg(token: String, name: String, encryptedOrgKey: String) async throws {
        let body = try JSONEncoder().encode(
            CreateOrgBody(name: name, encryptedOrgKey: encryptedOrgKey))
        _ = try await request("POST", "api/orgs", token: token, body: body)
    }

    func orgMembers(token: String, org: String) async throws -> [OrgMemberDTO] {
        try decode(
            OrgMembersDTO.self, from: await request("GET", "api/orgs/\(org)/members", token: token)
        ).members
    }

    /// Invite un membre. L'Org Key a été scellée en local vers SA clé publique : le serveur
    /// transporte un blob qu'il ne peut pas ouvrir.
    func addOrgMember(
        token: String, org: String, email: String, role: String, encryptedOrgKey: String
    ) async throws {
        let body = try JSONEncoder().encode(
            AddMemberBody(email: email, role: role, encryptedOrgKey: encryptedOrgKey))
        _ = try await request("POST", "api/orgs/\(org)/members", token: token, body: body)
    }

    func setOrgMemberRole(token: String, org: String, userId: String, role: String) async throws {
        let body = try JSONEncoder().encode(RoleBody(role: role))
        _ = try await request(
            "PUT", "api/orgs/\(org)/members/\(userId)", token: token, body: body)
    }

    /// Révoque un membre **et** fait tourner l'Org Key dans le même mouvement. Les deux sont
    /// indissociables : retirer quelqu'un sans changer la clé le laisserait capable de lire
    /// tout ce qui s'écrira ensuite.
    func rotateOrgKey(token: String, org: String, corps: RotationBody) async throws {
        let body = try JSONEncoder().encode(corps)
        _ = try await request("POST", "api/orgs/\(org)/rotate", token: token, body: body)
    }

    /// Tous les items de l'organisation, pour les ré-envelopper lors d'une rotation.
    func allOrgItems(token: String, org: String) async throws -> [EncryptedItemDTO] {
        try decode(
            ItemsEnvelope.self, from: await request("GET", "api/orgs/\(org)/items", token: token)
        ).items
    }

    func createOrgCollection(token: String, org: String, name: String) async throws {
        let body = try JSONEncoder().encode(NameBody(name: name))
        _ = try await request("POST", "api/orgs/\(org)/collections", token: token, body: body)
    }

    // ─── Groupes ───

    func orgGroups(token: String, org: String) async throws -> [OrgGroupDTO] {
        try decode(
            OrgGroupsDTO.self, from: await request("GET", "api/orgs/\(org)/groups", token: token)
        ).groups
    }

    func createOrgGroup(token: String, org: String, name: String) async throws {
        let body = try JSONEncoder().encode(NameBody(name: name))
        _ = try await request("POST", "api/orgs/\(org)/groups", token: token, body: body)
    }

    func deleteOrgGroup(token: String, org: String, group: String) async throws {
        _ = try await request("DELETE", "api/orgs/\(org)/groups/\(group)", token: token)
    }

    func addToOrgGroup(token: String, org: String, group: String, userId: String) async throws {
        let body = try JSONEncoder().encode(UserIdBody(userId: userId))
        _ = try await request(
            "POST", "api/orgs/\(org)/groups/\(group)/members", token: token, body: body)
    }

    func removeFromOrgGroup(token: String, org: String, group: String, userId: String) async throws
    {
        _ = try await request(
            "DELETE", "api/orgs/\(org)/groups/\(group)/members/\(userId)", token: token)
    }

    /// Donne à un groupe un droit sur une collection : lecture, écriture ou gestion.
    func setGroupCollectionAccess(
        token: String, org: String, group: String, collection: String, permission: String
    ) async throws {
        let body = try JSONEncoder().encode(PermissionBody(permission: permission))
        _ = try await request(
            "PUT", "api/orgs/\(org)/groups/\(group)/collections/\(collection)", token: token,
            body: body)
    }

    func revokeGroupCollectionAccess(
        token: String, org: String, group: String, collection: String
    ) async throws {
        _ = try await request(
            "DELETE", "api/orgs/\(org)/groups/\(group)/collections/\(collection)", token: token)
    }

    // ─── Partage ponctuel ───

    /// Dépose un secret déjà chiffré. Le serveur ne reçoit ni la clé ni le texte : il
    /// héberge un chiffre, en compte les consultations, et l'efface à échéance.
    /// Ce qu'un partage créé rend au client : de quoi le transmettre, et de quoi le
    /// révoquer. Le jeton n'existe qu'ici — le serveur n'en garde qu'une empreinte.
    struct PartageCree {
        let id: String
        /// Absente si le serveur héberge encore les partages lui-même. Le lien se déduit
        /// alors de son adresse, comme avant le relais.
        let url: String?
        /// Absent avec l'URL : sans relais, il n'y a pas de révocation à offrir.
        let deleteToken: String?
        let expiresAt: Int?
    }

    func createSend(
        token: String, ciphertext: String, iv: String, expiresInHours: Int, maxViews: Int
    ) async throws -> PartageCree {
        let body = try JSONEncoder().encode(
            SendBody(
                ciphertext: ciphertext, iv: iv, expiresInHours: expiresInHours,
                maxViews: maxViews))
        let dto = try decode(
            SendCreatedDTO.self, from: await request("POST", "api/send", token: token, body: body))
        return PartageCree(
            id: dto.id, url: dto.url, deleteToken: dto.deleteToken, expiresAt: dto.expiresAt)
    }

    /// Révoque un partage. Le jeton voyage en en-tête, pas dans l'URL : les chemins
    /// s'écrivent dans les journaux des serveurs intermédiaires, les en-têtes beaucoup
    /// moins. Le serveur rend 204 même rejouée.
    func revokeSend(token: String, id: String, deleteToken: String) async throws {
        _ = try await request(
            "DELETE", "api/send/\(id)", token: token,
            headers: ["x-delete-token": deleteToken])
    }

    /// Récupère un partage. Route publique — pas de jeton : celui qui a le lien y accède,
    /// et c'est la clé du fragment qui protège le contenu.
    func fetchSend(id: String) async throws -> SendContentDTO {
        try decode(SendContentDTO.self, from: await request("GET", "api/send/\(id)"))
    }

    // ─── Second facteur ───

    func mfaStatus(token: String) async throws -> Bool {
        try decode(MfaStatusDTO.self, from: await request("GET", "api/mfa", token: token)).enabled
    }

    /// Prépare un second facteur. **Remet la configuration à zéro** : à n'appeler que
    /// lorsque `mfaStatus` a répondu « inactif », sous peine de détruire un secret en place.
    func mfaSetup(token: String, masterPasswordHash: String) async throws -> MfaSetupDTO {
        let body = try JSONEncoder().encode(
            MasterHashBody(masterPasswordHash: masterPasswordHash))
        return try decode(
            MfaSetupDTO.self, from: await request("POST", "api/mfa/setup", token: token, body: body)
        )
    }

    /// Confirme la configuration par un premier code. Tant qu'elle n'est pas confirmée, le
    /// compte reste accessible sans second facteur — c'est ce qui évite de s'enfermer
    /// dehors avec une application d'authentification mal configurée.
    func mfaActivate(token: String, code: String) async throws {
        let body = try JSONEncoder().encode(MfaCodeBody(code: code))
        _ = try await request("POST", "api/mfa/activate", token: token, body: body)
    }

    func mfaDisable(token: String, masterPasswordHash: String, code: String) async throws {
        let body = try JSONEncoder().encode(
            MfaDisableBody(masterPasswordHash: masterPasswordHash, code: code))
        _ = try await request("POST", "api/mfa/disable", token: token, body: body)
    }

    // ─── Journal du compte ───

    /// Les connexions enregistrées : adresse, appareil, et si celui-ci était inconnu.
    func accountActivity(token: String) async throws -> [LoginEventDTO] {
        try decode(
            LoginEventsDTO.self, from: await request("GET", "api/account/activity", token: token)
        ).events
    }

    /// Les actions sensibles : activation d'un second facteur, accès d'urgence accordé,
    /// clé d'équipe renouvelée. C'est là qu'un accès illégitime laisse une trace.
    func accountAudit(token: String) async throws -> [AuditEventDTO] {
        try decode(
            AuditEventsDTO.self, from: await request("GET", "api/account/audit", token: token)
        ).events
    }

    // ─── Accès nommés aux collections ───
    // Les trois exigent la permission `manage` sur la collection ; le serveur le vérifie,
    // on ne fait que transmettre son verdict.

    func collectionAccess(token: String, org: String, collection: String) async throws
        -> [OrgCollectionAccessDTO]
    {
        try decode(
            OrgCollectionAccessListDTO.self,
            from: await request(
                "GET", "api/orgs/\(org)/collections/\(collection)/access", token: token)
        ).access
    }

    func grantCollectionAccess(
        token: String, org: String, collection: String, userId: String, permission: String
    ) async throws {
        let body = try JSONEncoder().encode(
            CollectionAccessBody(userId: userId, permission: permission))
        _ = try await request(
            "POST", "api/orgs/\(org)/collections/\(collection)/access", token: token,
            body: body)
    }

    /// Idempotent côté serveur : un second retrait répond comme le premier, pour qu'un
    /// double appui ne ressemble pas à une panne.
    func revokeCollectionAccess(
        token: String, org: String, collection: String, userId: String
    ) async throws {
        _ = try await request(
            "DELETE", "api/orgs/\(org)/collections/\(collection)/access/\(userId)",
            token: token)
    }

}
