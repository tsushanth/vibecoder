//
//  RemotePaywallView.swift
//  VibeCoder
//
//  Server-driven PaywallKit paywall surface for VibeBuild Pro. The template
//  is fetched from paywallkit-api.fly.dev based on `appId + placement` so we
//  can A/B test layouts without an app update. Pricing comes from StoreKit 2
//  via PaywallKit's StoreManager.
//

import SwiftUI
import PaywallKit
import PromoOfferKit
import RatingKit

struct RemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    @ObservedObject private var store = StoreManager.shared
    @State private var isReloadingProducts = false

    var body: some View {
        // Always mount PaywallView so its @State (current screen, selected plan,
        // isPurchasing flags inside templates) survives across product reloads.
        // Conditionally rendering with `if products.isEmpty` would unmount and
        // remount the template — which silently reset 3-screen funnels back to
        // step 0 after a successful purchase.
        PaywallKit.PaywallView(
            appId: "vibebuild",
            placement: triggerSource,
            appName: "VibeBuild Pro",
            features: [
                PaywallFeature(icon: "💾",
                               title: "Save Your Tinkered Edits",
                               description: "Edits persist across app launches — your work survives."),
                PaywallFeature(icon: "📑",
                               title: "Multiple Scratchpads",
                               description: "Keep several attempts side-by-side per lesson."),
                PaywallFeature(icon: "🔍",
                               title: "Compare to Original",
                               description: "Toggle between your version and the bundled example."),
                PaywallFeature(icon: "🎓",
                               title: "Support a Solo Dev",
                               description: "Keep the catalog growing — every Pro funds new lessons."),
            ],
            products: store.paywallProducts,
            theme: PaywallTheme(
                accent: Color(red: 1.0, green: 0.59, blue: 0.0),
                accent2: Color(red: 0.9, green: 0.30, blue: 0.20)
            ),
            showWinback: true,
            onPurchase: { productId in
                print("[Paywall] onPurchase START productId=\(productId)")
                let result = await store.purchase(productId: productId)
                print("[Paywall] store.purchase returned: \(result)")
                if case .purchased = result {
                    // Suppress the lapsed-subscription promo offer that PromoOfferKit
                    // would otherwise queue from this device's prior sandbox/expired
                    // purchase. Without this, isPremium can race and OfferCodeManager
                    // fires on dismiss before the new transaction propagates.
                    PromoOfferKit.shared.dismiss()
                    await PremiumManager.shared.refresh()
                    print("[Paywall] after refresh #1 isPremium=\(PremiumManager.shared.isPremium)")

                    // Defensive: Transaction.currentEntitlements can lag behind a
                    // just-finished purchase in sandbox. Poll for up to 3s waiting
                    // for the Combine pipeline (StoreManager.$isPremium → PremiumManager)
                    // to flip true before we hand control back to the paywall.
                    var attempts = 0
                    while !PremiumManager.shared.isPremium && attempts < 6 {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        await PremiumManager.shared.refresh()
                        attempts += 1
                        print("[Paywall] poll attempt \(attempts) isPremium=\(PremiumManager.shared.isPremium)")
                    }

                    await MainActor.run {
                        RatingKit.shared.trackPurchase()
                        dismiss()
                    }
                    return true
                }
                print("[Paywall] purchase did not return .purchased — staying on paywall")
                return false
            },
            onRestore: {
                print("[Paywall] onRestore START")
                await store.restore()
                await PremiumManager.shared.refresh()
                print("[Paywall] after restore isPremium=\(PremiumManager.shared.isPremium)")
                if PremiumManager.shared.isPremium {
                    PromoOfferKit.shared.dismiss()
                    await MainActor.run { dismiss() }
                }
            },
            onDismiss: {
                dismiss()
            }
        )
        // Overlay the loading state while products are still empty. Apple
        // rejected 2.2.0 (Guideline 2.1b) because the reviewer tapped Continue
        // before StoreKit returned products and the PaywallKit templates
        // silently no-op when no product is selected. The overlay intercepts
        // taps until products arrive, so the underlying CTA can never be in
        // an unresponsive state.
        .overlay {
            if store.paywallProducts.isEmpty {
                productLoadingState
            }
        }
        .task {
            // Defensive: app startup also triggers loadProducts, but StoreKit
            // (especially in sandbox / on iPad) can return zero products on the
            // first attempt. Retry here so the paywall always has products by
            // the time the user can tap Continue.
            if store.paywallProducts.isEmpty {
                await store.loadProducts()
            }
        }
    }

    @ViewBuilder
    private var productLoadingState: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.4)
            Text("Loading subscription options…")
                .font(.system(size: 15))
                .foregroundColor(.secondary)
            if isReloadingProducts {
                Text("Still loading… check your connection.")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
            }
            Button("Cancel") { dismiss() }
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .task {
            // After 4s without products, mark "still loading" and try again.
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if store.paywallProducts.isEmpty {
                isReloadingProducts = true
                await store.loadProducts()
            }
        }
    }
}
