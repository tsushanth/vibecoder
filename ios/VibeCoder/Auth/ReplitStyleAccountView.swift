import SwiftUI

struct ReplitStyleAccountView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showSubscriptionSheet = false
    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Profile header
                    VStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(Color(white: 0.2))
                                .frame(width: 80, height: 80)
                            Text(initials)
                                .font(.system(size: 32, weight: .medium))
                                .foregroundColor(.white)
                        }

                        Text(authManager.displayName ?? "VibeBuild User")
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(.white)

                        if let email = authManager.email {
                            Text(email)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                    .padding(.top, 20)

                    // Join Pro button (if free tier)
                    if subscriptionManager.currentTier == .free {
                        Button(action: { showSubscriptionSheet = true }) {
                            HStack {
                                Image(systemName: "star.fill")
                                Text("Join VibeBuild Pro")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .padding(.horizontal)
                    } else {
                        HStack {
                            Image(systemName: "star.fill")
                                .foregroundColor(.yellow)
                            Text("VibeBuild Pro")
                                .fontWeight(.semibold)
                                .foregroundColor(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color(white: 0.15))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }

                    Divider()
                        .background(Color.white.opacity(0.1))
                        .padding(.horizontal)

                    // Legal section
                    Text("LEGAL")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.white.opacity(0.5))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)

                    if let privacyURL = URL(string: "https://kreativekoala.llc/privacy") {
                        Link(destination: privacyURL) {
                            SettingsRow(icon: "hand.raised.fill", title: "Privacy Policy", isExternal: true)
                        }
                    }

                    if let termsURL = URL(string: "https://kreativekoala.llc/terms") {
                        Link(destination: termsURL) {
                            SettingsRow(icon: "doc.text.fill", title: "Terms of Service", isExternal: true)
                        }
                    }

                    Divider()
                        .background(Color.white.opacity(0.1))
                        .padding(.horizontal)

                    // Sign out
                    Button(action: { showSignOutConfirm = true }) {
                        SettingsRow(icon: "rectangle.portrait.and.arrow.right", title: "Sign Out", iconColor: .red)
                    }

                    Spacer().frame(height: 40)
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationBarHidden(true)
        }
        .sheet(isPresented: $showSubscriptionSheet) {
            SubscriptionPlansView()
                .environmentObject(subscriptionManager)
        }
        .confirmationDialog("Sign Out", isPresented: $showSignOutConfirm) {
            Button("Sign Out", role: .destructive) {
                authManager.signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }

    private var initials: String {
        let name = authManager.displayName ?? "VC"
        let components = name.components(separatedBy: " ")
        if components.count >= 2 {
            return (String(components[0].prefix(1)) + String(components[1].prefix(1))).uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }
}

struct SettingsRow: View {
    let icon: String
    let title: String
    var iconColor: Color = .white.opacity(0.7)
    var showChevron: Bool = false
    var isExternal: Bool = false

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .foregroundColor(iconColor)
                .frame(width: 24)
            Text(title)
                .foregroundColor(.white)
            Spacer()
            if isExternal {
                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.4))
            } else if showChevron {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .padding()
        .background(Color.clear)
    }
}

#Preview {
    ReplitStyleAccountView()
        .environmentObject(AuthManager.shared)
        .environmentObject(SubscriptionManager.shared)
}
