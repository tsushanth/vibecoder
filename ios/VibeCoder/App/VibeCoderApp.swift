import SwiftUI
import UserNotifications
import FirebaseCore
import GoogleSignIn
import RatingKit

@main
struct VibeCoderApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var authManager = AuthManager.shared
    @StateObject private var subscriptionManager = SubscriptionManager.shared
    @StateObject private var paywallCoordinator = PaywallCoordinator.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ratingPrompt()
                .environmentObject(authManager)
                .environmentObject(subscriptionManager)
                .sheet(isPresented: $paywallCoordinator.showWinbackOffer) {
                    WinbackOfferView()
                        .environmentObject(subscriptionManager)
                }
                .onChange(of: scenePhase) { newPhase in
                    if newPhase == .active {
                        paywallCoordinator.checkWinbackEligibility()
                    }
                }
        }
    }
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
        // Push token registration to backend was removed in v2.0 — the new
        // educational shell has no live feed and does not send push notifs.
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

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

// Holds device token for use anywhere in the app
class DeviceTokenManager {
    static let shared = DeviceTokenManager()
    var deviceToken: String?
}
