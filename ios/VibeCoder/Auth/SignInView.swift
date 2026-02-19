//
//  SignInView.swift
//  VibeCoder
//
//  Clean sign-in UI with Apple and Google authentication
//

import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @ObservedObject var authManager = AuthManager.shared
    @State private var showError = false
    @State private var isSigningIn = false
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background gradient
                LinearGradient(
                    gradient: Gradient(colors: [
                        Color(red: 0.1, green: 0.1, blue: 0.2),
                        Color(red: 0.15, green: 0.15, blue: 0.25)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 30) {
                        Spacer()
                            .frame(height: geometry.size.height * 0.15)

                        // App Logo/Title Section
                        VStack(spacing: 16) {
                            Image(systemName: "command.circle.fill")
                                .font(.system(size: 80))
                                .foregroundColor(.purple)
                                .shadow(color: .purple.opacity(0.5), radius: 20)

                            Text("VibeBuild")
                                .font(.system(size: 42, weight: .bold, design: .rounded))
                                .foregroundColor(.white)

                            Text("Build apps with AI")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white.opacity(0.7))
                        }
                        .padding(.bottom, 40)

                        // Sign-In Buttons
                        VStack(spacing: 16) {
                            // Apple Sign In Button
                            SignInWithAppleButton(
                                onRequest: { request in
                                    request.requestedScopes = [.fullName, .email]
                                },
                                onCompletion: { result in
                                    handleAppleSignIn(result: result)
                                }
                            )
                            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                            .frame(height: 56)
                            .cornerRadius(12)
                            .disabled(isSigningIn)
                        }
                        .padding(.horizontal, 32)

                        // Features Section
                        VStack(spacing: 20) {
                            featureRow(
                                icon: "wand.and.stars",
                                title: "AI-Powered Generation",
                                description: "Create full-stack apps with AI"
                            )

                            featureRow(
                                icon: "arrow.down.doc.fill",
                                title: "Export & Deploy",
                                description: "Download projects or deploy instantly"
                            )

                            featureRow(
                                icon: "sparkles",
                                title: "Real-time Preview",
                                description: "See your app come to life"
                            )
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 40)

                        Spacer()
                            .frame(height: 40)
                    }
                }

                // Loading Overlay
                if isSigningIn {
                    ZStack {
                        Color.black.opacity(0.4)
                            .ignoresSafeArea()

                        VStack(spacing: 16) {
                            ProgressView()
                                .scaleEffect(1.5)
                                .tint(.white)

                            Text("Signing in...")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.white)
                        }
                        .padding(32)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(white: 0.2))
                                .shadow(radius: 20)
                        )
                    }
                }
            }
        }
        .alert("Sign In Error", isPresented: $showError) {
            Button("OK") {
                showError = false
                authManager.errorMessage = nil
            }
        } message: {
            Text(authManager.errorMessage ?? "An unknown error occurred")
        }
        .onChange(of: authManager.errorMessage) { newValue in
            if newValue != nil {
                showError = true
                isSigningIn = false
            }
        }
    }

    // MARK: - Feature Row

    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.purple.opacity(0.2))
                    .frame(width: 48, height: 48)

                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.purple)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                Text(description)
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.7))
            }

            Spacer()
        }
        .padding(.vertical, 8)
    }

    // MARK: - Sign In Handlers

    private func handleAppleSignIn(result: Result<ASAuthorization, Error>) {
        isSigningIn = true

        Task {
            do {
                try await authManager.signInWithApple()
                isSigningIn = false
            } catch {
                DispatchQueue.main.async {
                    authManager.errorMessage = error.localizedDescription
                    isSigningIn = false
                }
            }
        }
    }

}

// MARK: - Preview

struct SignInView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            SignInView()
                .preferredColorScheme(.dark)

            SignInView()
                .preferredColorScheme(.light)
        }
    }
}
