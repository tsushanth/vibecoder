//
//  PremiumManager.swift
//  VibeCoder
//
//  Single source of truth for "is this user on the Pro plan." Wraps
//  PaywallKit's StoreManager so the rest of the app can ask one yes/no
//  question without knowing about StoreKit transactions, expiry windows,
//  receipt parsing, or PaywallKit internals.
//

import Foundation
import Combine
import PaywallKit

@MainActor
final class PremiumManager: ObservableObject {
    static let shared = PremiumManager()

    @Published private(set) var isPremium: Bool = false

    private var cancellables: Set<AnyCancellable> = []

    /// Debug-only override key. When this UserDefaults bool is true (default
    /// in DEBUG builds), isPremium reports true regardless of StoreKit state.
    /// Flip to false in lldb with:
    ///   expr UserDefaults.standard.set(false, forKey: "debugForcePremium")
    /// to test the real paywall flow.
    private static let debugForcePremiumKey = "debugForcePremium"

    private init() {
        #if DEBUG
        // First run in a Debug build, default the flag to true so the developer
        // isn't blocked by paywall loops while testing other features.
        // Existing value (true or false) is respected after first set.
        if UserDefaults.standard.object(forKey: Self.debugForcePremiumKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.debugForcePremiumKey)
        }
        #endif

        // StoreManager.isPremium already covers active subscription, lifetime
        // unlock, free trial, and grace period — all the cases where the
        // user should see Pro features. We just re-publish it so the rest
        // of the app can observe a single VibeBuild-owned object.
        StoreManager.shared.$isPremium
            .receive(on: DispatchQueue.main)
            .sink { [weak self] active in
                guard let self else { return }
                #if DEBUG
                let forced = UserDefaults.standard.bool(forKey: Self.debugForcePremiumKey)
                self.isPremium = active || forced
                if forced && !active {
                    print("[PremiumManager] DEBUG override active — isPremium forced to true")
                }
                #else
                self.isPremium = active
                #endif
            }
            .store(in: &cancellables)

        // Apply the initial value immediately in case the StoreManager.$isPremium
        // sink hasn't fired yet (StoreKit refresh is async; the gated views may
        // read `isPremium` before the first emission).
        #if DEBUG
        if UserDefaults.standard.bool(forKey: Self.debugForcePremiumKey) {
            self.isPremium = true
        }
        #endif
    }

    func refresh() async {
        await StoreManager.shared.refreshSubscriptionStatus()
        #if DEBUG
        // Reassert override after server refresh in case the sink cleared it.
        if UserDefaults.standard.bool(forKey: Self.debugForcePremiumKey) {
            self.isPremium = true
        }
        #endif
    }
}
