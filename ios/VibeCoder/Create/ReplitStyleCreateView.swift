import SwiftUI
import Speech
import PhotosUI

struct PromptSuggestion: Identifiable {
    let id = UUID()
    let label: String
    let detailedPrompt: String
}

struct ReplitStyleCreateView: View {
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @State private var prompt = ""
    @State private var showUpgradeSheet = false
    @State private var showGenerationError = false
    @State private var selectedImage: PhotosPickerItem?
    @State private var attachedImage: UIImage?

    var body: some View {
        ZStack {
            // Black background like Replit
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                if generationManager.isGenerating {
                    // Progress view
                    generationProgressView
                } else {
                    // Create view
                    createInputView
                }
            }
        }
        .alert("Generation Error", isPresented: $showGenerationError) {
            Button("OK", role: .cancel) {
                generationManager.errorMessage = nil
            }
        } message: {
            Text(generationManager.errorMessage ?? "Unknown error occurred")
        }
        .onChange(of: generationManager.errorMessage) { newValue in
            if newValue != nil {
                showGenerationError = true
            }
        }
        .sheet(isPresented: $showUpgradeSheet) {
            SubscriptionPlansView()
                .environmentObject(subscriptionManager)
        }
    }

    private var createInputView: some View {
        ScrollView {
            VStack(spacing: 24) {
                Spacer()
                    .frame(height: 60)

                // Greeting
                VStack(spacing: 12) {
                    Text("Hi \(authManager.displayName ?? "there"),")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.8))

                    Text("what do you want to learn today?")
                        .font(.title2)
                        .foregroundColor(.white.opacity(0.8))
                }

                // Large text input
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(white: 0.15))
                        .frame(height: 200)

                    TextEditor(text: $prompt)
                        .scrollContentBackground(.hidden)
                        .background(Color.clear)
                        .foregroundColor(.white)
                        .font(.system(size: 17))
                        .padding(16)
                        .frame(height: 200)

                    if prompt.isEmpty {
                        Text("Describe what you want to learn & explore the code...")
                            .foregroundColor(.white.opacity(0.3))
                            .font(.system(size: 17))
                            .padding(16)
                            .allowsHitTesting(false)
                    }
                }
                .padding(.horizontal, 20)

                // Attached image preview
                if let attachedImage = attachedImage {
                    HStack {
                        Image(uiImage: attachedImage)
                            .resizable()
                            .scaledToFit()
                            .frame(height: 80)
                            .cornerRadius(8)

                        Spacer()

                        Button(action: { self.attachedImage = nil }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                    .padding(.horizontal, 20)
                }

                // Suggestion chips
                suggestionChipsView

                // Attachment, Voice, and Start buttons
                HStack {
                    // Attachment button
                    PhotosPicker(selection: $selectedImage, matching: .images) {
                        Image(systemName: attachedImage != nil ? "paperclip.circle.fill" : "paperclip")
                            .foregroundColor(.white.opacity(0.5))
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }
                    .onChange(of: selectedImage) { newValue in
                        Task {
                            if let data = try? await newValue?.loadTransferable(type: Data.self),
                               let uiImage = UIImage(data: data) {
                                attachedImage = uiImage
                            }
                        }
                    }

                    // Voice button
                    Button(action: toggleVoiceRecording) {
                        Image(systemName: speechRecognizer.isRecording ? "mic.fill" : "mic")
                            .foregroundColor(speechRecognizer.isRecording ? .red : .white.opacity(0.5))
                            .font(.title3)
                            .frame(width: 44, height: 44)
                    }

                    Spacer()

                    Button(action: generate) {
                        HStack(spacing: 8) {
                            Text("Start")
                                .fontWeight(.medium)
                            Image(systemName: "arrow.right")
                        }
                        .foregroundColor(canGenerate ? .white.opacity(0.7) : .white.opacity(0.3))
                    }
                    .disabled(!canGenerate)
                }
                .padding(.horizontal, 32)

                Spacer()

                // Bottom info
                VStack(spacing: 12) {
                    Text("Start learning to code for free")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.5))

                    if subscriptionManager.currentTier == .free {
                        Button(action: { showUpgradeSheet = true }) {
                            HStack(spacing: 4) {
                                Text("Join VibeBuild")
                                Text("Pro")
                                    .fontWeight(.bold)
                                Text("to unlock more usage")
                            }
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.7))
                            .underline()
                        }
                    }
                }
                .padding(.bottom, 100)
            }
        }
    }

    private var generationProgressView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Progress circle
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.1), lineWidth: 8)
                    .frame(width: 120, height: 120)

                Circle()
                    .trim(from: 0, to: generationManager.progressPercent / 100)
                    .stroke(Color.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .frame(width: 120, height: 120)
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.5), value: generationManager.progressPercent)

                Text("\(Int(generationManager.progressPercent))%")
                    .font(.title.bold())
                    .foregroundColor(.white)
            }

            // Status
            VStack(spacing: 8) {
                Text(generationManager.buildPhase)
                    .font(.headline)
                    .foregroundColor(.white)

                if !generationManager.buildDetail.isEmpty {
                    Text(generationManager.buildDetail)
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }

                if generationManager.estimatedSecondsRemaining > 0 {
                    Text("~\(Int(generationManager.estimatedSecondsRemaining))s remaining")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                }
            }
            .padding(.horizontal, 40)

            Spacer()

            // Cancel button
            Button(action: {
                generationManager.cancelGeneration()
            }) {
                Text("Cancel")
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(8)
            }
            .padding(.bottom, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }

    private var suggestionChipsView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(suggestions) { suggestion in
                    Button(action: { prompt = suggestion.detailedPrompt }) {
                        Text(suggestion.label)
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.8))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(20)
                    }
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private let suggestions = [
        PromptSuggestion(
            label: "Todo List",
            detailedPrompt: "Create a modern todo list with dark mode. Include features: add new tasks, mark tasks as complete with checkboxes, delete tasks with swipe gesture, filter between all/active/completed tasks. Use a clean card-based design with smooth animations. Tasks should persist in local storage so they remain after refresh. Include a task counter showing completed vs total tasks. Use purple/blue gradient accents and smooth transitions."
        ),
        PromptSuggestion(
            label: "Weather Page",
            detailedPrompt: "Create a beautiful weather dashboard page. Show current weather conditions with large temperature display, weather icon animations, humidity percentage, wind speed with direction indicator, and pressure. Include a 5-day forecast with daily high/low temperatures and weather icons. Use geolocation API to auto-detect user's location. Design with glassmorphism effects, weather-appropriate background gradients (sunny yellow, rainy blue, cloudy gray). Add smooth transitions and loading states."
        ),
        PromptSuggestion(
            label: "Calculator",
            detailedPrompt: "Create a scientific calculator with modern gradient design. Include basic operations (+, -, ×, ÷), advanced functions (√, %, x², 1/x), memory functions (MC, MR, M+, M-), and clear/delete buttons. Use a responsive grid layout that works on mobile. Add satisfying click animations and haptic feedback. Display should show both the current input and previous calculation. Use purple-to-pink gradient background with neumorphic button design. Include keyboard shortcuts for desktop."
        ),
        PromptSuggestion(
            label: "Pomodoro Timer",
            detailedPrompt: "Create a focus timer using the Pomodoro Technique. Implement 25-minute work sessions followed by 5-minute breaks. After 4 pomodoros, give a 15-minute long break. Include start/pause/reset controls, session counter, and a circular progress indicator. Add notification sounds when sessions complete. Show total pomodoros completed today. Use a minimalist design with calm colors (soft blues and grays). Include motivational quotes during breaks. Save progress and settings to local storage."
        ),
        PromptSuggestion(
            label: "Color Palette",
            detailedPrompt: "Create a color palette generator tool. Generate harmonious color schemes using different harmony rules: complementary, triadic, analogous, split-complementary, and monochromatic. Display 5 colors per palette with large color swatches. Show hex codes, RGB values, and HSL values for each color. Include one-click copy to clipboard for hex codes. Add lock/unlock toggles for individual colors. Include randomize button to generate new palettes. Save favorite palettes to local storage. Use a clean, modern interface with good contrast."
        ),
        PromptSuggestion(
            label: "Markdown Editor",
            detailedPrompt: "Create a split-pane markdown editor with live output. Left pane: markdown input with syntax highlighting and line numbers. Right pane: live HTML output with proper styling. Support full markdown syntax: headings (H1-H6), bold, italic, code blocks with syntax highlighting, blockquotes, ordered/unordered lists, links, images, tables, and strikethrough. Include toolbar with common formatting shortcuts. Add export to HTML button. Use monospace font for editor, clean serif font for output. Implement auto-save to local storage every few seconds. Include dark/light theme toggle."
        )
    ]

    private var canGenerate: Bool {
        !prompt.isEmpty && !generationManager.isGenerating
    }

    private func toggleVoiceRecording() {
        if speechRecognizer.isRecording {
            speechRecognizer.stopRecording()
            if !speechRecognizer.transcript.isEmpty {
                prompt = speechRecognizer.transcript
            }
        } else {
            speechRecognizer.transcript = ""
            speechRecognizer.startRecording()
        }
    }

    private func generate() {
        guard subscriptionManager.canGenerate() else {
            showUpgradeSheet = true
            return
        }

        // Record usage only after generation succeeds (not before)
        generationManager.startGeneration(prompt: prompt)
    }
}

#Preview {
    ReplitStyleCreateView()
        .environmentObject(ProjectGenerationManager.shared)
        .environmentObject(SubscriptionManager.shared)
        .environmentObject(AuthManager.shared)
}
