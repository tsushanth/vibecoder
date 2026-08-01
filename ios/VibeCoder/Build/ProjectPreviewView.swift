//
//  ProjectPreviewView.swift
//  VibeCoder
//
//  WKWebView surface that loads a generated project's private preview URL
//  (prev-{id}.vibebuild.cc). Carries an AI-authorship banner pill at the
//  top because Apple Guideline 4.0 expects AI-generated content to be
//  clearly labelled. A Report option lives in the toolbar menu (mailto)
//  to satisfy the UGC reporting requirement (1.2).
//
//  Tweak chat: bottom toolbar with a text field + send arrow. Submitting
//  hits POST /api/projects/:id/tweak (always SSE), which terminates with
//  `result(success: true)`. We reload the WKWebView on success so the user
//  sees their updated app.
//

import SwiftUI
import WebKit

// MARK: - Web view controller (imperative reload)

@MainActor
final class PreviewWebController: ObservableObject {
    fileprivate weak var webView: WKWebView?

    /// Standard reload — uses the WKWebView local cache.
    func reload() { webView?.reload() }

    /// Hard reload after a revert/redeploy: bypasses the WKWebView local cache
    /// AND appends a cache-buster query so any intermediate edge cache sees a
    /// fresh URL. Without this, a successful revert often leaves the preview
    /// showing the prior bundle until the WebView is force-killed.
    func hardReloadBustingCache() {
        guard let webView = webView, let current = webView.url ?? webView.backForwardList.currentItem?.url else { return }
        var comps = URLComponents(url: current, resolvingAgainstBaseURL: false)
        var items = comps?.queryItems ?? []
        items.removeAll { $0.name == "_v" }
        items.append(URLQueryItem(name: "_v", value: String(Int(Date().timeIntervalSince1970))))
        comps?.queryItems = items
        guard let url = comps?.url else { webView.reload(); return }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        webView.load(req)
    }
}

// MARK: - Tweak model

@MainActor
final class TweakModel: ObservableObject {
    enum State: Equatable { case idle, applying, failed(String) }

    @Published var state: State = .idle
    private var task: Task<Void, Never>?

    func apply(projectId: String, description: String, userId: String, onSuccess: @escaping () -> Void) {
        task?.cancel()
        state = .applying
        let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { state = .idle; return }

        task = Task { [weak self] in
            guard let self else { return }
            do {
                let stream = VibeBuildAPI.shared.tweak(
                    projectId: projectId,
                    tweakDescription: trimmed,
                    userId: userId
                )
                for try await event in stream {
                    if Task.isCancelled { return }
                    switch event {
                    case .result(let success):
                        await MainActor.run {
                            if success {
                                self.state = .idle
                                onSuccess()
                            } else {
                                self.state = .failed("The tweak didn't apply. Try a different wording.")
                            }
                        }
                        return
                    case .failed(let msg):
                        await MainActor.run { self.state = .failed(msg) }
                        return
                    case .queued, .phase, .complete, .heartbeat, .unknown:
                        continue
                    }
                }
                // Stream closed without a terminal — treat as failure.
                await MainActor.run {
                    if case .applying = self.state {
                        self.state = .failed("Connection lost before the tweak finished.")
                    }
                }
            } catch let err as VBAPIError {
                await MainActor.run { self.state = .failed(err.localizedDescription) }
            } catch {
                if Task.isCancelled { return }
                await MainActor.run { self.state = .failed(error.localizedDescription) }
            }
        }
    }

    func cancel() {
        task?.cancel()
        state = .idle
    }
}

// MARK: - Main view

struct ProjectPreviewView: View {
    let project: VBProject
    let onClose: () -> Void

    @EnvironmentObject var authManager: AuthManager
    @StateObject private var webController = PreviewWebController()
    @StateObject private var tweak = TweakModel()

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var tweakText: String = ""
    @State private var showFailedAlert = false
    @State private var showCopiedToast = false
    @State private var showVersionHistory = false
    /// Local override of the project's title — set immediately on a successful
    /// rename so the nav bar updates without needing to re-fetch the project.
    @State private var displayedTitle: String? = nil
    @State private var showRenameAlert = false
    @State private var renameText: String = ""
    @State private var renameError: String? = nil
    @State private var isRenaming = false

    @FocusState private var tweakFocused: Bool

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Color.black.ignoresSafeArea()

