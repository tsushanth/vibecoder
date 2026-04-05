import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @StateObject private var paywallCoordinator = PaywallCoordinator.shared
    @StateObject private var statusManager = SystemStatusManager.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 1 // Start on Create tab
    @AppStorage("telegram_banner_dismissed") private var telegramBannerDismissed = false

    private var isFastlaneSnapshot: Bool {
        ProcessInfo.processInfo.arguments.contains("-FASTLANE_SNAPSHOT")
    }

    var body: some View {
        Group {
            if isFastlaneSnapshot || authManager.isAuthenticated {
                VStack(spacing: 0) {
                    // Maintenance banner
                    if statusManager.isSystemDown {
                        HStack {
                            Text(statusManager.systemMessage ?? "Builds temporarily unavailable. Check back soon!")
                                .font(.caption)
                                .foregroundColor(.white)
                                .multilineTextAlignment(.leading)
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.orange)
                    }

                    // Telegram banner (dismissible)
                    if !telegramBannerDismissed && !statusManager.isSystemDown {
                        HStack {
                            Link("✨ Build apps via Telegram! @Vibebuilder_bot",
                                 destination: URL(string: "https://t.me/Vibebuilder_bot")!)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundColor(.white)
                            Spacer()
                            Button(action: { telegramBannerDismissed = true }) {
                                Image(systemName: "xmark")
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.8))
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.blue)
                    }

                TabView(selection: $selectedTab) {
                    // Projects tab
                    ReplitStyleAppsView()
                        .tabItem {
                            Label("Projects", systemImage: "folder")
                        }
                        .tag(0)
                        .onChange(of: selectedTab) { newValue in
                            generationManager.isOnCreateTab = (newValue == 1)
                        }

                    // Create tab (centered, middle position)
                    ReplitStyleCreateView()
                        .tabItem {
                            Label("Create", systemImage: "plus.rectangle.on.folder")
                        }
                        .tag(1)

                    // Account tab (Profile)
                    ReplitStyleAccountView()
                        .tabItem {
                            Label("Account", systemImage: "person")
                        }
                        .tag(2)
                }
                .preferredColorScheme(.dark)
                .fullScreenCover(isPresented: $generationManager.showPreview) {
                    if let bundleDir = generationManager.bundleDir {
                        LivePreviewView(
                            bundleDir: bundleDir,
                            bundleBase64: generationManager.bundleBase64,
                            projectTitle: generationManager.completionPrompt,
                            initialPrompt: generationManager.completionPrompt
                        )
                        .environmentObject(generationManager)
                        .environmentObject(authManager)
                    }
                }
                .onAppear {
                    // Set tab bar styling for dark theme
                    let appearance = UITabBarAppearance()
                    appearance.configureWithOpaqueBackground()
                    appearance.backgroundColor = UIColor.black

                    UITabBar.appearance().standardAppearance = appearance
                    UITabBar.appearance().scrollEdgeAppearance = appearance
                }
                .sheet(isPresented: $paywallCoordinator.showWinbackOffer) {
                    WinbackOfferView()
                        .environmentObject(SubscriptionManager.shared)
                }
                .onChange(of: scenePhase) { newPhase in
                    if newPhase == .active {
                        paywallCoordinator.checkWinbackEligibility()
                    }
                }
                } // VStack
            } else {
                SignInView()
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthManager.shared)
        .environmentObject(SubscriptionManager.shared)
        .environmentObject(ProjectGenerationManager.shared)
}
