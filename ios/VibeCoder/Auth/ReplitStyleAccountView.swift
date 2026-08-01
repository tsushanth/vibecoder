//
//  ReplitStyleAccountView.swift
//  VibeCoder
//
//  Account tab. Sign-in is optional. The catalog is fully free; Pro
//  unlocks Tinker Pro (persistent attempts, multiple scratchpads, compare
//  to original). Surface: subscription status, Upgrade / Restore,
//  sign-in/out, privacy + terms links, app version.
//

import SwiftUI
import PaywallKit

struct ReplitStyleAccountView: View {
    @EnvironmentObject var authManager: AuthManager
    @ObservedObject private var premium = PremiumManager.shared
    @State private var showSignInSheet = false
    @State private var showSignOutConfirm = false
    @State private var showDeleteConfirm = false
    @State private var showPaywall = false
    @State private var isDeleting = false
    @State private var isRestoring = false
    @State private var deleteError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    profileHeader
                    subscriptionCard
                    aboutSection
                    legalSection
                    if authManager.isAuthenticated {
                        VStack(spacing: 12) {
                            Button("Sign Out") { showSignOutConfirm = true }
                                .foregroundStyle(.red)
                            Button {
                                showDeleteConfirm = true
                            } label: {
                                if isDeleting {
                                    ProgressView().tint(.red)
                                } else {
                                    Text("Delete Account")
                                        .font(.callout.weight(.semibold))
                                        .foregroundStyle(.red)
                                }
                            }
                            .disabled(isDeleting)
                            if let err = deleteError {
                                Text(err)
                                    .font(.caption)
                                    .foregroundStyle(.red.opacity(0.8))
                                    .multilineTextAlignment(.center)
                            }
                        }
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
        .fullScreenCover(isPresented: $showPaywall) {
            RemotePaywallView(triggerSource: "account_tab")
        }
        .alert("Sign Out?", isPresented: $showSignOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign Out", role: .destructive) {
                authManager.signOut()
            }
        } message: {
            Text("You can keep using all lessons offline without signing in.")
        }
        .alert("Delete Account?", isPresented: $showDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                deleteError = nil
                isDeleting = true
                Task {
                    do {
                        try await authManager.deleteAccount()
                    } catch {
                        deleteError = error.localizedDescription
                    }
                    isDeleting = false
                }
            }
        } message: {
            Text("This permanently deletes your VibeBuild account and removes your sign-in data from our server. All lessons remain available without signing in.")
        }
    }

    private var subscriptionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(premium.isPremium ? "VibeBuild Pro" : "Free")
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                if premium.isPremium {
                    Text("ACTIVE")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Color.green.opacity(0.7)))
                        .foregroundStyle(.white)
                }
            }
            Text(premium.isPremium
                 ? "Tinker Pro is on. Edits persist, multiple attempts per lesson, compare to original."
                 : "Unlock Tinker Pro to save attempts across launches, keep multiple per lesson, and compare against the original.")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
            if !premium.isPremium {
                Button { showPaywall = true } label: {
                    Text("Upgrade to Pro")
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                        .foregroundStyle(.black)
                }
                Button {
                    isRestoring = true
                    Task {
                        await StoreManager.shared.restore()
                        await PremiumManager.shared.refresh()
                        isRestoring = false
                    }
                } label: {
                    if isRestoring {
                        ProgressView().tint(.white)
                    } else {
                        Text("Restore Purchases")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
                .disabled(isRestoring)
                .padding(.top, 4)

                Button {
                    OfferCodeManager.shared.presentRedemptionSheet()
                } label: {
                    Text("Redeem Promo Code")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.7))
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

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.5))
            Text("VibeBuild ships with a curated catalog of 30 web app examples for learning HTML, CSS, and JavaScript. Read the full source code, edit local copies, and run previews in a sandboxed WebView with no network access.")
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
