import Foundation

class NetworkManager {
    static let shared = NetworkManager()

    // Use production GCP backend for all builds
    private let baseURL: String = {
        // Using production backend on GCP Cloud Run
        return "https://vibecoder-api-917362189743.us-central1.run.app"

        // To use local backend for development, change to:
        // return "http://localhost:8080"
    }()
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 600 // 10 minutes for long SSE streams
        self.session = URLSession(configuration: config)
    }

    // MARK: - Generic Request

    func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        headers: [String: String] = [:]
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw NetworkError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw NetworkError.serverError(errorResponse.error)
            }
            throw NetworkError.httpError(httpResponse.statusCode)
        }

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Streaming Request (SSE)

    func streamRequest(
        path: String,
        method: String = "POST",
        body: [String: Any]? = nil,
        onEvent: @escaping (SSEEvent) -> Void
    ) async throws {
        guard let url = URL(string: baseURL + path) else {
            throw NetworkError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (asyncBytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw NetworkError.httpError(httpResponse.statusCode)
        }

        var buffer = ""

        for try await line in asyncBytes.lines {
            if line.hasPrefix("data: ") {
                let eventData = String(line.dropFirst(6))
                buffer = eventData

                if let data = eventData.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

                    if let type = json["type"] as? String {
                        switch type {
                        case "status":
                            if let event = try? JSONDecoder().decode(SSEStatusEvent.self, from: data) {
                                onEvent(.status(event))
                            }
                        case "result":
                            if let event = try? JSONDecoder().decode(SSEResultEvent.self, from: data) {
                                onEvent(.result(event))
                            }
                        case "error":
                            if let error = json["error"] as? String {
                                onEvent(.error(error))
                            }
                        default:
                            break
                        }
                    }
                }
            }
        }
    }
}

// MARK: - SSE Events

enum SSEEvent {
    case status(SSEStatusEvent)
    case result(SSEResultEvent)
    case error(String)
}

struct SSEStatusEvent: Codable {
    let phase: String
    let message: String
    let detail: String
    let progressPercent: Double
    let progressEndPct: Double?
    let phaseDurationSeconds: Double?
    let estimatedSecondsRemaining: Double?
}

struct SSEResultEvent: Codable {
    let success: Bool
    let bundle: String
    let bundleSize: Int
    let files: [ProjectFile]?
    let generationTime: String?
    let quality: GenerationQuality?
}

struct GenerationQuality: Codable {
    let criticalIssues: Int
    let warnings: Int
    let phasesCompleted: Int
}

// MARK: - Errors

enum NetworkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case serverError(String)
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .serverError(let message):
            return message
        case .decodingError:
            return "Failed to decode response"
        }
    }
}

struct ErrorResponse: Codable {
    let error: String
}

// MARK: - Project API

extension NetworkManager {
    func saveProject(
        title: String,
        description: String?,
        bundle: String,
        creatorId: String,
        creatorName: String,
        initialPrompt: String,
        isPublic: Bool = true
    ) async throws -> SaveProjectResponse {
        try await request(
            path: "/api/projects/save",
            method: "POST",
            body: [
                "title": title,
                "description": description ?? "",
                "bundle": bundle,
                "creatorId": creatorId,
                "creatorName": creatorName,
                "initialPrompt": initialPrompt,
                "isPublic": isPublic
            ]
        )
    }

    func loadMyProjects(userId: String) async throws -> MyProjectsResponse {
        try await request(
            path: "/api/projects/my?userId=\(userId)"
        )
    }

    func getProject(id: String) async throws -> ProjectDetailResponse {
        try await request(
            path: "/api/projects/\(id)"
        )
    }

    func deleteProject(id: String, userId: String) async throws {
        guard let url = URL(string: "\(baseURL)/api/projects/\(id)") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["userId": userId])
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
    }
}

struct SaveProjectResponse: Codable {
    let success: Bool
    let projectId: String
}

struct MyProjectsResponse: Codable {
    let success: Bool
    let projects: [ProjectSummary]
    let totalCount: Int
    let hasMore: Bool
}

struct ProjectSummary: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let creatorName: String
    let framework: String?
    let viewCount: Int?
    let forkCount: Int?
    let createdAt: String
    let updatedAt: String?
    let isPublic: Bool
    let publishedUrl: String?
    let thumbnailUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, framework
        case creatorName = "creator_name"
        case viewCount = "view_count"
        case forkCount = "fork_count"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case isPublic = "is_public"
        case publishedUrl = "published_url"
        case thumbnailUrl = "thumbnail_url"
    }
}

struct ProjectDetailResponse: Codable {
    let success: Bool
    let project: ProjectDetail
}

struct ProjectDetail: Codable {
    let id: String
    let title: String
    let description: String?
    let bundle: String
    let creatorId: String
    let creatorName: String
    let framework: String?
    let isPublic: Bool
}

// MARK: - Custom Domains API

extension NetworkManager {

    func addCustomDomain(deploymentId: String, userId: String, domain: String) async throws -> AddDomainResponse {
        try await request(
            path: "/api/domains/\(deploymentId)/add",
            method: "POST",
            body: ["userId": userId, "domain": domain]
        )
    }

    func verifyCustomDomain(deploymentId: String, userId: String) async throws -> VerifyDomainResponse {
        try await request(
            path: "/api/domains/\(deploymentId)/verify",
            method: "POST",
            body: ["userId": userId]
        )
    }

    func getCustomDomainStatus(deploymentId: String, userId: String) async throws -> DomainStatusResponse {
        try await request(
            path: "/api/domains/\(deploymentId)?userId=\(userId)"
        )
    }

    func removeCustomDomain(deploymentId: String, userId: String) async throws -> RemoveDomainResponse {
        try await request(
            path: "/api/domains/\(deploymentId)",
            method: "DELETE",
            body: ["userId": userId]
        )
    }

    func getDeploymentInfo(projectId: String) async throws -> DeploymentInfoResponse {
        try await request(
            path: "/api/deploy/\(projectId)/deploy"
        )
    }
}

// MARK: - Domain Response Models

struct AddDomainResponse: Codable {
    let success: Bool
    let domain: String
    let status: String
    let cnameTarget: String
    let verificationToken: String
    let instructions: DomainInstructions?
}

struct DomainInstructions: Codable {
    let step1: String
    let step2: String
    let step3: String
}

struct VerifyDomainResponse: Codable {
    let success: Bool
    let status: String
    let message: String
}

struct DomainStatusResponse: Codable {
    let success: Bool
    let hasDomain: Bool
    let domain: String?
    let status: String?
    let cnameTarget: String?
    let txtRecord: String?
    let txtValue: String?
    let sslCertificateId: String?
    let lastCheckedAt: String?
    let createdAt: String?
}

struct RemoveDomainResponse: Codable {
    let success: Bool
    let removed: Bool?
    let domain: String?
}

struct DeploymentInfoResponse: Codable {
    let success: Bool
    let deployed: Bool
    let subdomain: String?
    let url: String?
    let deployedAt: String?
}
