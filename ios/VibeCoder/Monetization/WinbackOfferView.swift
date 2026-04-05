import SwiftUI
import StoreKit

/// A special offer view shown to users who have dismissed the paywall multiple times.
/// Provides a compelling value proposition to win back churning users.
struct WinbackOfferView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""

    private let valueProps: [(icon: String, text: String)] = [
        ("cpu", "AI-powered app building"),
        ("infinity", "Unlimited projects"),
        ("chevron.left.forwardslash.chevron.right", "Code generation"),
        ("play.rectangle.fill", "Live preview")
    ]

    var body: some View {
        VStack(spacing: 24) {

            // Close button
            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal)

            Spacer()

            // Badge
            Text("SPECIAL OFFER")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(Color.orange)
                .clipShape(Capsule())

            // Headline
            Text("We miss you!")
                .font(.largeTitle.bold())

            Text("Come back and unlock everything VibeBuild has to offer.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            // Value props
            VStack(alignment: .leading, spacing: 16) {
                ForEach(valueProps, id: \.text) { prop in
                    HStack(spacing: 14) {
                        Image(systemName: prop.icon)
                            .font(.title3)
                            .foregroundStyle(.blue)
                            .frame(width: 28)
                        Text(prop.text)
                            .font(.body)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)

            Spacer()

            // CTA
            Button {
                Task { await startSubscription() }
            } label: {
                HStack {
                    if isPurchasing {
                        ProgressView().tint(.white)
                    } else {
                        Text(ctaText)
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(
                    LinearGradient(colors: [.blue, .purple],
                                   startPoint: .leading, endPoint: .trailing)
                )
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(isPurchasing)
            .padding(.horizontal, 24)

            // No thanks
            Button {
                dismiss()
            } label: {
                Text("No thanks")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 16)
        }
        .padding(.top)
        .preferredColorScheme(.dark)
        .alert("Error", isPresented: $showError) {
            Button("OK") {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Helpers

    private var ctaText: String {
        if let yearly = subscriptionManager.availableProducts.first(where: { $0.id.contains("yearly") }) {
            return "Subscribe - \(yearly.displayPrice)/yr"
        }
        return "Start Free Trial"
    }

    private func startSubscription() async {
        // Prefer yearly plan
        let product = subscriptionManager.availableProducts.first(where: { $0.id.contains("yearly") })
            ?? subscriptionManager.availableProducts.first(where: { $0.id.contains("monthly") })

        guard let product = product else {
            errorMessage = "Subscription not available. Please try again later."
            showError = true
            return
        }

        isPurchasing = true
        defer { isPurchasing = false }

        do {
            try await subscriptionManager.purchase(product)
            if subscriptionManager.isSubscribed {
                dismiss()
            }
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}
