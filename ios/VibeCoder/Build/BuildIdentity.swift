//
//  BuildIdentity.swift
//  VibeCoder
//
//  Stable user identifier for the Build feature. The shared AuthManager
//  returns nil for `userId` after sign-out, but Build always needs a
//  non-empty id so /api/auth/register + /api/projects/generate succeed and
//  My Projects can scope to a single owner.
//
//  Rules:
//   - If AuthManager has a signed-in user id, use that.
//   - Otherwise, use a UUID persisted under `vb_anonymous_user_id` in
//     UserDefaults. Generated lazily on first access; survives sign-out
//     and reinstalls aren't relevant (they wipe UserDefaults too).
//

import Foundation
import UIKit

@MainActor
enum BuildIdentity {
    private static let key = "vb_anonymous_user_id"

    /// Always non-empty. Prefers signed-in id; falls back to a persisted
    /// anonymous UUID so the feature works while signed out.
    static func resolve(authManager: AuthManager) -> String {
        if let id = authManager.userId, !id.isEmpty {
            return id
        }
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
            return existing
        }
        let newId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        UserDefaults.standard.set(newId, forKey: key)
        return newId
    }

    /// Best-effort display name for /api/auth/register. The anonymous
    /// fallback is intentionally bland so it doesn't leak device info.
    static func displayName(authManager: AuthManager) -> String {
        authManager.displayName ?? "VibeBuild User"
    }
}
