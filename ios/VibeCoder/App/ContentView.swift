import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @State private var selectedTab = 1 // Start on Create tab

    var body: some View {
        Group {
            if authManager.isAuthenticated {
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
