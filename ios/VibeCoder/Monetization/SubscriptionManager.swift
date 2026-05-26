import SwiftUI
import StoreKit
import RatingKit

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

    /// Explicit product-load state so UI can distinguish "still loading" from "loaded empty" / "failed".
    /// Apple rejected 1.1(29) under 2.1(b) because the previous code treated empty products as still-loading
    /// → spinner spun forever on the review device. Track state explicitly and surface error UI on empty/failed.
    enum ProductLoadState: Equatable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }
    @Published var productLoadState: ProductLoadState = .idle

    // Product IDs. team.monthly intentionally not yet listed in App Store Connect — would silently drop
    // from Product.products() result. Re-add when the product is created in ASC.
    private let productIDs = [
        "com.kreativekoala.vibercoder.pro.monthly",
        "com.kreativekoala.vibercoder.pro.yearly"
    ]

    private init() {
        Task {
            await loadProducts()
            await updateSubscriptionStatus()
        }
    }

    // MARK: - Subscription Status

    func updateSubscriptionStatus() async {
        // Reset before recomputing so a cancelled subscription correctly
        // flips back to free rather than sticking on the prior state.
        await MainActor.run {
            currentTier = .free
            isSubscribed = false
            expirationDate = nil
        }

        // Check StoreKit for active subscriptions. In DEBUG against the local
        // .storekit test config, currentEntitlements are .unverified — we
        // honor those so the simulator can exercise the subscribed UI.
        // Production builds only honor verified Apple-signed entitlements.
        for await result in Transaction.currentEntitlements {
            let transaction: StoreKit.Transaction?
            switch result {
            case .verified(let t): transaction = t
            case .unverified(let t, _):
                #if DEBUG
                transaction = t
                #else
                transaction = nil
                #endif
            }
            guard let transaction else { continue }

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
        await MainActor.run { self.productLoadState = .loading }
        do {
            // Race the StoreKit fetch against a 15s timeout. Without this, a hung sandbox
            // (or network) could leave the UI spinning indefinitely — the exact symptom
            // Apple cited in the 1.1(29) 2.1(b) rejection.
            let products: [Product] = try await withThrowingTaskGroup(of: [Product].self) { group in
                group.addTask { try await Product.products(for: self.productIDs) }
                group.addTask {
                    try await Task.sleep(nanoseconds: 15_000_000_000)
                    throw NSError(domain: "SubscriptionManager", code: -1001,
                                  userInfo: [NSLocalizedDescriptionKey: "Product load timed out"])
                }
                guard let result = try await group.next() else { return [Product]() }
                group.cancelAll()
                return result
            }
            await MainActor.run {
                self.availableProducts = products
                self.productLoadState = products.isEmpty ? .empty : .loaded
                print("✅ Loaded \(products.count) products")
            }
        } catch {
            await MainActor.run {
                self.productLoadState = .failed(error.localizedDescription)
            }
            print("❌ Failed to load products: \(error)")
        }
    }

    func purchase(_ product: Product) async throws {
        print("🛒 Attempting to purchase: \(product.displayName)")

        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            // Extract the transaction either from a verified envelope OR, in
            // DEBUG builds against the local StoreKit test config, from an
            // unverified one. Local .storekit transactions are intentionally
            // unsigned by Apple and will always come back as .unverified —
            // refusing them would block all simulator testing.
            let transaction: StoreKit.Transaction?
            switch verification {
            case .verified(let t):
                print("✅ Purchase verified: \(t.productID)")
                transaction = t
            case .unverified(let t, let err):
                #if DEBUG
                print("⚠️ Purchase unverified (StoreKit test config) — accepting in DEBUG: \(err)")
                transaction = t
                #else
                print("❌ Purchase verification failed: \(err)")
                throw SubscriptionError.verificationFailed
                #endif
            }
            if let transaction {
                await updateSubscriptionStatus()
                await transaction.finish()
                await MainActor.run { RatingKit.shared.trackPurchase() }
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
                "Browse the community gallery",
                "Open up to 5 projects in Safari per day",
                "Save up to 3 favorites on this device"
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
                "Unlimited Safari launches",
                "Unlimited favorites",
                "Full view history",
                "Priority support"
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
                "Everything in Pro Monthly",
                "Save $38 per year",
                "2 months free"
            ],
            isPopular: false,
            productId: "com.kreativekoala.vibercoder.pro.yearly"
        )
    ]
}
