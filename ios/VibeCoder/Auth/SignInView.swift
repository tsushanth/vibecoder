//
//  SignInView.swift
//  VibeCoder
//

import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @ObservedObject var authManager = AuthManager.shared
    @State private var showEmailForm = false
    @State private var isSigningIn = false
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        GeometryReader { geometry in
            ZStack {
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
                        Spacer().frame(height: geometry.size.height * 0.12)

                        // Logo
                        VStack(spacing: 16) {
                            Image(systemName: "command.circle.fill")
                                .font(.system(size: 80))
                                .foregroundColor(.purple)
                                .shadow(color: .purple.opacity(0.5), radius: 20)

                            Text("VibeBuild")
                                .font(.system(size: 42, weight: .bold, design: .rounded))
                                .foregroundColor(.white)

                            Text("Discover websites from creators around the world.")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(.white.opacity(0.7))
                        }
                        .padding(.bottom, 32)

                        // Sign-in buttons
                        VStack(spacing: 12) {
                            // Apple
                            SignInWithAppleButton(
                                onRequest: { request in
                                    request.requestedScopes = [.fullName, .email]
                                    request.nonce = authManager.prepareNonce()
                                },
                                onCompletion: { result in
                                    handleAppleSignIn(result: result)
                                }
                            )
                            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                            .frame(height: 56)
                            .cornerRadius(12)
                            .disabled(isSigningIn)

                            // Google
                            Button(action: handleGoogleSignIn) {
                                HStack(spacing: 10) {
                                    Image(systemName: "g.circle.fill")
                                        .font(.system(size: 20))
                                        .foregroundColor(.white)
                                    Text("Sign in with Google")
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundColor(.white)
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                                .background(Color(red: 0.26, green: 0.52, blue: 0.96))
                                .cornerRadius(12)
                            }
                            .disabled(isSigningIn)

                            // Email
                            Button(action: { showEmailForm = true }) {
                                HStack(spacing: 10) {
                                    Image(systemName: "envelope.fill")
                                        .font(.system(size: 18))
                                        .foregroundColor(.white)
                                    Text("Continue with Email")
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundColor(.white)
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                                .background(Color.white.opacity(0.15))
                                .cornerRadius(12)
                            }
                            .disabled(isSigningIn)
                        }
                        .padding(.horizontal, 32)

                        // Demo / Guest — prominent so users (and App Review) can always enter the app
                        Button { authManager.continueAsGuest() } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "play.circle.fill")
                                    .font(.system(size: 18))
                                    .foregroundColor(.white)
                                Text("Try Demo (No Account Needed)")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundColor(.white)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.green.opacity(0.7))
                            .cornerRadius(12)
                        }
                        .padding(.horizontal, 32)

                        // Feature rows
                        VStack(spacing: 20) {
                            featureRow(icon: "safari", title: "Open in Safari",
                                       description: "Tap any project to view it running in your browser")
                            featureRow(icon: "rectangle.stack", title: "Curated Gallery",
                                       description: "Browse a continuously updated feed of public websites")
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 32)

                        Spacer().frame(height: 40)
                    }
                }

                if isSigningIn {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    VStack(spacing: 16) {
                        ProgressView().scaleEffect(1.5).tint(.white)
                        Text("Signing in...")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.white)
                    }
                    .padding(32)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color(white: 0.2)))
                }
            }
        }
        .sheet(isPresented: $showEmailForm) {
            EmailSignInView(isSigningIn: $isSigningIn)
        }
        .alert("Sign In Error", isPresented: .init(
            get: { authManager.errorMessage != nil },
            set: { if !$0 { authManager.errorMessage = nil } }
        )) {
            Button("OK") { authManager.errorMessage = nil }
        } message: {
            Text(authManager.errorMessage ?? "")
        }
    }

    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(Color.purple.opacity(0.2)).frame(width: 48, height: 48)
                Image(systemName: icon).font(.title3).foregroundColor(.purple)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                Text(description).font(.system(size: 14)).foregroundColor(.white.opacity(0.7))
            }
            Spacer()
        }
        .padding(.vertical, 8)
    }

    private func handleAppleSignIn(result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let appleIDToken = appleIDCredential.identityToken,
                  let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
                authManager.errorMessage = "Invalid Apple credentials"
                return
            }
            let fullName: String? = {
                if let given = appleIDCredential.fullName?.givenName,
                   let family = appleIDCredential.fullName?.familyName {
                    return "\(given) \(family)"
                }
                return nil
            }()
            isSigningIn = true
            Task {
                do {
                    try await authManager.signInWithIdToken(idToken: idTokenString, fullName: fullName)
                } catch {
                    await MainActor.run { authManager.errorMessage = error.localizedDescription }
                }
                await MainActor.run { isSigningIn = false }
            }
        case .failure(let error):
            authManager.errorMessage = error.localizedDescription
        }
    }

    private func handleGoogleSignIn() {
        isSigningIn = true
        Task {
            do {
                try await authManager.signInWithGoogle()
            } catch {
                await MainActor.run { authManager.errorMessage = error.localizedDescription }
            }
            await MainActor.run { isSigningIn = false }
        }
    }
}

// MARK: - Email Sign In Sheet

struct EmailSignInView: View {
    @Binding var isSigningIn: Bool
    @Environment(\.dismiss) var dismiss
    @ObservedObject var authManager = AuthManager.shared

    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var isLoading = false

    var body: some View {
        NavigationView {
            ZStack {
                Color(red: 0.1, green: 0.1, blue: 0.2).ignoresSafeArea()

                VStack(spacing: 20) {
                    Picker("Mode", selection: $isSignUp) {
                        Text("Sign In").tag(false)
                        Text("Create Account").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)

                    VStack(spacing: 12) {
                        TextField("Email", text: $email)
                            .textFieldStyle(.plain)
                            .padding()
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(12)
                            .foregroundColor(.white)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .textContentType(.emailAddress)

                        SecureField("Password", text: $password)
                            .textFieldStyle(.plain)
                            .padding()
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(12)
                            .foregroundColor(.white)
                            .textContentType(isSignUp ? .newPassword : .password)
                    }
                    .padding(.horizontal)

                    Button(action: submit) {
                        Group {
                            if isLoading {
                                ProgressView().tint(.white)
                            } else {
                                Text(isSignUp ? "Create Account" : "Sign In")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundColor(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple)
                        .cornerRadius(12)
                    }
                    .disabled(isLoading || email.isEmpty || password.isEmpty)
                    .padding(.horizontal)

                    Spacer()
                }
                .padding(.top, 24)
            }
            .navigationTitle(isSignUp ? "Create Account" : "Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.white)
                }
            }
            .alert("Error", isPresented: .init(
                get: { authManager.errorMessage != nil },
                set: { if !$0 { authManager.errorMessage = nil } }
            )) {
                Button("OK") { authManager.errorMessage = nil }
            } message: {
                Text(authManager.errorMessage ?? "")
            }
        }
        .preferredColorScheme(.dark)
    }

    private func submit() {
        isLoading = true
        Task {
            do {
                if isSignUp {
                    try await authManager.signUpWithEmail(email: email, password: password)
                } else {
                    try await authManager.signInWithEmail(email: email, password: password)
                }
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run { authManager.errorMessage = error.localizedDescription }
            }
            await MainActor.run { isLoading = false }
        }
    }
}
