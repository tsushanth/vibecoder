import SwiftUI

private let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
private let privacyURL = URL(string: "https://kreativekoala.llc/privacy")!

struct SubscriptionPlansView: View {
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showError = false
    @State private var errorMessage = ""
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerView

                    // Render based on explicit load state — never spin indefinitely.
                    switch subscriptionManager.productLoadState {
                    case .idle, .loading:
                        VStack(spacing: 12) {
                            ProgressView()
                            Text("Loading plans…")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    case .loaded:
                        plansListView
                    case .empty:
                        productLoadFailureView(
                            title: "Plans Unavailable",
                            message: "We couldn't load subscription plans right now. Please check your connection and try again."
                        )
                    case .failed(let msg):
                        productLoadFailureView(
                            title: "Couldn't Load Plans",
                            message: msg
                        )
                    }

                    // Restore button
                    restoreButton

                    // Legal links — required by App Store guideline 3.1.2(c)
                    legalLinksView

                    // Debug buttons (development only)
                    #if DEBUG
                    debugButtonsView
                    #endif
                }
                .padding()
            }
            .navigationTitle("Subscription Plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
            .task {
                // Retry whenever this view opens unless we've already loaded successfully.
                // Previously gated on isEmpty alone, which let .failed states sit forever.
                if subscriptionManager.productLoadState != .loaded {
                    await subscriptionManager.loadProducts()
                }
            }
        }
    }

    private func productLoadFailureView(title: String, message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundColor(.orange)
            Text(title).font(.headline).foregroundColor(.white)
            Text(message)
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.7))
                .multilineTextAlignment(.center)
            Button {
                Task { await subscriptionManager.loadProducts() }
            } label: {
                Text("Try Again")
                    .font(.subheadline.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 12)
                    .background(Color.purple)
                    .cornerRadius(10)
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    private var legalLinksView: some View {
        VStack(spacing: 8) {
            Text("Subscription auto-renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in your Apple ID settings.")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                Link("Terms of Use", destination: termsURL)
                    .font(.caption)
                    .foregroundColor(.blue)
                Text("·")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Link("Privacy Policy", destination: privacyURL)
                    .font(.caption)
                    .foregroundColor(.blue)
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private var headerView: some View {
        VStack(spacing: 12) {
            Text("Choose Your Plan")
                .font(.title2)
                .fontWeight(.bold)

            Text("Discover the best community projects — go Pro for unlimited favorites, history, and early access")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var plansListView: some View {
        VStack(spacing: 16) {
            ForEach(SubscriptionPlan.plans) { plan in
                PlanCard(plan: plan)
            }
        }
    }

    private var restoreButton: some View {
        Button(action: restorePurchases) {
            Text("Restore Purchases")
                .font(.subheadline)
                .foregroundColor(.blue)
        }
        .padding()
    }

    private func restorePurchases() {
        Task {
            await subscriptionManager.restorePurchases()
        }
    }

    #if DEBUG
    private var debugButtonsView: some View {
        VStack(spacing: 12) {
            Text("🧪 Debug Mode")
                .font(.caption)
                .foregroundColor(.orange)

            HStack(spacing: 12) {
                Button(action: {
                    subscriptionManager.debugUpgradeToPro()
                    dismiss()
                }) {
                    Text("Test: Upgrade to Pro")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }

                Button(action: {
                    subscriptionManager.debugDowngradeToFree()
                    dismiss()
                }) {
                    Text("Test: Back to Free")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                }
            }

            Text("Note: Real subscriptions require StoreKit configuration")
                .font(.caption2)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .cornerRadius(12)
    }
    #endif
}

struct PlanCard: View {
    let plan: SubscriptionPlan
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            planHeader

            // Features
            featuresView

            // Action button
            actionButton
        }
        .padding()
        .background(backgroundColor)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(borderColor, lineWidth: isCurrentPlan ? 2 : 1)
        )
    }

    private var planHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(plan.name)
                    .font(.title3)
                    .fontWeight(.bold)

                if plan.isPopular {
                    Text("Popular")
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.orange)
                        .foregroundColor(.white)
                        .cornerRadius(6)
                }

                Spacer()

                if isCurrentPlan {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                }
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(plan.price)
                    .font(.title)
                    .fontWeight(.bold)
                Text(plan.billingPeriod)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var featuresView: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(plan.features, id: \.self) { feature in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.caption)
                    Text(feature)
                        .font(.subheadline)
                        .foregroundColor(.primary)
                    Spacer()
                }
            }
        }
    }

    private var actionButton: some View {
        Button(action: purchase) {
            HStack {
                if isPurchasing {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Text(buttonText)
                        .fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(buttonBackgroundColor)
            .foregroundColor(.white)
            .cornerRadius(12)
        }
        // Note: deliberately do NOT disable based on `availableProducts.isEmpty`.
        // If the StoreKit fetch is slow or returned empty (e.g. the reviewer's
        // iPad on first run before products propagate), the button still has
        // to be tappable — `purchase()` retries `loadProducts()` and surfaces
        // an error toast if it still can't find the product. A disabled
        // button that gives no feedback is what got us rejected on 2.1(b).
        .disabled(isCurrentPlan || isPurchasing)
        .alert("Purchase Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    private var isCurrentPlan: Bool {
        subscriptionManager.currentTier.rawValue == plan.tier.rawValue &&
        subscriptionManager.currentTier != .free
    }

    private var backgroundColor: Color {
        plan.isPopular ? Color.blue.opacity(0.05) : Color(.systemGray6)
    }

    private var borderColor: Color {
        if isCurrentPlan {
            return .green
        } else if plan.isPopular {
            return .blue
        }
        return Color(.systemGray4)
    }

    private var buttonText: String {
        if isCurrentPlan {
            return "Current Plan"
        } else if plan.tier == .free {
            return "Free"
        } else {
            return "Subscribe Now"
        }
    }

    private var buttonBackgroundColor: Color {
        if isCurrentPlan {
            return Color.gray
        } else if plan.isPopular {
            return Color.blue
        }
        return Color.blue.opacity(0.8)
    }

    private func purchase() {
        guard !plan.productId.isEmpty else { return }

        isPurchasing = true

        Task {
            do {
                guard let product = subscriptionManager.availableProducts.first(where: { $0.id == plan.productId }) else {
                    // Products not yet loaded — try loading first then retry
                    await subscriptionManager.loadProducts()
                    guard let retried = subscriptionManager.availableProducts.first(where: { $0.id == plan.productId }) else {
                        await MainActor.run {
                            errorMessage = "Unable to load this product. Please check your internet connection and try again."
                            showError = true
                            isPurchasing = false
                        }
                        return
                    }
                    try await subscriptionManager.purchase(retried)
                    await MainActor.run { isPurchasing = false }
                    return
                }
                try await subscriptionManager.purchase(product)
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
            await MainActor.run { isPurchasing = false }
        }
    }
}

#Preview {
    SubscriptionPlansView()
        .environmentObject(SubscriptionManager.shared)
}

// MARK: - Adaptive paywall presenter (iPad fullScreenCover, iPhone sheet)

/// Apple reviewed 1.1 (29) on iPad Air 11-inch and saw the paywall as a tiny form-sheet floating in a
/// mostly-empty dark screen — SwiftUI's default `.sheet` on iPad is a fixed ~540×620 form sheet. Using
/// `.fullScreenCover` on iPad gives the paywall the full canvas; iPhone keeps the standard sheet behavior.
struct AdaptivePaywallSheet<SheetContent: View>: ViewModifier {
    @Binding var isPresented: Bool
    var onDismiss: (() -> Void)?
    let sheetContent: () -> SheetContent

    func body(content: Content) -> some View {
        if UIDevice.current.userInterfaceIdiom == .pad {
            content.fullScreenCover(isPresented: $isPresented, onDismiss: onDismiss) {
                sheetContent()
            }
        } else {
            content.sheet(isPresented: $isPresented, onDismiss: onDismiss) {
                sheetContent()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
        }
    }
}

extension View {
    /// Present the paywall with the right modal style per device class.
    func adaptivePaywallSheet<SheetContent: View>(
        isPresented: Binding<Bool>,
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> SheetContent
    ) -> some View {
        modifier(AdaptivePaywallSheet(isPresented: isPresented, onDismiss: onDismiss, sheetContent: content))
    }
}
