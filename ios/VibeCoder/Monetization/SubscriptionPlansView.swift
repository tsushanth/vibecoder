import SwiftUI

struct SubscriptionPlansView: View {
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showError = false
    @State private var errorMessage = ""
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerView

                    // Plans
                    plansListView

                    // Restore button
                    restoreButton

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
        }
    }

    private var headerView: some View {
        VStack(spacing: 12) {
            Text("Choose Your Plan")
                .font(.title2)
                .fontWeight(.bold)

            Text("Unlock unlimited generations and premium features")
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
        .disabled(isCurrentPlan || isPurchasing)
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
                if let product = subscriptionManager.availableProducts.first(where: { $0.id == plan.productId }) {
                    try await subscriptionManager.purchase(product)
                }
            } catch {
                print("Purchase failed: \(error)")
            }
            isPurchasing = false
        }
    }
}

#Preview {
    SubscriptionPlansView()
        .environmentObject(SubscriptionManager.shared)
}
