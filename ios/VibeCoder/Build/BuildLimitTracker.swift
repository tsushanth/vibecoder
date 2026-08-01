//
//  BuildLimitTracker.swift
//  VibeCoder
//
//  Free users get a small number of personal builds per day; Tinker Pro
//  removes the cap. State is kept in UserDefaults keyed by an ISO date
//  string (local timezone) so the count resets at local midnight.
//
//  The cap exists for two reasons:
//   1) Backend cost — every build runs a real Claude CLI worker on Hetzner.
//   2) Apple reviewer experience — the daily counter must not block the
//      reviewer from completing one build; the default cap is 2, so a fresh
//      sandbox account easily completes a test.
//

import Foundation
import Combine

@MainActor
final class BuildLimitTracker: ObservableObject {

    static let shared = BuildLimitTracker()

    /// Maximum builds per local day for free users. Pro is unlimited.
    static let freeDailyCap = 2

    @Published private(set) var todayCount: Int = 0

    private let defaults = UserDefaults.standard
    private enum Keys {
        static let date = "vb_build_limit_date"
        static let count = "vb_build_limit_count"
    }

    private init() {
        refreshFromDisk()
    }

    // MARK: - Public API

    /// True when the user may start a new build right now. Premium users
    /// always pass; free users pass while they're under the daily cap.
    var canStartBuild: Bool {
        if PremiumManager.shared.isPremium { return true }
        return todayCount < Self.freeDailyCap
    }

    /// Remaining free builds today. Nil for Pro (unlimited).
    var remainingToday: Int? {
        if PremiumManager.shared.isPremium { return nil }
        return max(0, Self.freeDailyCap - todayCount)
    }

    /// Record that a build was successfully kicked off. Free users only;
    /// Pro users' counts are tracked but never enforced.
    func recordBuildStarted() {
        rolloverIfNeeded()
        todayCount += 1
        defaults.set(todayCount, forKey: Keys.count)
        defaults.set(Self.todayKey, forKey: Keys.date)
    }

    /// Re-read state from disk (e.g., after the app comes back from background
    /// across a midnight boundary).
    func refreshFromDisk() {
        rolloverIfNeeded()
    }

    // MARK: - Internal

    private func rolloverIfNeeded() {
        let stored = defaults.string(forKey: Keys.date)
        let today = Self.todayKey
        if stored != today {
            defaults.set(today, forKey: Keys.date)
            defaults.set(0, forKey: Keys.count)
            todayCount = 0
        } else {
            todayCount = defaults.integer(forKey: Keys.count)
        }
    }

    private static var todayKey: String {
        // Local-day key so the cap resets at midnight in the user's timezone.
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.string(from: Date())
    }
}
