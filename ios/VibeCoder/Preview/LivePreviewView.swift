import SwiftUI
import WebKit

enum PreviewTab: String, CaseIterable {
    case code = "Source Code"
    case preview = "Preview"

    var icon: String {
        switch self {
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .preview: return "eye"
        }
    }
}

struct LivePreviewView: View {
    let bundleDir: URL
    var bundleBase64: String? = nil
    var projectTitle: String = "My Project"
    var initialPrompt: String = ""
    var isExistingProject: Bool = false
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @EnvironmentObject var authManager: AuthManager
    @State private var reloadTrigger = false
    @State private var showSaveSuccess = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var selectedTab: PreviewTab = .code

    // Server-side preview state
    @State private var previewURL: URL? = nil
    @State private var isUploadingPreview = false
    @State private var previewError: String? = nil

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // URL bar when preview tab is active
                if selectedTab == .preview {
                    previewURLBar
                }

                // Preview / Source Code tab switcher
                tabSwitcher

                // Content
                switch selectedTab {
                case .preview:
                    previewContent
                case .code:
                    SourceCodeView(bundleDir: bundleDir)
                }
            }
            .navigationTitle(selectedTab == .code ? "Source Code" : "Web Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        if selectedTab == .preview {
                            Button(action: refreshPreview) {
                                Image(systemName: "arrow.clockwise")
                            }
                        }

                        if !isExistingProject {
                            Button(action: saveProject) {
                                if isSaving {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Text("Save")
                                        .fontWeight(.semibold)
                                }
                            }
                            .disabled(isSaving)
                        }
                    }
                }
            }
            .alert("Saved!", isPresented: $showSaveSuccess) {
                Button("OK") { dismiss() }
            } message: {
                Text("Your project has been saved and is now in your Projects tab")
            }
            .alert("Save Error", isPresented: .constant(saveError != nil)) {
                Button("OK") { saveError = nil }
            } message: {
                Text(saveError ?? "Unknown error")
            }
        }
        .onAppear {
            uploadPreview()
        }
    }

    // MARK: - URL Bar

    private var previewURLBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
                .font(.caption2)
                .foregroundColor(.green)

            if let url = previewURL {
                Text(url.host ?? url.absoluteString)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.8))
                    .lineLimit(1)
            } else if isUploadingPreview {
                Text("Loading...")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
            } else {
                Text("Not available")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
            }

            Spacer()

            if isUploadingPreview {
                ProgressView()
                    .scaleEffect(0.7)
                    .tint(.white.opacity(0.5))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(white: 0.15))
        .cornerRadius(8)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.3))
    }

    // MARK: - Preview Content

    @ViewBuilder
    private var previewContent: some View {
        if isUploadingPreview {
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.blue)
                Text("Uploading to server...")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Text("Your code is being deployed to a secure server for preview")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
        } else if let url = previewURL {
            ServerWebViewRepresentable(url: url, reloadTrigger: reloadTrigger)
        } else if let error = previewError {
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40))
                    .foregroundColor(.orange)
                Text("Preview Unavailable")
                    .font(.headline)
                Text(error)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Button("Retry") {
                    uploadPreview()
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
        } else {
            VStack(spacing: 16) {
                ProgressView()
                Text("Preparing preview...")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
        }
    }

    // MARK: - Tab Switcher

    private var tabSwitcher: some View {
        HStack(spacing: 0) {
            ForEach(PreviewTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedTab = tab
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.icon)
                            .font(.caption2)
                        Text(tab.rawValue)
                            .font(.subheadline.weight(.medium))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                        selectedTab == tab
                            ? Color.blue.opacity(0.2)
                            : Color.clear
                    )
                    .foregroundColor(selectedTab == tab ? .blue : .secondary)
                }
            }
        }
        .background(Color.black.opacity(0.3))
        .overlay(alignment: .bottom) {
            // Bottom indicator line
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.blue)
                    .frame(width: geo.size.width / 2, height: 2)
                    .offset(x: selectedTab == .code ? 0 : geo.size.width / 2)
                    .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }
            .frame(height: 2)
        }
    }

    // MARK: - Preview Upload

    private func uploadPreview() {
        guard !isUploadingPreview else { return }
        isUploadingPreview = true
        previewError = nil

        Task {
            do {
                let base64Bundle: String
                if let original = bundleBase64 {
                    base64Bundle = original
                } else {
                    // Re-zip from disk if no base64 available
                    let zipData = try ZipExtractor.zipDirectory(bundleDir)
                    base64Bundle = zipData.base64EncodedString()
                }

                NSLog("[Preview] Uploading bundle for server-side preview (%d chars)", base64Bundle.count)
                let response = try await NetworkManager.shared.previewDeploy(bundle: base64Bundle)

                await MainActor.run {
                    previewURL = URL(string: response.url)
                    isUploadingPreview = false
                    NSLog("[Preview] Server preview ready: %@", response.url)
                }
            } catch {
                NSLog("[Preview] Upload error: %@", "\(error)")
                await MainActor.run {
                    previewError = error.localizedDescription
                    isUploadingPreview = false
                }
            }
        }
    }

    private func refreshPreview() {
        // Re-zip current files (may include edits) and re-upload
        previewURL = nil
        Task {
            do {
                let zipData = try ZipExtractor.zipDirectory(bundleDir)
                let base64Bundle = zipData.base64EncodedString()

                await MainActor.run {
                    isUploadingPreview = true
                    previewError = nil
                }

                NSLog("[Preview] Re-uploading edited bundle (%d chars)", base64Bundle.count)
                let response = try await NetworkManager.shared.previewDeploy(bundle: base64Bundle)

                await MainActor.run {
                    previewURL = URL(string: response.url)
                    isUploadingPreview = false
                    reloadTrigger.toggle()
                }
            } catch {
                await MainActor.run {
                    previewError = error.localizedDescription
                    isUploadingPreview = false
                }
            }
        }
    }

    // MARK: - Save

    private func saveProject() {
        guard !isSaving else { return }
        isSaving = true

        Task {
            do {
                let base64Bundle: String
                if let original = bundleBase64 {
                    base64Bundle = original
                    NSLog("[Save] Using original bundle (%d chars)", base64Bundle.count)
                } else {
                    NSLog("[Save] Re-zipping directory: %@", bundleDir.path)
                    let zipData = try ZipExtractor.zipDirectory(bundleDir)
                    base64Bundle = zipData.base64EncodedString()
                    NSLog("[Save] Re-zip complete (%d chars)", base64Bundle.count)
                }

                let shortTitle: String = {
                    let words = initialPrompt.components(separatedBy: .whitespaces).prefix(6)
                    let candidate = words.joined(separator: " ")
                    return candidate.count > 80 ? String(candidate.prefix(80)) : candidate
                }()
                let title = shortTitle.isEmpty ? projectTitle : shortTitle
                let creatorId = authManager.userId ?? UIDevice.current.identifierForVendor?.uuidString ?? "unknown"

                NSLog("[Save] Saving project: title='%@' creatorId=%@ bundleSize=%d", title, creatorId, base64Bundle.count)

                _ = try await NetworkManager.shared.saveProject(
                    title: title,
                    description: initialPrompt,
                    bundle: base64Bundle,
                    creatorId: creatorId,
                    creatorName: authManager.displayName ?? UIDevice.current.name,
                    initialPrompt: initialPrompt,
                    isPublic: true
                )

                NSLog("[Save] Success!")
                await MainActor.run {
                    isSaving = false
                    showSaveSuccess = true
                }
            } catch {
                NSLog("[Save] ERROR: %@", "\(error)")
                await MainActor.run {
                    isSaving = false
                    saveError = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Server WebView (loads from URL, not local files)

struct ServerWebViewRepresentable: UIViewRepresentable {
    let url: URL
    let reloadTrigger: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // No local file access needed — content is served from our server

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastReloadTrigger != reloadTrigger {
            context.coordinator.lastReloadTrigger = reloadTrigger
            webView.load(URLRequest(url: url))
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        var lastReloadTrigger: Bool = false

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let scheme = navigationAction.request.url?.scheme

            if navigationAction.navigationType == .other ||
               navigationAction.navigationType == .reload ||
               scheme == "about" || scheme == "https" || scheme == "http" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("WebView navigation failed: \(error.localizedDescription)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("WebView provisional navigation failed: \(error.localizedDescription)")
        }
    }
}

#Preview {
    NavigationStack {
        if let bundleDir = Bundle.main.url(forResource: "example", withExtension: nil) {
            LivePreviewView(bundleDir: bundleDir)
        } else {
            Text("No preview available")
        }
    }
}
