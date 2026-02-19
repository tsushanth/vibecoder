import Foundation

struct User: Identifiable, Codable {
    let userId: String
    var email: String?
    var displayName: String?
    var avatarUrl: String?
    var subscriptionTier: String
    var subscriptionStatus: String?
    var subscriptionExpiresAt: String?
    var dailyGenerationCount: Int
    var lastGenerationDate: String?
    var totalProjects: Int
    var createdAt: String?

    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case subscriptionTier = "subscription_tier"
        case subscriptionStatus = "subscription_status"
        case subscriptionExpiresAt = "subscription_expires_at"
        case dailyGenerationCount = "daily_generation_count"
        case lastGenerationDate = "last_generation_date"
        case totalProjects = "total_projects"
        case createdAt = "created_at"
    }
}

// MARK: - Subscription

struct Subscription: Identifiable, Codable {
    let id: String
    let userId: String
    let tier: String
    let status: String
    let platform: String
    let transactionId: String?
    let expiresAt: String?
    let autoRenew: Bool
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case tier
        case status
        case platform
        case transactionId = "transaction_id"
        case expiresAt = "expires_at"
        case autoRenew = "auto_renew"
        case createdAt = "created_at"
    }
}

struct UsageRecord: Identifiable, Codable {
    let id: String
    let userId: String
    let actionType: String
    let projectId: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case actionType = "action_type"
        case projectId = "project_id"
        case createdAt = "created_at"
    }
}
