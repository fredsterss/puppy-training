import Foundation

actor SupabaseService {
    static let projectURL = URL(string: "https://oxtftycmejirxiavcctx.supabase.co")!
    static let publishableKey = "sb_publishable_CDUi0SsTYS802cR-XZEbEg_31Jp0Mc4"

    private var connection: StoredConnection?
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
        self.connection = try? KeychainStore.load()
    }

    static func accessKey(from rawValue: String) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed) else { return nil }
        let queryKey = components.queryItems?.first(where: { $0.name == "sync" })?.value
        let fragmentItems = components.fragment.flatMap { URLComponents(string: "?\($0)")?.queryItems }
        let fragmentKey = fragmentItems?.first(where: { $0.name == "sync" })?.value
        let key = (queryKey ?? fragmentKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let key, key.count >= 32 else { return nil }
        return key
    }

    func isPaired() -> Bool { connection != nil }

    func connect(inviteLink: String) async throws -> [PuppyEvent] {
        guard let accessKey = Self.accessKey(from: inviteLink) else {
            throw ServiceError.userMessage("Paste the complete private Add phone link.")
        }
        let auth = try await signInAnonymously()
        let bootstrap = try await bootstrapHousehold(accessKey: accessKey, accessToken: auth.accessToken)
        let stored = StoredConnection(
            accessKey: accessKey,
            householdId: bootstrap.householdId,
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken,
            expiresAt: .now.addingTimeInterval(auth.expiresIn)
        )
        try KeychainStore.save(stored)
        connection = stored
        return try await fetchEvents()
    }

    func disconnect() throws {
        try KeychainStore.delete()
        connection = nil
    }

    func fetchEvents() async throws -> [PuppyEvent] {
        guard var active = connection else { throw ServiceError.notPaired }
        if active.expiresAt.timeIntervalSinceNow < 90 {
            active = try await refresh(active)
        }
        do {
            return try await requestEvents(active)
        } catch ServiceError.unauthorized {
            active.expiresAt = .distantPast
            active = try await refresh(active)
            return try await requestEvents(active)
        }
    }

    private func signInAnonymously() async throws -> AuthResponse {
        var request = request(path: "auth/v1/signup", method: "POST")
        request.setValue("Bearer \(Self.publishableKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = Data("{}".utf8)
        return try await decode(request, as: AuthResponse.self)
    }

    private func refresh(_ stored: StoredConnection) async throws -> StoredConnection {
        var components = URLComponents(url: Self.projectURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(Self.publishableKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["refresh_token": stored.refreshToken])
        let auth = try await decode(request, as: AuthResponse.self)
        var updated = stored
        updated.accessToken = auth.accessToken
        updated.refreshToken = auth.refreshToken
        updated.expiresAt = .now.addingTimeInterval(auth.expiresIn)
        try KeychainStore.save(updated)
        connection = updated
        return updated
    }

    private func bootstrapHousehold(accessKey: String, accessToken: String) async throws -> BootstrapResponse {
        var request = request(path: "rest/v1/rpc/bootstrap_household", method: "POST")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.pgrst.object+json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "access_key_input": accessKey,
            "display_name_input": "Mac menu bar"
        ])
        return try await decode(request, as: BootstrapResponse.self)
    }

    private func requestEvents(_ active: StoredConnection) async throws -> [PuppyEvent] {
        var components = URLComponents(url: Self.projectURL.appendingPathComponent("rest/v1/puppy_events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,type,occurred_at,consistency,tags"),
            URLQueryItem(name: "household_id", value: "eq.\(active.householdId.uuidString.lowercased())"),
            URLQueryItem(name: "deleted_at", value: "is.null"),
            URLQueryItem(name: "order", value: "occurred_at.desc"),
            URLQueryItem(name: "limit", value: "8")
        ]
        var request = URLRequest(url: components.url!)
        request.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(active.accessToken)", forHTTPHeaderField: "Authorization")
        return try await decode(request, as: [PuppyEvent].self)
    }

    private func request(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: Self.projectURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue(Self.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func decode<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        if http.statusCode == 401 { throw ServiceError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).message)
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw ServiceError.userMessage(message)
        }
        return try JSONDecoder().decode(type, from: data)
    }
}

private struct ServerError: Decodable {
    let message: String
}

enum ServiceError: LocalizedError {
    case notPaired
    case unauthorized
    case invalidResponse
    case userMessage(String)

    var errorDescription: String? {
        switch self {
        case .notPaired: "Connect this Mac with an Add phone link."
        case .unauthorized: "The cloud session expired. Reconnect this Mac."
        case .invalidResponse: "The cloud service returned an invalid response."
        case .userMessage(let message): message
        }
    }
}