                if let url = project.displayUrl {
                    WebContainer(
                        url: url,
                        controller: webController,
                        isLoading: $isLoading,
                        loadError: $loadError
                    )
                    .ignoresSafeArea(edges: .bottom)
                } else {
                    missingPreview
                }

                if isLoading && tweak.state != .applying {
                    ProgressView()
                        .tint(accent)
                        .scaleEffect(1.4)
                        .padding(.top, 40)
                }

                if let err = loadError {
                    errorOverlay(message: err)
                }
            }
            // Reserve space at the top for the AI-authorship banner (and the
            // optional tweak progress chip) so they don't overlap the WebView.
            // safeAreaInset extends the layout's safe area: WKWebView lays out
            // below the banner instead of underneath it.
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 6) {
                    aiAuthorshipBanner
                    if let url = project.displayUrl {
                        shareURLBar(url: url)
                    }
                    if tweak.state == .applying {
                        tweakProgressBanner
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(Color.black)
            }
            .safeAreaInset(edge: .bottom) {
                tweakBar
            }
            .navigationTitle(currentTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done", action: onClose)
                        .foregroundColor(.white)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            renameText = currentTitle
                            renameError = nil
                            showRenameAlert = true
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        if let url = project.displayUrl {
                            Button {
                                copyURL(url)
                            } label: {
                                Label("Copy Link", systemImage: "link")
                            }
                        }
                        Button {
                            showVersionHistory = true
                        } label: {
                            Label("Version History", systemImage: "clock.arrow.circlepath")
                        }
                        Divider()
                        Button {
                            reportProject()
                        } label: {
                            Label("Report Project", systemImage: "flag")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundColor(.white)
                    }
                }
            }
            .onChange(of: tweak.state) { newState in
                if case .failed = newState { showFailedAlert = true }
            }
            .alert("Tweak Failed", isPresented: $showFailedAlert) {
                Button("OK") { tweak.cancel() }
            } message: {
                if case .failed(let msg) = tweak.state { Text(msg) }
            }
            .alert("Rename Project", isPresented: $showRenameAlert) {
                TextField("App name", text: $renameText)
                    .textInputAutocapitalization(.words)
                Button("Cancel", role: .cancel) {}
                Button(isRenaming ? "Saving…" : "Save") {
                    submitRename()
                }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRenaming)
            } message: {
                if let err = renameError {
                    Text(err)
                } else {
                    Text("Give your project a name you'll recognize later.")
                }
            }
            .sheet(isPresented: $showVersionHistory) {
                VersionHistorySheet(
                    projectId: project.id,
                    userId: BuildIdentity.resolve(authManager: authManager)
                ) {
                    // Backend has re-bundled + redeployed to the same preview URL.
                    // Brief delay before reload so the deploy-server has time to
                    // publish the new bundle; then hard-reload bypassing the
                    // WKWebView local cache (a plain reload() keeps showing the
                    // prior bundle even when the server has the new one).
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        webController.hardReloadBustingCache()
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Subviews

    private var aiAuthorshipBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
            Text("AI-generated — verify before relying on")
                .font(.system(size: 12, weight: .semibold))
            Spacer()
        }
        .foregroundColor(.black)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Capsule().fill(accent.opacity(0.95)))
    }

    /// Replit-style link bar — surfaces the project's already-live URL so the
    /// user can copy/share it. The URL exists from the moment the build
    /// completes; we don't have a separate "publish" step.
    private func shareURLBar(url: URL) -> some View {
        Button {
            copyURL(url)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 11, weight: .semibold))
                Text(displayHost(of: url))
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 6)
                Image(systemName: showCopiedToast ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                Text(showCopiedToast ? "Copied" : "Copy")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Capsule().fill(Color.white.opacity(0.12)))
            .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func displayHost(of url: URL) -> String {
        // Drop the scheme so the pill is denser without losing the meaningful
        // part of the URL. e.g. https://prev-8300d035.vibebuild.cc → prev-8300d035.vibebuild.cc
        guard let host = url.host else { return url.absoluteString }
        let path = url.path
        return path.isEmpty || path == "/" ? host : host + path
    }

    private var tweakProgressBanner: some View {
        HStack(spacing: 8) {
            ProgressView().tint(.white).scaleEffect(0.7)
            Text("Applying your change… this can take a minute")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.white)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Capsule().fill(Color.white.opacity(0.12)))
        .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
    }

    private var tweakBar: some View {
        HStack(spacing: 10) {
            TextField("Tweak it: \u{201C}add a delete button\u{201D}", text: $tweakText, axis: .vertical)
                .lineLimit(1...3)
                .focused($tweakFocused)
                .foregroundColor(.white)
                .tint(accent)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 22).fill(Color.white.opacity(0.10)))
                .overlay(RoundedRectangle(cornerRadius: 22)
                    .stroke(Color.white.opacity(0.15), lineWidth: 1))
                .disabled(tweak.state == .applying)

            Button {
                submitTweak()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 30))
                    .foregroundColor(canSubmitTweak ? accent : accent.opacity(0.35))
            }
            .disabled(!canSubmitTweak)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    private var canSubmitTweak: Bool {
        tweak.state != .applying &&
        !tweakText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        project.displayUrl != nil
    }

    private var missingPreview: some View {
        VStack(spacing: 12) {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 40))
                .foregroundColor(.white.opacity(0.4))
            Text("This project has no preview URL yet.")
                .font(.callout)
                .foregroundColor(.white.opacity(0.7))
        }
    }

    private func errorOverlay(message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 30))
                .foregroundColor(.red)
            Text(message)
                .font(.footnote)
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.top, 100)
    }

    // MARK: - Actions

    private func submitTweak() {
        let text = tweakText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        tweakFocused = false
        // Clear the field immediately so submission feels acknowledged —
        // the top "Applying your change…" chip is easy to miss otherwise.
        // The tweak text is captured in `text` so a failure can still surface
        // it in the error alert if we ever need to restore it.
        tweakText = ""
        let uid = BuildIdentity.resolve(authManager: authManager)
        tweak.apply(projectId: project.id, description: text, userId: uid) {
            // On success: reload WebView so the user sees the updated bundle.
            // The preview URL is content-addressed by project id, so reloading
            // the same URL pulls the new bundle.
            webController.reload()
        }
    }

    private var currentTitle: String {
        displayedTitle ?? project.title ?? "Project"
    }

    private func submitRename() {
        let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isRenaming else { return }
        isRenaming = true
        renameError = nil
        let uid = BuildIdentity.resolve(authManager: authManager)
        Task {
            do {
                _ = try await VibeBuildAPI.shared.renameProject(id: project.id, userId: uid, title: trimmed)
                await MainActor.run {
                    displayedTitle = trimmed
                    isRenaming = false
                }
            } catch let err as VBAPIError {
                await MainActor.run {
                    renameError = err.localizedDescription
                    isRenaming = false
                    showRenameAlert = true
                }
            } catch {
                await MainActor.run {
                    renameError = error.localizedDescription
                    isRenaming = false
                    showRenameAlert = true
                }
            }
        }
    }

    private func copyURL(_ url: URL) {
        UIPasteboard.general.url = url
        withAnimation(.easeInOut(duration: 0.15)) { showCopiedToast = true }
        // Reset the "Copied" affordance after a couple seconds.
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            await MainActor.run {
                withAnimation(.easeInOut(duration: 0.2)) { showCopiedToast = false }
            }
        }
    }

    private func reportProject() {
        let subject = "Report VibeBuild project \(project.id)"
        let body = "Project ID: \(project.id)\nTitle: \(project.title ?? "")\nReason: "
        let allowed = CharacterSet.urlQueryAllowed
        let s = subject.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        let b = body.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        if let url = URL(string: "mailto:abuse@kreativekoala.com?subject=\(s)&body=\(b)") {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - WKWebView wrapper

private struct WebContainer: UIViewRepresentable {
    let url: URL
    let controller: PreviewWebController
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        // Personal projects: keep cookies/storage isolated from system Safari.
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.websiteDataStore = .nonPersistent()  // private session per preview
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.backgroundColor = .black
        view.isOpaque = false
        view.scrollView.backgroundColor = .black
        view.load(URLRequest(url: url))
        controller.webView = view
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // No-op — URL is loaded once at make time. Refresh after a tweak is
        // triggered imperatively via PreviewWebController.reload(), not here.
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: WebContainer
        init(_ parent: WebContainer) { self.parent = parent }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.loadError = (error as NSError).localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.loadError = (error as NSError).localizedDescription
        }
    }
}
