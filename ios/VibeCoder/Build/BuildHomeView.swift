//
//  BuildHomeView.swift
//  VibeCoder
//
//  Build tab — prompt input + suggestion chips + Generate button.
//  Gates on EULA acceptance and BuildLimitTracker.canStartBuild;
//  hits paywall (RemotePaywallView) when free users hit the daily cap.
//

import SwiftUI

struct BuildHomeView: View {
    /// Type-safe navigation destinations within the Build tab's NavigationStack.
    enum Destination: Hashable { case myProjects }

    @EnvironmentObject var authManager: AuthManager
    @ObservedObject private var limit = BuildLimitTracker.shared
    @ObservedObject private var premium = PremiumManager.shared
    @ObservedObject private var deepLink = NotificationDeepLink.shared
    @State private var deepLinkedProject: VBProject? = nil

    @State private var path: [Destination] = []
    @State private var prompt: String = ""
    @State private var suggestions: [VBSuggestion] = []
    @State private var loadingSuggestions = false
    @State private var showEULA = false
    @State private var showProgress = false
    @State private var showPaywall = false
    @State private var showVoiceSheet = false
    @State private var showImagePicker = false
    @State private var pendingPrompt: String? = nil
    @State private var errorMessage: String?
    /// Attached reference image (downsized) + its base64 encoding. Kept together
    /// so the chip can render the thumbnail and the build can send the encoded
    /// payload without re-encoding mid-submit.
    @State private var referenceImage: UIImage? = nil
    @State private var referenceImageBase64: String? = nil
    @State private var pendingReferenceImageBase64: String? = nil

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)
    private let placeholder = "Describe an app you want to build…"

    /// Stable identifier for build attribution. Sourced from BuildIdentity so
    /// the value survives sign-out and is consistent across BuildHomeView,
    /// MyProjectsView, and ProjectPreviewView.
    private var resolvedUserId: String {
        BuildIdentity.resolve(authManager: authManager)
    }

    private var resolvedDisplayName: String {
        BuildIdentity.displayName(authManager: authManager)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    promptCard
                    referenceImageChip
                    if !suggestions.isEmpty || loadingSuggestions {
                        suggestionsSection
                    }
                    generateSection
                    if let err = errorMessage {
                        Text(err)
                            .font(.footnote)
                            .foregroundColor(.red.opacity(0.85))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal)
                    }
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Build")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        path.append(.myProjects)
                    } label: {
                        // Text + icon makes the entry point obvious — bare icon
                        // alone is easy to miss during review and user testing.
                        Label("My Projects", systemImage: "tray.full")
                            .labelStyle(.titleAndIcon)
                            .foregroundColor(.white)
                    }
                }
            }
            .navigationDestination(for: Destination.self) { dest in
                switch dest {
                case .myProjects: MyProjectsView()
                }
            }
            .task { await loadSuggestions() }
            .sheet(isPresented: $showEULA) {
                EULAGate(
                    onAccept: { startBuildIfReady() },
                    onDecline: { pendingPrompt = nil }
                )
            }
            .fullScreenCover(isPresented: $showProgress) {
                BuildProgressView(
                    prompt: pendingPrompt ?? prompt,
                    userId: resolvedUserId,
                    userName: resolvedDisplayName,
                    referenceImage: pendingReferenceImageBase64,
                    onClose: {
                        showProgress = false
                        prompt = ""
                        pendingPrompt = nil
                        pendingReferenceImageBase64 = nil
                        referenceImage = nil
                        referenceImageBase64 = nil
                    }
                )
            }
            .fullScreenCover(isPresented: $showPaywall) {
                RemotePaywallView(triggerSource: "build_daily_limit")
            }
            .sheet(isPresented: $showVoiceSheet) {
                VoiceDictationSheet { text in
                    // Append rather than overwrite — user may have already typed
                    // something and is dictating an addition. Trim + space-join.
                    let existing = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
                    prompt = existing.isEmpty ? text : "\(existing) \(text)"
                }
            }
            .sheet(isPresented: $showImagePicker) {
                ImagePicker { img in
                    referenceImage = img
                    // Pre-encode now so the build doesn't pay JPEG-compression
                    // cost at the moment the user taps Generate.
                    referenceImageBase64 = img.vibeBuildReferenceBase64()
                }
                .ignoresSafeArea()
            }
            .fullScreenCover(item: $deepLinkedProject) { project in
                ProjectPreviewView(project: project) {
                    deepLinkedProject = nil
                }
            }
            .onChange(of: deepLink.pendingProjectId) { _, newId in
                guard let id = newId else { return }
                // Fetch the project, present it. Clear the deep-link slot so a
                // second tap of the same notif during the same session doesn't
                // re-fire the open.
                Task { @MainActor in
                    deepLink.pendingProjectId = nil
                    if let project = try? await VibeBuildAPI.shared.fetchProject(id: id) {
                        deepLinkedProject = project
                    }
                }
            }
            .task {
                // Handle a notification tap that arrived before this view existed
                if let id = deepLink.pendingProjectId {
                    deepLink.pendingProjectId = nil
                    if let project = try? await VibeBuildAPI.shared.fetchProject(id: id) {
                        deepLinkedProject = project
                    }
                }
            }
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Build a personal app")
                .font(.title2.weight(.bold))
                .foregroundColor(.white)
            Text("Describe an app idea. We'll generate a private project you can preview right here.")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.55))
        }
    }

    private var promptCard: some View {
        ZStack(alignment: .topLeading) {
            // Use TextEditor for multiline input; native placeholder isn't
            // supported until iOS 17.4's `axis: .vertical` TextField, so we
            // overlay our own placeholder while the buffer is empty.
            TextEditor(text: $prompt)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .font(.body)
                .foregroundColor(.white)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.08)))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )

            if prompt.isEmpty {
                Text(placeholder)
                    .foregroundColor(.white.opacity(0.35))
                    .padding(.horizontal, 18)
                    .padding(.top, 20)
                    .allowsHitTesting(false)
            }

            // Bottom-right action stack inside the prompt card: image picker
            // then mic. Both are subtle bubbles so they don't compete with the
            // primary Generate CTA below.
            VStack {
                Spacer()
                HStack(spacing: 8) {
                    Spacer()
                    Button {
                        showImagePicker = true
                    } label: {
                        Image(systemName: "photo.on.rectangle")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(accent)
                            .padding(10)
                            .background(Circle().fill(Color.white.opacity(0.12)))
                            .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    }
                    .accessibilityLabel("Attach reference image")

                    Button {
                        showVoiceSheet = true
                    } label: {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(accent)
                            .padding(10)
                            .background(Circle().fill(Color.white.opacity(0.12)))
                            .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 1))
                    }
                    .accessibilityLabel("Dictate prompt")
                }
                .padding(10)
            }
        }
    }

    @ViewBuilder
    private var referenceImageChip: some View {
        if let img = referenceImage {
            HStack(spacing: 10) {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reference image attached")
                        .font(.footnote.weight(.medium))
                        .foregroundColor(.white)
                    Text("Will be sent with the prompt")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.5))
                }
                Spacer()
                Button {
                    referenceImage = nil
                    referenceImageBase64 = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.white.opacity(0.55))
                }
                .accessibilityLabel("Remove image")
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.12), lineWidth: 1))
        }
    }

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Try one of these")
                .font(.footnote.weight(.semibold))
                .foregroundColor(.white.opacity(0.55))
                .textCase(.uppercase)

            if loadingSuggestions && suggestions.isEmpty {
                ProgressView().tint(accent).frame(maxWidth: .infinity, alignment: .center)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(suggestions) { s in
                        Button {
                            prompt = s.prompt
                        } label: {
                            Text(s.label)
                                .font(.footnote.weight(.medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(Color.white.opacity(0.10)))
                                .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var generateSection: some View {
        VStack(spacing: 10) {
            Button {
                tappedGenerate()
            } label: {
                Text("Generate")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(RoundedRectangle(cornerRadius: 12)
                        .fill(prompt.trimmingCharacters(in: .whitespaces).isEmpty
                              ? accent.opacity(0.5)
                              : accent))
            }
            .disabled(prompt.trimmingCharacters(in: .whitespaces).isEmpty)

            limitFooter
        }
    }

    @ViewBuilder
    private var limitFooter: some View {
        if premium.isPremium {
            Text("Tinker Pro · unlimited builds")
                .font(.footnote)
                .foregroundColor(.white.opacity(0.5))
        } else if let remaining = limit.remainingToday {
            HStack(spacing: 4) {
                Text("\(remaining) free \(remaining == 1 ? "build" : "builds") left today.")
                Button("Upgrade for unlimited") { showPaywall = true }
                    .foregroundColor(accent)
            }
            .font(.footnote)
            .foregroundColor(.white.opacity(0.5))
        }
    }

    // MARK: - Actions

    private func tappedGenerate() {
        errorMessage = nil
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Daily cap (free tier only)
        if !limit.canStartBuild {
            showPaywall = true
            return
        }

        pendingPrompt = trimmed
        // Snapshot the encoded image so an EULA detour doesn't drop it.
        pendingReferenceImageBase64 = referenceImageBase64

        if EULAStore.hasAccepted {
            startBuildIfReady()
        } else {
            showEULA = true
        }
    }

    private func startBuildIfReady() {
        guard let p = pendingPrompt, !p.isEmpty else { return }
        guard limit.canStartBuild else {
            showPaywall = true
            return
        }
        limit.recordBuildStarted()
        showProgress = true
    }

    private func loadSuggestions() async {
        guard suggestions.isEmpty else { return }
        loadingSuggestions = true
        defer { loadingSuggestions = false }
        do {
            suggestions = try await VibeBuildAPI.shared.fetchSuggestions(count: 6)
        } catch {
            // Silent — chips are a nice-to-have. Don't block the prompt input.
            print("[Build] suggestions fetch failed: \(error)")
        }
    }
}

// MARK: - FlowLayout (chip wrap)

/// Minimal flow layout for chips. Wraps children onto multiple lines when
/// they overflow the available width. Avoids pulling in a third-party library.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var lineWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if lineWidth + size.width > maxWidth {
                totalHeight += lineHeight + spacing
                lineWidth = 0
                lineHeight = 0
            }
            lineWidth += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        totalHeight += lineHeight
        return CGSize(width: maxWidth.isFinite ? maxWidth : lineWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + spacing
                lineHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
