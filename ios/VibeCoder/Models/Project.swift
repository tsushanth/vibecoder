import Foundation

struct Project: Identifiable, Codable {
    let id: String
    var title: String
    var description: String?
    var bundle: String? // base64 ZIP
    let creatorId: String
    var creatorName: String?
    var projectType: String
    var isPublic: Bool
    var playCount: Int
    var forkCount: Int
    var initialPrompt: String?
    var githubRepo: String?
    var freeTweaksRemaining: Int
    var publishedUrl: String?
    var parentProjectId: String?
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, bundle
        case creatorId = "creator_id"
        case creatorName = "creator_name"
        case projectType = "project_type"
        case isPublic = "is_public"
        case playCount = "play_count"
        case forkCount = "fork_count"
        case initialPrompt = "initial_prompt"
        case githubRepo = "github_repo"
        case freeTweaksRemaining = "free_tweaks_remaining"
        case publishedUrl = "published_url"
        case parentProjectId = "parent_project_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ProjectFile: Identifiable, Codable {
    var id: String { path }
    let path: String
    let size: Int

    var name: String {
        (path as NSString).lastPathComponent
    }

    var directory: String {
        let dir = (path as NSString).deletingLastPathComponent
        return dir.isEmpty ? "/" : dir
    }

    var fileExtension: String {
        (path as NSString).pathExtension.lowercased()
    }

    var iconName: String {
        switch fileExtension {
        case "html": return "doc.richtext"
        case "css": return "paintbrush"
        case "js": return "curlybraces"
        case "svg": return "photo"
        case "json": return "doc.text"
        default: return "doc"
        }
    }
}

struct ProjectVersion: Identifiable, Codable {
    var id: String { commitSha }
    let commitSha: String
    let message: String
    let date: String

    enum CodingKeys: String, CodingKey {
        case commitSha = "sha"
        case message, date
    }
}

struct ChatMessage: Identifiable {
    let id: String
    let role: MessageRole
    let content: String
    let timestamp: Date

    enum MessageRole {
        case user
        case assistant
        case system
    }

    init(role: MessageRole, content: String) {
        self.id = UUID().uuidString
        self.role = role
        self.content = content
        self.timestamp = Date()
    }
}
