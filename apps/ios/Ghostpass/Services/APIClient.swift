import Foundation

/// Erreurs remontées à l'UI. Le message du serveur est repris tel quel : il est
/// délibérément générique côté serveur (anti-énumération), donc le détailler ici
/// n'apporterait rien et risquerait d'en dire plus que voulu.
enum APIError: LocalizedError, Equatable {
    case badURL
    case http(status: Int, message: String)
    case mfaRequired(type: String)
    case malformedResponse

    var errorDescription: String? {
        switch self {
        case .badURL: return "Adresse de serveur invalide."
        case .http(_, let message): return message
        case .mfaRequired: return "Second facteur requis."
        case .malformedResponse: return "Réponse inattendue du serveur."
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

/// Client HTTP du serveur GhostPass. Il ne voit jamais que du chiffré : le clair
/// n'existe que de l'autre côté de la frontière FFI.
struct APIClient {
    var baseURL: URL
    var session: URLSession = .shared

    private func request(
        _ method: String, _ path: String, token: String? = nil, body: Data? = nil
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: req)
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
        return try decode(PreloginResponse.self, from: await request("POST", "api/auth/prelogin", body: body))
    }

    func login(email: String, masterPasswordHash: String, totpCode: String?) async throws
        -> LoginResponse
    {
        var payload: [String: String] = ["email": email, "masterPasswordHash": masterPasswordHash]
        if let totpCode, !totpCode.isEmpty { payload["totpCode"] = totpCode }
        let body = try JSONEncoder().encode(payload)
        return try decode(LoginResponse.self, from: await request("POST", "api/auth/login", body: body))
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
        try decode(ItemsEnvelope.self, from: await request("GET", "api/vault/items", token: token)).items
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
}
