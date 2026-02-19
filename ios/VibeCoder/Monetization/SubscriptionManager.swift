import SwiftUI
import StoreKit

enum SubscriptionTier: String, Codable {
    case free = "free"
    case pro = "pro"
    case team = "team"
    case enterprise = "enterprise"

    var displayName: String {
        switch self {
        case .free: return "Free"
        case .pro: return "Pro"
        case .team: return "Team"
        case .enterprise: return "Enterprise"
        }
    }

    var dailyGenerationLimit: Int? {
        switch self {
        case .free: return 3
        case .pro, .team, .enterprise: return nil // Unlimited
        }
    }

    var tweaksPerProject: Int? {
        switch self {
        case .free: return 3
        case .pro, .team, .enterprise: return nil // Unlimited
        }
    }

    var canCreatePrivateProjects: Bool {
        switch self {
        case .free: return false
        case .pro, .team, .enterprise: return true
        }
    }

    var hasPriorityQueue: Bool {
        switch self {
        case .free: return false
        case .pro, .team, .enterprise: return true
        }
    }
}

class SubscriptionManager: ObservableObject {
    static let shared = SubscriptionManager()

    // Subscription state
    @Published var currentTier: SubscriptionTier = .free
    @Published var subscriptionStatus: String = "Free Plan"
    @Published var isSubscribed: Bool = false
    @Published var expirationDate: Date?

    // Usage tracking (for free tier) — persisted across launches
    @Published var dailyGenerationsUsed: Int = UserDefaults.standard.integer(forKey: "dailyGenerationsUsed")
    @Published var lastGenerationDate: Date = (UserDefaults.standard.object(forKey: "lastGenerationDate") as? Date) ?? Date()

    // Available products
    @Published var availableProducts: [Product] = []
    @Published var purchasedSubscriptions: [Product] = []

    // Product IDs
    private let productIDs = [
        "com.kreativekoala.vibercoder.pro.monthly",
        "com.kreativekoala.vibercoder.pro.yearly",
        "com.kreativekoala.vibercoder.team.monthly"
    ]

    private init() {
        Task {
            await loadProducts()
            await updateSubscriptionStatus()
        }
    }

    // MARK: - Subscription Status

    func updateSubscriptionStatus() async {
        // Check StoreKit for active subscriptions
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }

