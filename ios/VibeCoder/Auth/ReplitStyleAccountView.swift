//
//  ReplitStyleAccountView.swift
//  VibeCoder
//
//  Account / Settings tab. Sign-in is optional. Surface: subscription
//  status + manage, sign-in/out, privacy + terms links, app version.
//  Stripped of all live-feed / favorites / history features since those
//  were tied to the now-removed user-generated content browser.
//

import SwiftUI

struct ReplitStyleAccountView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showSignInSheet = false
    @State private var showSubscriptionSheet = false
    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    profileHeader
                    subscriptionCard
                    aboutSection
                    legalSection
                    if authManager.isAuthenticated {
                        Button("Sign Out") { showSignOutConfirm = true }
                            .foregroundStyle(.red)
                            .padding(.top, 8)
                    }
                    Spacer(minLength: 60)
                }
                .padding()
            }
            .background(Color.black.ignoresSafeArea())
            .preferredColorScheme(.dark)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showSignInSheet) {
            SignInView()
                .environmentObject(authManager)
        }
        .sheet(isPresented: $showSubscriptionSheet) {
            SubscriptionPlansView()
                .environmentObject(subscriptionManager)
        }
        .alert("Sign Out?", isPresented: $showSignOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                authManager.signOut()
            }
        } message: {
            Text("You can keep using all lessons offline without signing in.")
        }
    }

    // MARK: - Sections

    private var profileHeader: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Color.white.opacity(0.12)).frame(width: 80, height: 80)
                Image(systemName: "person.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.white.opacity(0.6))
            }
            if authManager.isAuthenticated {
                Text(authManager.displayName ?? "VibeBuild User")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                if let email = authManager.email {
                    Text(email)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.55))
                }
            } else {
                Text("Browsing as guest")
                    .font(.title3)
                    .foregroundStyle(.white)
                Button { showSignInSheet = true } label: {
                    Text("Sign in (optional)")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 9)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                }
                .padding(.top, 4)
            }
        }
        .padding(.top, 12)
    }

    private var subscriptionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(subscriptionManager.isSubscribed ? "VibeBuild Pro" : "Free")
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                if subscriptionManager.isSubscribed {
                    Text("ACTIVE")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Color.green.opacity(0.7)))
                        .foregroundStyle(.white)
                }
            }
            Text(subscriptionManager.isSubscribed
                 ? "Thanks for supporting VibeBuild. You have access to every lesson."
                 : "Unlock all lessons across Beginner, Intermediate, and Advanced tiers.")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
            if !subscriptionManager.isSubscribed {
                Button { showSubscriptionSheet = true } label: {
                    Text("View Plans")
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                        .foregroundStyle(.black)
                }
                .padding(.top, 4)
            } else {
                Button("Manage Subscription") {
                    if let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                        UIApplication.shared.open(url)
                    }
                }
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.5))
            Text("VibeBuild is an educational app that ships with a curated catalog of 30 AI-generated web apps. Read the source code, edit local copies, and run previews in a sandboxed WebView with no network access.")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private var legalSection: some View {
        VStack(spacing: 0) {
            linkRow("Terms of Use (EULA)",
                    url: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")
            Divider().background(Color.white.opacity(0.08))
            linkRow("Privacy Policy",
                    url: "https://kreativekoala.llc/privacy")
            Divider().background(Color.white.opacity(0.08))
            HStack {
                Text("Version")
                    .foregroundStyle(.white.opacity(0.7))
                Spacer()
                Text(appVersion)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private func linkRow(_ title: String, url: String) -> some View {
        Button {
            if let u = URL(string: url) { UIApplication.shared.open(u) }
        } label: {
            HStack {
                Text(title)
                    .foregroundStyle(.white)
                Spacer()
                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(v) (\(b))"
    }
}
