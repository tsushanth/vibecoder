import SwiftUI
import UserNotifications
import FirebaseCore
import GoogleSignIn
import RatingKit
import PaywallKit
import PromoOfferKit

@main
struct VibeCoderApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var authManager = AuthManager.shared
    @StateObject private var premium = PremiumManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ratingPrompt()
                .paywallKitReferral()
                .promoOffer()
                .environmentObject(authManager)
                .environmentObject(premium)
        }
    }
}

/// StoreKit 2 product identifiers for the VibeBuild Tinker Pro subscription
/// group. Must match the IDs registered in App Store Connect. The `.tinker.*`
/// namespace is used because Apple permanently reserves any previously-used
/// product ID — the prior `.pro.*` IDs from the 1.x AI-builder Pro tier
/// can never be reused.
enum VibeBuildProductID {
    static let monthly = "com.kreativekoala.vibercoder.tinker.monthly"
    static let yearly  = "com.kreativekoala.vibercoder.tinker.yearly"
    static let all = [monthly, yearly]
}

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return GIDSignIn.sharedInstance.handle(url)
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        FirebaseApp.configure()
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: "917362189743-s7v2aog4n3ch74hn7igq4jekjfcsi38g.apps.googleusercontent.com",
            serverClientID: "917362189743-2tgjn2l4m09ht423l9ogsm74aiotbjgv.apps.googleusercontent.com"
        )
        UNUserNotificationCenter.current().delegate = self

        // Server-driven rating prompts (variant testing + analytics).
        RatingKit.configure(appId: "vibebuild", apiUrl: "https://paywallkit-api.fly.dev")
        RatingKit.shared.trackAppOpen()

        // StoreKit 2 products + referral system via PaywallKit. The referral
        // prompt only auto-fires for existing subscribers; non-subscribers
        // see paywalls only when they tap a Pro-gated control.
        PaywallKitSDK.shared.configure(
            appId: "vibebuild",
            appName: "VibeBuild",
            productIds: VibeBuildProductID.all
        )
        Task { @MainActor in
            await StoreManager.shared.loadProducts()
            await PremiumManager.shared.refresh()
        }

        // Cancel-flow retention: present Apple Promotional Offer to lapsed subscribers
        PromoOfferKit.configure(
            bundleId: "com.kreativekoala.vibercoder",
            apiBaseUrl: URL(string: "https://paywallkit-api.fly.dev")!,
            productIdToOfferCode: [
                "com.kreativekoala.vibercoder.tinker.yearly":  "vbcoder_h1yr",
                "com.kreativekoala.vibercoder.tinker.monthly": "vbcoder_h3mo",
            ],
            isSubscribedProvider: { PremiumManager.shared.isPremium },
            onPurchased: { Task { await PremiumManager.shared.refresh() } },
            headline: "Come back at half price"
        )

        // Apple Search Ads attribution registration (one-shot per install).
        AttributionService.shared.trackAttribution()

        // Request permission then register for remote notifications
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
        return true
    }

    // Called when APNs assigns a device token
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("✅ Device token: \(token)")
        DeviceTokenManager.shared.deviceToken = token
        // Register with backend now (if user is already signed in) and again
        // on sign-in. The backend upserts by user_id, so repeated calls are safe.
        Task { @MainActor in
            await DeviceTokenManager.shared.registerWithBackendIfPossible()
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("❌ Remote notification registration failed: \(error)")
    }

    // Show notification even when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Notification tap → deep-link to the project that just completed.
    // The backend includes the projectId in the APNs payload's custom data;
    // we surface it via NotificationDeepLink so the Build flow can present
    // the just-built project's preview directly on next foreground.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        if let projectId = userInfo["projectId"] as? String, !projectId.isEmpty {
            Task { @MainActor in
                NotificationDeepLink.shared.pendingProjectId = projectId
            }
        }
        completionHandler()
    }
}

// Holds device token for use anywhere in the app + registers with the backend
// once both the token and a signed-in user id are available.
@MainActor
final class DeviceTokenManager {
    static let shared = DeviceTokenManager()
    var deviceToken: String?

    /// Call this whenever the token or auth state changes. No-op if either
    /// piece is missing.
    func registerWithBackendIfPossible() async {
        guard let token = deviceToken else { return }
        let uid = BuildIdentity.resolve(authManager: AuthManager.shared)
        guard !uid.isEmpty, uid != "anonymous" else { return }
        await VibeBuildAPI.shared.registerPushToken(userId: uid, token: token)
    }
}

/// Holds a project id pulled from a notification tap. The Build tab observes
/// this and presents the project preview when it becomes non-nil.
@MainActor
final class NotificationDeepLink: ObservableObject {
    static let shared = NotificationDeepLink()
    @Published var pendingProjectId: String? = nil
}
