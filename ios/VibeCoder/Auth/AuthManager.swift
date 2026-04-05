//
//  AuthManager.swift
//  VibeCoder
//
//  Supabase authentication with Apple Sign In
//

import Foundation
import UIKit
import AuthenticationServices
import CryptoKit

class AuthManager: ObservableObject {
    static let shared = AuthManager()

    private let supabaseURL = "https://owvvrljdfnhntwedepkl.supabase.co"
    private let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93dnZybGpkZm5obnR3ZWRlcGtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMDA1NTEsImV4cCI6MjA4Njc3NjU1MX0.WjjwtJn03_5Ayd2Ed9WlQ-lIWiZiTrlfnCl-7nYCoGk"

    @Published var isAuthenticated = false
    @Published var userId: String?
    @Published var displayName: String?
    @Published var email: String?
    @Published var errorMessage: String?

    private var currentNonce: String?
    private var session: SupabaseSession?

    private init() {
        // Check for existing session
        checkSession()
    }

    private func checkSession() {
        // Load session from UserDefaults if exists
        if let sessionData = UserDefaults.standard.data(forKey: "supabase_session"),
           let session = try? JSONDecoder().decode(SupabaseSession.self, from: sessionData) {
            self.session = session
            self.isAuthenticated = true
            self.userId = session.user.id
            self.email = session.user.email
            self.displayName = session.user.userMetadata?["full_name"] as? String
        } else if UserDefaults.standard.bool(forKey: "isGuestUser") {
            // Restore guest session
            self.userId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
            self.displayName = "Guest"
            self.isAuthenticated = true
        }
    }

    // MARK: - Guest Mode

    func continueAsGuest() {
        let guestId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        DispatchQueue.main.async {
            self.userId = guestId
            self.displayName = "Guest"
            self.isAuthenticated = true
        }
        UserDefaults.standard.set(true, forKey: "isGuestUser")
    }

    var isGuest: Bool {
        UserDefaults.standard.bool(forKey: "isGuestUser")
    }

    // MARK: - Sign In with Apple

    func signInWithApple() async throws {
        let nonce = generateNonce()
        currentNonce = nonce

        let credential = try await performAppleSignIn(nonce: nonce)

        // Exchange Apple credential for Supabase session
        try await signInWithIdToken(
            provider: "apple",
            idToken: credential.idToken,
            nonce: nonce
        )
    }

    private func performAppleSignIn(nonce: String) async throws -> AppleIDCredential {
        return try await withCheckedThrowingContinuation { continuation in
            let appleIDProvider = ASAuthorizationAppleIDProvider()
            let request = appleIDProvider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = sha256(nonce)

            let authorizationController = ASAuthorizationController(authorizationRequests: [request])
            let delegate = AppleSignInDelegate { result in
                switch result {
                case .success(let authorization):
                    guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let appleIDToken = appleIDCredential.identityToken,
                          let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
                        continuation.resume(throwing: NSError(domain: "AuthManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid Apple credentials"]))
                        return
                    }

                    let fullName: String? = {
                        if let givenName = appleIDCredential.fullName?.givenName,
                           let familyName = appleIDCredential.fullName?.familyName {
                            return "\(givenName) \(familyName)"
                        }
                        return nil
                    }()

                    continuation.resume(returning: AppleIDCredential(
                        idToken: idTokenString,
                        email: appleIDCredential.email,
                        fullName: fullName
                    ))

                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }

            authorizationController.delegate = delegate
            authorizationController.performRequests()

            // Keep delegate alive
            objc_setAssociatedObject(authorizationController, "delegate", delegate, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    // Public method for use with SignInWithAppleButton
    func signInWithIdToken(idToken: String, fullName: String? = nil) async throws {
        // When called from SignInWithAppleButton, nonce was already set via prepareNonce()
        guard let nonce = currentNonce else {
            throw NSError(domain: "AuthManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing nonce"])
        }
        try await signInWithIdToken(provider: "apple", idToken: idToken, nonce: nonce)
    }

    /// Generate and store a nonce, returning its SHA256 hash for Apple's request
    func prepareNonce() -> String {
        let nonce = generateNonce()
        currentNonce = nonce
        return sha256(nonce)
    }

    private func signInWithIdToken(provider: String, idToken: String, nonce: String) async throws {
        guard let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=id_token") else {
            throw NSError(domain: "AuthManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid auth URL"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        let body: [String: Any] = [
            "provider": provider,
            "id_token": idToken,
            "nonce": nonce
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "AuthManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "AuthManager", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: errorMessage])
        }

        let session = try JSONDecoder().decode(SupabaseSession.self, from: data)

        // Save session
        let sessionData = try JSONEncoder().encode(session)
        UserDefaults.standard.set(sessionData, forKey: "supabase_session")

        DispatchQueue.main.async {
            self.session = session
            self.isAuthenticated = true
            self.userId = session.user.id
            self.email = session.user.email
            self.displayName = session.user.userMetadata?["full_name"] as? String
            // Register push token with backend if available
            if let token = DeviceTokenManager.shared.deviceToken {
                Task { await NetworkManager.shared.registerPushToken(userId: session.user.id, token: token) }
            }
        }
    }

    // MARK: - Sign Out

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "supabase_session")
        UserDefaults.standard.removeObject(forKey: "isGuestUser")

        DispatchQueue.main.async {
            self.session = nil
            self.userId = nil
            self.displayName = nil
            self.email = nil
            self.isAuthenticated = false
            self.errorMessage = nil
        }
    }

    // MARK: - Delete Account

    func deleteAccount() async throws {
        guard let userId = userId else {
            throw NSError(domain: "AuthManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "No user ID"])
        }

        try await NetworkManager.shared.deleteAccount(userId: userId)
        signOut()
    }

    // MARK: - Helper Methods

    private func generateNonce(length: Int = 32) -> String {
        precondition(length > 0)
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            let randoms: [UInt8] = (0..<16).map { _ in
                var random: UInt8 = 0
                let errorCode = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
                if errorCode != errSecSuccess {
                    random = UInt8.random(in: 0...255)
                }
                return random
            }

            randoms.forEach { random in
                if remainingLength == 0 {
                    return
                }

                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Models

struct AppleIDCredential {
    let idToken: String
    let email: String?
    let fullName: String?
}

struct SupabaseSession: Codable {
    let accessToken: String
    let refreshToken: String
    let user: SupabaseUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user
    }
}

struct SupabaseUser: Codable {
    let id: String
    let email: String?
    let userMetadata: [String: Any]?

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case userMetadata = "user_metadata"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decodeIfPresent(String.self, forKey: .email)

        if let metadata = try? container.decode([String: AnyCodable].self, forKey: .userMetadata) {
            userMetadata = metadata.mapValues { $0.value }
        } else {
            userMetadata = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(email, forKey: .email)

        if let metadata = userMetadata {
            let codableMetadata = metadata.mapValues { AnyCodable($0) }
            try container.encode(codableMetadata, forKey: .userMetadata)
        }
    }
}

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else {
            value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        }
    }
}

// MARK: - Apple Sign In Delegate

class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate {
    private let completion: (Result<ASAuthorization, Error>) -> Void

    init(completion: @escaping (Result<ASAuthorization, Error>) -> Void) {
        self.completion = completion
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        completion(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        completion(.failure(error))
    }
}
