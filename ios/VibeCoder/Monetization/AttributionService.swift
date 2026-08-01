import Foundation
import AdServices

/// Registers Apple Search Ads attribution at first launch.
///
/// Pulls the ASA attribution token from `AAAttribution.attributionToken()` and
/// POSTs it to Apple's attribution endpoint so the campaign/keyword that drove
/// the install is recorded in ASA reports. Apple only honors the first POST
/// per install, so we persist a "sent" flag in `UserDefaults` and short-circuit
/// on subsequent launches.
final class AttributionService {
    static let shared = AttributionService()
    private let sentKey = "asa.attribution.sent"
    private init() {}

    func trackAttribution() {
        guard !UserDefaults.standard.bool(forKey: sentKey) else { return }
        Task.detached(priority: .background) {
            do {
                let token = try AAAttribution.attributionToken()
                try await Self.postToApple(token: token)
                UserDefaults.standard.set(true, forKey: self.sentKey)
            } catch { /* silent */ }
        }
    }

    private static func postToApple(token: String) async throws {
        var req = URLRequest(url: URL(string: "https://api-adservices.apple.com/api/v1/")!)
        req.httpMethod = "POST"
        req.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        req.httpBody = token.data(using: .utf8)
        _ = try await URLSession.shared.data(for: req)
    }
}
