//
//  BuildModels.swift
//  VibeCoder
//
//  Codable models for the personal-project build pipeline. Mirrors the
//  shape returned by vibecoder-api.fly.dev (see backend/routes/projects.routes.js).
//

import Foundation

// MARK: - Project

/// One generated project owned by a user. Matches the row shape returned by
/// `GET /api/projects/my` and `GET /api/projects/:id`.
struct VBProject: Identifiable, Codable, Equatable, Hashable {
    let id: String
    var title: String?
    var description: String?
    var initialPrompt: String?
    var status: VBProjectStatus
    var previewUrl: URL?
    var publishedUrl: URL?
    var thumbnailUrl: URL?
    var createdAt: Date?
    var updatedAt: Date?

    /// Effective URL to render. Once published, the project's preview_url is
    /// cleared and only published_url remains.
    var displayUrl: URL? { publishedUrl ?? previewUrl }

    /// True when the project has a public, shareable URL.
    var isPublished: Bool { publishedUrl != nil }

    enum CodingKeys: String, CodingKey {
        case id, title, description, status
        case initialPrompt = "initial_prompt"
        case previewUrl = "preview_url"
        case publishedUrl = "published_url"
        case thumbnailUrl = "thumbnail_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum VBProjectStatus: String, Codable {
    case building
    case ready
    case failed
    /// Anything we haven't seen yet — treat as transient.
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = VBProjectStatus(rawValue: raw) ?? .unknown
    }
}

// MARK: - Suggestion

struct VBSuggestion: Codable, Identifiable, Equatable, Hashable {
    var id: String { label }
    let label: String
    let prompt: String
}

// MARK: - Build SSE events

/// One event emitted by the `POST /api/projects/generate` SSE stream.
/// In async-callback mode the server only emits a single `queued` event
/// then closes the connection; the client polls `GET /api/projects/:id`.
/// In stream mode the worker proxies `phase` updates through.
enum VBBuildEvent: Equatable {
    case queued(projectId: String)
    case phase(name: String, message: String?)
    case complete(projectId: String, previewUrl: URL?)
    /// Tweak endpoint terminal success. Signals the project's bundle is updated.
    case result(success: Bool)
    case failed(message: String)
    /// SSE comment / heartbeat. Useful to keep idle UIs alive.
    case heartbeat
    case unknown(raw: String)

    /// Parse a single SSE `data:` payload (already stripped of the `data: ` prefix).
    static func parse(jsonPayload: String) -> VBBuildEvent {
        guard let data = jsonPayload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return .unknown(raw: jsonPayload) }
        let type = (obj["type"] as? String) ?? ""
        switch type {
        case "queued":
            return .queued(projectId: (obj["projectId"] as? String) ?? "")
        case "phase", "status", "progress":
            return .phase(
                name: (obj["phase"] as? String) ?? (obj["status"] as? String) ?? "working",
                message: obj["message"] as? String
            )
        case "complete", "done", "ready":
            let url = (obj["previewUrl"] as? String).flatMap(URL.init(string:))
            return .complete(projectId: (obj["projectId"] as? String) ?? "", previewUrl: url)
        case "result":
            // Tweak endpoint uses `success: bool`; generate's result payloads
            // don't share this type so we treat absence as success.
            return .result(success: (obj["success"] as? Bool) ?? true)
        case "error", "failed":
            // Tweak emits `{type:"error", error:"..."}`; generate emits `message`.
            let msg = (obj["error"] as? String) ?? (obj["message"] as? String) ?? "Build failed"
            return .failed(message: msg)
        default:
            return .unknown(raw: jsonPayload)
        }
    }
}

// MARK: - Version history

/// One git commit in a project's history. Returned by GET /api/projects/:id/versions.
struct VBAppVersion: Codable, Identifiable, Equatable, Hashable {
    let sha: String
    let shortSha: String?
    let message: String?
    let date: Date?
    let author: String?

    var id: String { sha }

    enum CodingKeys: String, CodingKey {
        case sha, message, date, author
        case shortSha = "shortSha"
    }
}

// MARK: - Errors

enum VBAPIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case http(status: Int, message: String?)
    case decoding(Error)
    case network(Error)
    case promptBlocked(message: String)
    case rateLimited(message: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid request URL."
        case .invalidResponse: return "Server returned an invalid response."
        case .http(_, let message): return message ?? "Request failed."
        case .decoding(let err): return "Couldn't read response: \(err.localizedDescription)"
        case .network(let err): return err.localizedDescription
        case .promptBlocked(let message), .rateLimited(let message): return message
        }
    }
}
