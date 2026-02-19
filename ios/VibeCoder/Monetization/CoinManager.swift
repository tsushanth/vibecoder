import Foundation
import StoreKit
import FirebaseAuth
import SwiftUI

class CoinManager: ObservableObject {
    static let shared = CoinManager()

    @Published var balance: Int = 0
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil
    @Published var products: [Product] = []

    static let tweakCost = 10
    static let forkCost = 10
    static let generationCost = 20

    enum CoinPack: String, CaseIterable {
        case small = "com.kreativekoala.vibercoder.coins.100"
        case medium = "com.kreativekoala.vibercoder.coins.500"
        case large = "com.kreativekoala.vibercoder.coins.1200"

        var coins: Int {
            switch self {
            case .small: return 100
            case .medium: return 500
            case .large: return 1200
            }
        }

        var label: String {
            switch self {
            case .small: return "100 Coins"
            case .medium: return "500 Coins"
            case .large: return "1,200 Coins"
            }
        }
    }

    private var transactionListener: Task<Void, Never>?

    private init() {
        transactionListener = listenForTransactions()
    }

    deinit {
        transactionListener?.cancel()
    }

    // MARK: - Balance

    func fetchBalance() {
        guard let userId = Auth.auth().currentUser?.uid else { return }
        guard let url = URL(string: "https://vibecoder.app/api/coins/balance?userId=\(userId)") else { return }

        isLoading = true
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            DispatchQueue.main.async {
                self?.isLoading = false
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let balance = json["balance"] as? Int else { return }
                self?.balance = balance
            }
        }.resume()
    }

    // MARK: - Spend Coins

    func spendForTweak(projectId: String, creatorId: String?, completion: @escaping (Bool) -> Void) {
        guard let userId = Auth.auth().currentUser?.uid else {
            completion(false)
            return
        }
        guard let url = URL(string: "https://vibecoder.app/api/coins/spend") else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "userId": userId,
            "reason": "tweak",
            "projectId": projectId,
            "platform": "ios"
        ]
        if let creatorId = creatorId {
            body["creatorId"] = creatorId
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let success = json["success"] as? Bool, success,
                      let newBalance = json["newBalance"] as? Int else {
                    completion(false)
                    return
                }
                self?.balance = newBalance
                completion(true)
            }
        }.resume()
    }

    func spendForFork(projectId: String, creatorId: String?, completion: @escaping (Bool) -> Void) {
        guard let userId = Auth.auth().currentUser?.uid else {
            completion(false)
            return
        }
        guard let url = URL(string: "https://vibecoder.app/api/coins/spend") else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "userId": userId,
            "reason": "fork",
            "projectId": projectId,
            "platform": "ios"
        ]
        if let creatorId = creatorId {
            body["creatorId"] = creatorId
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let success = json["success"] as? Bool, success,
                      let newBalance = json["newBalance"] as? Int else {
                    completion(false)
                    return
                }
                self?.balance = newBalance
                completion(true)
            }
        }.resume()
    }

    func spendForGeneration(completion: @escaping (Bool) -> Void) {
        guard let userId = Auth.auth().currentUser?.uid else {
            completion(false)
            return
        }
        guard let url = URL(string: "https://vibecoder.app/api/coins/spend") else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "userId": userId,
            "reason": "generation",
            "platform": "ios"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let success = json["success"] as? Bool, success,
                      let newBalance = json["newBalance"] as? Int else {
                    completion(false)
                    return
                }
                self?.balance = newBalance
                completion(true)
            }
        }.resume()
    }

    // MARK: - StoreKit 2 Purchase

    func fetchProducts() async {
        do {
            let productIds = CoinPack.allCases.map { $0.rawValue }
            let loadedProducts = try await Product.products(for: Set(productIds))
            await MainActor.run {
                self.products = loadedProducts
            }
        } catch {
            NSLog("[CoinManager] Failed to load products: %@", error.localizedDescription)
            await MainActor.run {
                self.errorMessage = "Failed to load products"
            }
        }
    }

    func product(for pack: CoinPack) -> Product? {
        products.first { $0.id == pack.rawValue }
    }

    func purchaseCoins(productId: String) async -> Bool {
        guard let pack = CoinPack(rawValue: productId),
              let product = product(for: pack) else {
            await MainActor.run {
                self.errorMessage = "Product not available"
            }
            return false
        }

        await MainActor.run {
            self.isLoading = true
            self.errorMessage = nil
        }

        do {
            let result = try await product.purchase()

            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await recordPurchase(pack: pack, transactionId: String(transaction.id))
                await transaction.finish()
                await MainActor.run {
                    self.isLoading = false
                }
                return true

            case .userCancelled:
                await MainActor.run {
                    self.isLoading = false
                }
                return false

            case .pending:
                await MainActor.run {
                    self.isLoading = false
                    self.errorMessage = "Purchase is pending"
                }
                return false

            @unknown default:
                await MainActor.run {
                    self.isLoading = false
                    self.errorMessage = "Unknown result"
                }
                return false
            }
        } catch {
            await MainActor.run {
                self.isLoading = false
                self.errorMessage = error.localizedDescription
            }
            return false
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw NSError(domain: "CoinManager", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "Transaction verification failed"])
        case .verified(let safe):
            return safe
        }
    }

    private func recordPurchase(pack: CoinPack, transactionId: String) async {
        guard let userId = Auth.auth().currentUser?.uid else { return }
        guard let url = URL(string: "https://vibecoder.app/api/coins/purchase") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "userId": userId,
            "productId": pack.rawValue,
            "transactionId": transactionId,
            "platform": "ios"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let newBalance = json["newBalance"] as? Int {
                await MainActor.run { self.balance = newBalance }
            }
        } catch {
            NSLog("[CoinManager] Record purchase error: %@", error.localizedDescription)
        }
    }

    func restorePurchases() async {
        await MainActor.run {
            self.isLoading = true
            self.errorMessage = nil
        }

        for await result in Transaction.currentEntitlements {
            if let transaction = try? checkVerified(result) {
                await transaction.finish()
            }
        }

        fetchBalance()

        await MainActor.run {
            self.isLoading = false
        }
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached {
            for await result in Transaction.updates {
                if let transaction = try? self.checkVerified(result) {
                    await transaction.finish()
                    self.fetchBalance()
                }
            }
        }
    }
}
