//
//  VibeBuildAPI.swift
//  VibeCoder
//
//  HTTP client for the vibecoder-api backend on Fly. Surfaces only the
//  endpoints needed by the v3.0 "personal apps" flow:
//   - GET  /api/projects/suggestions   → 6 prompt chips
//   - GET  /api/projects/my            → list a user's own projects
//   - GET  /api/projects/:id           → poll project status during build
//   - POST /api/projects/generate      → kick off a build (SSE)
//   - POST /api/projects/:id/tweak     → refine a built project (SSE)
//
//  Streaming endpoints are exposed as AsyncThrowingStream via SSEClient.
//  Non-streaming endpoints return decoded models.
//

import Foundation

@MainActor
final class VibeBuildAPI {

    static let shared = VibeBuildAPI()

    /// Hard-coded for now. If a future debug build needs to point at localhost
    /// we'll read `VibeBuildAPIBase` from Info.plist; not worth the indirection yet.
    private let baseURL = URL(string: "https://vibecoder-api.fly.dev")!

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 20
        c.timeoutIntervalForResource = 30
        return URLSession(configuration: c)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        // The backend uses Postgres ISO timestamps with microseconds and "+00:00",
        // which JSONDecoder.iso8601 doesn't parse. Use a custom formatter.
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            if let d = f.date(from: s) { return d }
            let f2 = ISO8601DateFormatter()
            f2.formatOptions = [.withInternetDateTime]
            if let d = f2.date(from: s) { return d }
            return Date()
        }
        return d
    }()

    private let sse = SSEClient()

    // MARK: - Register user

    /// Upsert a row in `users(user_id)` so subsequent project inserts pass
    /// the FK constraint on `projects.creator_id`. Idempotent — safe to call
    /// repeatedly. Backend silently fails the placeholder insert and closes
    /// the SSE without a `queued` event when the user row doesn't exist,
    /// which surfaces as "Server didn't return a project ID" on the client.
    func registerUser(userId: String, displayName: String?, email: String?) async throws {
        let url = baseURL.appendingPathComponent("/api/auth/register")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["userId": userId]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        if let email, !email.isEmpty { body["email"] = email }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await session.data(for: req)
            try check(response: response, data: data)
        } catch let err as VBAPIError {
            throw err
        } catch {
            throw VBAPIError.network(error)
        }
    }

    // MARK: - Suggestions

    struct SuggestionsResponse: Codable {
        let success: Bool
        let suggestions: [VBSuggestion]
    }

    func fetchSuggestions(count: Int = 6) async throws -> [VBSuggestion] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/projects/suggestions"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "count", value: String(count))]
        let req = URLRequest(url: comps.url!)
        let resp: SuggestionsResponse = try await get(req)
        return resp.suggestions
    }

    // MARK: - My projects

    struct MyProjectsResponse: Codable {
        let success: Bool
        let projects: [VBProject]
        let totalCount: Int
        let hasMore: Bool
    }

    func fetchMyProjects(userId: String, limit: Int = 50, offset: Int = 0) async throws -> MyProjectsResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/projects/my"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "userId", value: userId),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        let req = URLRequest(url: comps.url!)
        return try await get(req)
    }

    // MARK: - Project detail (poll)

    struct ProjectDetailResponse: Codable {
        let success: Bool?
        let project: VBProject?
        // Some routes return the project flat at the top level — accept both.
        let id: String?
        let title: String?
        let status: VBProjectStatus?
        let previewUrl: URL?

        enum CodingKeys: String, CodingKey {
            case success, project, id, title, status
            case previewUrl = "preview_url"
        }
    }

    /// Returns the latest known project state. Use this to poll during a
    /// build started with `stream: false`.
    func fetchProject(id: String) async throws -> VBProject {
        let url = baseURL.appendingPathComponent("/api/projects/\(id)")
        let req = URLRequest(url: url)
        let resp: ProjectDetailResponse = try await get(req)
        if let p = resp.project { return p }
        // Flat-shape fallback.
        guard let id = resp.id else { throw VBAPIError.invalidResponse }
        return VBProject(
            id: id,
            title: resp.title,
            description: nil,
            initialPrompt: nil,
            status: resp.status ?? .unknown,
            previewUrl: resp.previewUrl,
            publishedUrl: nil,
            thumbnailUrl: nil,
            createdAt: nil,
            updatedAt: nil
        )
    }

    // MARK: - Push token registration

    /// Register an iOS APNs device token against the user so the backend can
    /// notify them when async builds complete. Calls `POST /api/auth/push-token`
    /// which upserts into `push_tokens` keyed by user_id.
    func registerPushToken(userId: String, token: String) async {
        let url = baseURL.appendingPathComponent("/api/auth/push-token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "userId": userId,
            "token": token,
            "platform": "ios"
        ])
        do {
            let (_, response) = try await session.data(for: req)
            if let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
                print("[Push] token registered for \(userId)")
            } else {
                print("[Push] registration non-2xx: \((response as? HTTPURLResponse)?.statusCode ?? -1)")
            }
        } catch {
            // Non-fatal: a missed registration just means the user won't get
            // notified on this device until next launch. Don't surface to UI.
            print("[Push] registration failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Rename

    struct RenameResponse: Codable {
        let success: Bool
        let project: VBProject?
    }

    /// Rename the project's title. Backend verifies ownership.
    @discardableResult
    func renameProject(id: String, userId: String, title: String) async throws -> VBProject? {
        let url = baseURL.appendingPathComponent("/api/projects/\(id)")
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["userId": userId, "title": title])
        do {
            let (data, response) = try await session.data(for: req)
            try check(response: response, data: data)
            let resp = try decoder.decode(RenameResponse.self, from: data)
            return resp.project
        } catch let err as VBAPIError {
            throw err
        } catch let err as DecodingError {
            throw VBAPIError.decoding(err)
        } catch {
            throw VBAPIError.network(error)
        }
    }

    // MARK: - Delete

    /// Delete a project the current user owns. Backend verifies `creator_id`.
    func deleteProject(id: String, userId: String) async throws {
        let url = baseURL.appendingPathComponent("/api/projects/\(id)")
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["userId": userId])
        do {
            let (data, response) = try await session.data(for: req)
            try check(response: response, data: data)
        } catch let err as VBAPIError {
            throw err
        } catch {
            throw VBAPIError.network(error)
        }
    }

    // MARK: - Generate (SSE)

    /// Kick off a build. Yields `.queued` immediately with the placeholder
    /// project id, then `.phase` updates if the worker is streaming, then a
    /// terminal `.complete` or `.failed`. In async-callback mode (stream=false)
    /// only `.queued` arrives; the caller must poll `fetchProject(id:)` until
    /// the project's status flips to `.ready`.
    func generate(
        prompt: String,
        userId: String,
        userName: String?,
        referenceImage: String? = nil,
        stream: Bool = false
    ) -> AsyncThrowingStream<VBBuildEvent, Error> {
        let url = baseURL.appendingPathComponent("/api/projects/generate")
        var body: [String: Any] = [
            "prompt": prompt,
            "userId": userId,
            "framework": "react",
            "source": "ios",
            "stream": stream
        ]
        if let userName, !userName.isEmpty { body["userName"] = userName }
        // referenceImage is raw base64 (no `data:` prefix, no line wrapping) —
        // matches the field name the backend's /generate route reads and forwards
        // to the worker, which decodes it onto disk for Claude CLI to read.
        if let img = referenceImage, !img.isEmpty { body["referenceImage"] = img }
        return sse.events(url: url, body: body, timeoutInterval: stream ? 600 : 60)
    }

    // MARK: - Tweak (SSE)

    /// Apply a follow-up tweak to a generated project. The backend always
    /// streams (`stream:false` is not honored); terminal success arrives as
    /// `VBBuildEvent.result(success: true)`. Field name on the wire is
    /// `tweakDescription` (not `prompt`).
    func tweak(
        projectId: String,
        tweakDescription: String,
        userId: String
    ) -> AsyncThrowingStream<VBBuildEvent, Error> {
        let url = baseURL.appendingPathComponent("/api/projects/\(projectId)/tweak")
        let body: [String: Any] = [
            "tweakDescription": tweakDescription,
            "userId": userId
        ]
        return sse.events(url: url, body: body, timeoutInterval: 600)
    }

    // MARK: - Version history

    struct VersionsResponse: Codable {
        let success: Bool
        let versions: [VBAppVersion]
        let hasRepo: Bool?
    }

    struct RevertResponse: Codable {
        let success: Bool
        let commitSha: String?
        let bundleSize: Int?
        // `bundle` field is base64 content, intentionally not decoded here —
        // the iOS client doesn't need it. The backend re-deploys the preview
        // server-side as a side effect, so reloading the WebView pulls the new bundle.
    }

    /// List recent commits for a project. The newest commit (the live version)
    /// is index 0.
    func fetchVersions(projectId: String, limit: Int = 20) async throws -> [VBAppVersion] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/projects/\(projectId)/versions"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        let req = URLRequest(url: comps.url!)
        let resp: VersionsResponse = try await get(req)
        return resp.versions
    }

    /// Revert the project to a prior commit. Backend re-bundles + redeploys
    /// to the existing preview URL, so the caller should reload the WebView
    /// once this returns successfully.
    @discardableResult
    func useVersion(projectId: String, sha: String, userId: String) async throws -> RevertResponse {
        let url = baseURL.appendingPathComponent("/api/projects/\(projectId)/revert/\(sha)")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["userId": userId])
        // Revert calls the worker to clone + reset + bundle + redeploy. Allow more time
        // than the default 20s — the bundle step is the slow part.
        req.timeoutInterval = 120
        do {
            let (data, response) = try await session.data(for: req)
            try check(response: response, data: data)
            do {
                return try decoder.decode(RevertResponse.self, from: data)
            } catch {
                throw VBAPIError.decoding(error)
            }
        } catch let err as VBAPIError {
            throw err
        } catch {
            throw VBAPIError.network(error)
        }
    }

    // MARK: - Internal

    private func get<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
            try check(response: response, data: data)
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw VBAPIError.decoding(error)
            }
        } catch let err as VBAPIError {
            throw err
        } catch {
            throw VBAPIError.network(error)
        }
    }

    private func check(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw VBAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw VBAPIError.http(status: http.statusCode, message: msg)
        }
    }
}