            if transaction.productID.contains("pro") {
                await MainActor.run {
                    currentTier = .pro
                    isSubscribed = true
                    expirationDate = transaction.expirationDate
                }
            } else if transaction.productID.contains("team") {
                await MainActor.run {
                    currentTier = .team
                    isSubscribed = true
                    expirationDate = transaction.expirationDate
                }
            }
        }

        await MainActor.run {
            updateStatusText()
        }
    }

    private func updateStatusText() {
        if isSubscribed {
            if let expiration = expirationDate {
                let formatter = DateFormatter()
                formatter.dateStyle = .medium
                subscriptionStatus = "\(currentTier.displayName) • Renews \(formatter.string(from: expiration))"
            } else {
                subscriptionStatus = "\(currentTier.displayName) Plan"
            }
        } else {
            subscriptionStatus = "Free Plan"
        }
    }

    // MARK: - Usage Limits

    func canGenerate() -> Bool {
        guard currentTier == .free else { return true } // Pro/Team/Enterprise unlimited

        // Reset daily count if it's a new day
        if !Calendar.current.isDateInToday(lastGenerationDate) {
            dailyGenerationsUsed = 0
            lastGenerationDate = Date()
            UserDefaults.standard.set(0, forKey: "dailyGenerationsUsed")
            UserDefaults.standard.set(lastGenerationDate, forKey: "lastGenerationDate")
        }

        guard let limit = currentTier.dailyGenerationLimit else { return true }
        return dailyGenerationsUsed < limit
    }

    func recordGeneration() {
        guard currentTier == .free else { return }

        if !Calendar.current.isDateInToday(lastGenerationDate) {
            dailyGenerationsUsed = 0
            lastGenerationDate = Date()
            UserDefaults.standard.set(lastGenerationDate, forKey: "lastGenerationDate")
        }

        dailyGenerationsUsed += 1
        UserDefaults.standard.set(dailyGenerationsUsed, forKey: "dailyGenerationsUsed")
    }

    func generationsRemaining() -> String {
        guard currentTier == .free else { return "Unlimited" }

        if !Calendar.current.isDateInToday(lastGenerationDate) {
            dailyGenerationsUsed = 0
            lastGenerationDate = Date()
            UserDefaults.standard.set(0, forKey: "dailyGenerationsUsed")
            UserDefaults.standard.set(lastGenerationDate, forKey: "lastGenerationDate")
        }

        guard let limit = currentTier.dailyGenerationLimit else { return "Unlimited" }
        let remaining = max(0, limit - dailyGenerationsUsed)
        return "\(remaining) of \(limit) today"
    }

    // MARK: - StoreKit

    func loadProducts() async {
        do {
            let products = try await Product.products(for: productIDs)
            await MainActor.run {
                self.availableProducts = products
                print("✅ Loaded \(products.count) products")
            }
        } catch {
            print("❌ Failed to load products: \(error)")
            // For development: Enable test mode if products fail to load
            #if DEBUG
            print("ℹ️ Running in test mode - subscriptions will be simulated")
            #endif
        }
    }

    func purchase(_ product: Product) async throws {
        print("🛒 Attempting to purchase: \(product.displayName)")

        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            switch verification {
            case .verified(let transaction):
                print("✅ Purchase verified: \(transaction.productID)")
                // Grant access
                await updateSubscriptionStatus()
                await transaction.finish()
            case .unverified:
                print("❌ Purchase verification failed")
                throw SubscriptionError.verificationFailed
            }
        case .userCancelled:
            print("ℹ️ User cancelled purchase")
            break
        case .pending:
            print("⏳ Purchase pending")
            break
        @unknown default:
            break
        }
    }

    // Debug function to simulate subscription upgrade (for testing)
    func debugUpgradeToPro() {
        #if DEBUG
        currentTier = .pro
        isSubscribed = true
        expirationDate = Calendar.current.date(byAdding: .month, value: 1, to: Date())
        updateStatusText()
        print("🧪 DEBUG: Upgraded to Pro tier")
        #endif
    }

    func debugDowngradeToFree() {
        #if DEBUG
        currentTier = .free
        isSubscribed = false
        expirationDate = nil
        dailyGenerationsUsed = 0
        updateStatusText()
        print("🧪 DEBUG: Downgraded to Free tier")
        #endif
    }

    func restorePurchases() async {
        do {
            try await AppStore.sync()
            await updateSubscriptionStatus()
        } catch {
            print("Failed to restore purchases: \(error)")
        }
    }

    func manageSubscription() {
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            Task {
                do {
                    try await AppStore.showManageSubscriptions(in: windowScene)
                } catch {
                    print("Failed to show manage subscriptions: \(error)")
                }
            }
        }
    }
}

enum SubscriptionError: LocalizedError {
    case verificationFailed
    case productNotFound

    var errorDescription: String? {
        switch self {
        case .verificationFailed:
            return "Failed to verify purchase"
        case .productNotFound:
            return "Product not found"
        }
    }
}

// MARK: - Subscription Plans

struct SubscriptionPlan: Identifiable {
    let id: String
    let name: String
    let tier: SubscriptionTier
    let price: String
    let billingPeriod: String
    let features: [String]
    let isPopular: Bool
    let productId: String

    static let plans: [SubscriptionPlan] = [
        SubscriptionPlan(
            id: "free",
            name: "Free",
            tier: .free,
            price: "$0",
            billingPeriod: "forever",
            features: [
                "3 AI generations per day",
                "3 tweaks per project",
                "Public projects only",
                "Standard queue",
                "vibecoder.app subdomain"
            ],
            isPopular: false,
            productId: ""
        ),
        SubscriptionPlan(
            id: "pro-monthly",
            name: "Pro",
            tier: .pro,
            price: "$19",
            billingPeriod: "per month",
            features: [
                "✨ Unlimited generations",
                "✨ Unlimited tweaks",
                "✨ Private projects",
                "✨ Priority queue (2x faster)",
                "✨ Custom domains",
                "✨ Download source code",
                "✨ 30-day version history",
                "✨ Remove VibeBuild badge"
            ],
            isPopular: true,
            productId: "com.kreativekoala.vibercoder.pro.monthly"
        ),
        SubscriptionPlan(
            id: "pro-yearly",
            name: "Pro Annual",
            tier: .pro,
            price: "$190",
            billingPeriod: "per year (save 17%)",
            features: [
                "✨ Everything in Pro Monthly",
                "💰 Save $38 per year",
                "🎁 2 months free"
            ],
            isPopular: false,
            productId: "com.kreativekoala.vibercoder.pro.yearly"
        )
    ]
}
