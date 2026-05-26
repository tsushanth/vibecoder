import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showSignOutConfirmation = false

    var body: some View {
        NavigationView {
            List {
                Section {
                    HStack(spacing: 16) {
                        Circle()
                            .fill(LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 60, height: 60)
                            .overlay(
                                Text(initials)
                                    .font(.title2)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.white)
                            )

                        VStack(alignment: .leading, spacing: 4) {
                            Text(authManager.displayName ?? "User")
                                .font(.headline)

                            if let email = authManager.email {
                                Text(email)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }

                        Spacer()

                        SubscriptionTierBadge(tier: subscriptionManager.currentTier)
                    }
                    .padding(.vertical, 8)
                }

                Section("Subscription") {
                    HStack {
                        Label("Plan", systemImage: "star.fill")
                        Spacer()
                        Text(subscriptionManager.subscriptionStatus)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                    }

                    if subscriptionManager.currentTier == .free {
                        VStack(spacing: 12) {
                            NavigationLink(destination: SubscriptionPlansView()) {
                                HStack {
                                    Label("Upgrade to Pro", systemImage: "bolt.fill")
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    } else {
                        Button(action: { subscriptionManager.manageSubscription() }) {
                            Label("Manage Subscription", systemImage: "gearshape.fill")
                        }
                    }
                }

                Section("Settings") {
                    NavigationLink(destination: Text("Settings")) {
                        Label("Settings", systemImage: "gearshape")
                    }

                    NavigationLink(destination: Text("Help")) {
                        Label("Help & Support", systemImage: "questionmark.circle")
                    }

                    NavigationLink(destination: Text("About")) {
                        Label("About", systemImage: "info.circle")
                    }
                }

                Section {
                    Button(role: .destructive, action: { showSignOutConfirmation = true }) {
                        Label("Sign Out", systemImage: "arrow.right.square")
                    }
                }
            }
            .navigationTitle("Profile")
            .confirmationDialog("Sign Out", isPresented: $showSignOutConfirmation) {
                Button("Sign Out", role: .destructive) {
                    authManager.signOut()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to sign out?")
            }
        }
    }

    private var initials: String {
        guard let name = authManager.displayName else { return "?" }
        let components = name.components(separatedBy: " ")
        if components.count >= 2 {
            return String(components[0].prefix(1)) + String(components[1].prefix(1))
        }
        return String(name.prefix(2))
    }
}

// MARK: - Subscription Tier Badge

struct SubscriptionTierBadge: View {
    let tier: SubscriptionTier

    var body: some View {
        Text(tier.displayName)
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(badgeColor)
            .cornerRadius(8)
    }

    private var badgeColor: Color {
        switch tier {
        case .free:
            return .gray
        case .pro:
            return .blue
        case .team:
            return .purple
        case .enterprise:
            return .black
        }
    }
}

#Preview {
    ProfileView()
        .environmentObject(AuthManager.shared)
        .environmentObject(SubscriptionManager.shared)
}
