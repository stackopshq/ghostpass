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
    /// Le serveur renvoie l'objet KDF ; le cœur Rust l'attend en JSON, on le
    /// garde donc sous forme brute plutôt que de le décoder puis de le ré-encoder.
    let kdfParams: JSONValue
}

struct LoginResponse: Decodable {
    let token: String
    let kdfParams: JSONValue
    let encryptedUserKey: String
    let encryptedPrivateKey: String
}

struct EncryptedItemDTO: Codable, Identifiable {
    let id: String
    let encryptedKey: String
    let encryptedData: String
    var updatedAt: String?
    var deletedAt: String?
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
}
