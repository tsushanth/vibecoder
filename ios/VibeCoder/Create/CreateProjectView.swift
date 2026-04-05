import SwiftUI

struct CreateProjectView: View {
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var prompt = ""
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var showUpgradeSheet = false

    // Watch for generation errors
    @State private var showGenerationError = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)

                        Text("Create a Coding Project")
                            .font(.title)
                            .fontWeight(.bold)

                        Text("Describe what you want to learn and AI will generate example code")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 40)

                    // Usage/Subscription info
                    if subscriptionManager.currentTier == .free {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(subscriptionManager.generationsRemaining())
                                    .font(.subheadline)
                                    .fontWeight(.semibold)

                                Text("Free tier limit")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Button("Upgrade to Pro") {
                                showUpgradeSheet = true
                            }
                            .font(.caption)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    } else {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Unlimited generations")
                                .fontWeight(.semibold)
                            Spacer()
                            Text(subscriptionManager.currentTier.displayName)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.2))
                                .foregroundColor(.blue)
                                .cornerRadius(6)
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }

                    // Prompt input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("What do you want to learn?")
                            .font(.headline)

                        TextEditor(text: $prompt)
                            .frame(minHeight: 120)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )

                        Text("Be specific! Describe features, colors, and functionality.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    // Examples
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Examples:")
                            .font(.headline)

                        ForEach(examplePrompts, id: \.self) { example in
                            Button(action: { prompt = example }) {
                                HStack {
                                    Image(systemName: "lightbulb")
                                        .foregroundColor(.orange)
                                    Text(example)
                                        .font(.subheadline)
                                        .foregroundColor(.primary)
                                        .multilineTextAlignment(.leading)
                                    Spacer()
                                }
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(8)
                            }
                        }
                    }

                    // Generate button
                    Button(action: generate) {
                        HStack {
                            if generationManager.isGenerating {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Image(systemName: "sparkles")
                            }
                            Text(generationManager.isGenerating ? "Generating..." : buttonText)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canGenerate ? Color.blue : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canGenerate)

                    // Progress view
                    if generationManager.isGenerating {
                        VStack(spacing: 12) {
                            ProgressView(value: generationManager.progressPercent / 100)
                                .progressViewStyle(LinearProgressViewStyle())

                            VStack(alignment: .leading, spacing: 4) {
                                Text(generationManager.buildPhase)
                                    .font(.headline)
                                Text(generationManager.buildDetail)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)

                                if generationManager.estimatedSecondsRemaining > 0 {
                                    Text("~\(Int(generationManager.estimatedSecondsRemaining))s remaining")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }
                }
                .padding()
            }
            .navigationTitle("Create")
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
            .alert("Generation Error", isPresented: $showGenerationError) {
                Button("OK", role: .cancel) {
                    generationManager.errorMessage = nil
                }
            } message: {
                Text(generationManager.errorMessage ?? "Unknown error occurred")
            }
            .sheet(isPresented: $showUpgradeSheet, onDismiss: {
                PaywallCoordinator.shared.trackDismiss()
            }) {
                SubscriptionPlansView()
                    .environmentObject(subscriptionManager)
            }
            .onChange(of: generationManager.errorMessage) { newValue in
                if newValue != nil {
                    showGenerationError = true
                }
            }
            .fullScreenCover(isPresented: $generationManager.showPreview) {
                if let bundleDir = generationManager.bundleDir {
                    LivePreviewView(bundleDir: bundleDir, bundleBase64: generationManager.bundleBase64, projectTitle: prompt, initialPrompt: prompt)
                        .environmentObject(generationManager)
                }
            }
        }
    }

    private var buttonText: String {
        if subscriptionManager.currentTier == .free {
            return "Generate Code (Free)"
        } else {
            return "Generate Code"
        }
    }

    private var canGenerate: Bool {
        !prompt.isEmpty && !generationManager.isGenerating && subscriptionManager.canGenerate()
    }

    private func generate() {
        guard subscriptionManager.canGenerate() else {
            if subscriptionManager.currentTier == .free {
                errorMessage = "Daily limit reached. You've used all 3 free generations today. Upgrade to Pro for unlimited generations."
                showUpgradeSheet = true
            } else {
                errorMessage = "Unable to generate. Please try again."
            }
            showError = true
            return
        }

        // Record usage
        subscriptionManager.recordGeneration()

        // Start generation
        generationManager.startGeneration(prompt: prompt)
    }

    private let examplePrompts = [
        "Learn to create a todo list with dark mode and task completion",
        "Explore building a calculator with a modern gradient design",
        "Study how a weather dashboard shows temperature and conditions"
    ]
}

#Preview {
    CreateProjectView()
        .environmentObject(ProjectGenerationManager.shared)
        .environmentObject(SubscriptionManager.shared)
}
