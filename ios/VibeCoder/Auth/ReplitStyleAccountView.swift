//
//  ReplitStyleAccountView.swift
//  VibeCoder
//
//  Account tab. Sign-in is optional. There is no paid tier — every lesson
//  in the catalog is free. Surface: sign-in/out, privacy + terms links,
//  app version.
//

import SwiftUI

struct ReplitStyleAccountView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var showSignInSheet = false
    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    profileHeader
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
