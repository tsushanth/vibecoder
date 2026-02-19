import SwiftUI
import WebKit

struct LivePreviewView: View {
    let bundleDir: URL
    var bundleBase64: String? = nil   // use original bundle if available
    var projectTitle: String = "My Project"
    var initialPrompt: String = ""
    var isExistingProject: Bool = false  // true when opened from Apps tab (no save button)
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @EnvironmentObject var authManager: AuthManager
    @State private var reloadTrigger = false
    @State private var showSaveSuccess = false
    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                WebViewRepresentable(bundleDir: bundleDir, reloadTrigger: reloadTrigger)
            }
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        Button(action: {
                            reloadTrigger.toggle()
                        }) {
                            Image(systemName: "arrow.clockwise")
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
                Text("Your project has been saved and is now in your Apps tab")
            }
            .alert("Save Error", isPresented: .constant(saveError != nil)) {
                Button("OK") { saveError = nil }
            } message: {
                Text(saveError ?? "Unknown error")
            }
        }
    }

    private func saveProject() {
        guard !isSaving else { return }
        isSaving = true

        Task {
            do {
                // Use original bundle base64 if available; fall back to re-zipping the directory
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

                // Derive a short title from the first sentence/words of the prompt
                let shortTitle: String = {
                    let words = initialPrompt.components(separatedBy: .whitespaces).prefix(6)
                    let candidate = words.joined(separator: " ")
                    return candidate.count > 80 ? String(candidate.prefix(80)) : candidate
                }()
                let title = shortTitle.isEmpty ? projectTitle : shortTitle
                let creatorId = authManager.userId ?? UIDevice.current.identifierForVendor?.uuidString ?? "unknown"

                NSLog("[Save] Saving project: title='%@' creatorId=%@ bundleSize=%d", title, creatorId, base64Bundle.count)

                // Save to backend (120s timeout for large bundles)
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

struct WebViewRepresentable: UIViewRepresentable {
    let bundleDir: URL
    let reloadTrigger: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        config.userContentController = controller

        // Allow file access for bundle-based web apps
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator

        loadContent(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Reload when reloadTrigger changes
        if context.coordinator.lastReloadTrigger != reloadTrigger {
            context.coordinator.lastReloadTrigger = reloadTrigger
            loadContent(in: webView)
        }
    }

    private func loadContent(in webView: WKWebView) {
        let indexPath = bundleDir.appendingPathComponent("index.html")
        webView.loadFileURL(indexPath, allowingReadAccessTo: bundleDir)
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        var lastReloadTrigger: Bool = false

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let scheme = navigationAction.request.url?.scheme

            // Allow file:// URLs and navigation within the web app
            if navigationAction.navigationType == .other ||
               navigationAction.navigationType == .reload ||
               scheme == "about" || scheme == "file" {
                decisionHandler(.allow)
            } else if scheme == "http" || scheme == "https" {
                // Allow external links (e.g., API calls, CDN resources)
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
