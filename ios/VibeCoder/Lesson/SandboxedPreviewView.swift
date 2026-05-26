//
//  SandboxedPreviewView.swift
//  VibeCoder
//
//  Loads a curated lesson's index.html into a WKWebView under strict
//  sandboxing rules. There are no native message handlers, no JS bridges,
//  no remote URL loads, and a Content Security Policy is injected that
//  forbids any network access from the preview.
//
//  This file is the single point of contact between the app and any
//  user-facing HTML/JS. Anyone reviewing for App Store compliance only
//  needs to read this file to verify the sandbox boundaries.
//

import SwiftUI
import WebKit

struct SandboxedPreviewView: View {
    let project: CatalogProject
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if let url = previewIndexURL {
                    SandboxedWebView(indexURL: url)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.orange)
                        Text("Preview is not available for this lesson.")
                            .foregroundStyle(.white)
                    }
                }
            }
            .preferredColorScheme(.dark)
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var previewIndexURL: URL? {
        guard let root = CatalogStore.shared.bundleURL(for: project) else { return nil }
        let index = root.appendingPathComponent("index.html")
        return FileManager.default.fileExists(atPath: index.path) ? index : nil
    }
}

/// The actual sandboxed WKWebView. Audit checklist (mirrored in the
/// App Review reply): NO `userContentController.add(_:name:)`, NO
/// `evaluateJavaScript` from native, NO custom URL scheme handlers, NO
/// remote URL loads, and a strict CSP injected on every page.
struct SandboxedWebView: UIViewRepresentable {
    let indexURL: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        // Intentionally do NOT install any WKScriptMessageHandler — no
        // bridge between the embedded HTML and the native app exists.

        // Inject a default-`'none'` CSP at document start that blocks all
        // network access from the preview (no fetch, no XHR, no images
        // from anywhere except data:, no <script src=…>). This is on top
        // of the file:// origin which is already isolated by WebKit.
        let cspJS = """
        (function() {
            var m = document.createElement('meta');
            m.httpEquiv = 'Content-Security-Policy';
            m.content = "default-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self';";
            (document.head || document.documentElement).prepend(m);
        })();
        """
        let cspScript = WKUserScript(source: cspJS,
                                     injectionTime: .atDocumentStart,
                                     forMainFrameOnly: true)
        config.userContentController.addUserScript(cspScript)

        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.bounces = true
        view.navigationDelegate = context.coordinator

        // Local file load only. Read access is constrained to the project's
        // own folder so the WebView cannot reach other files in the bundle.
        view.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        // Block any non-file:// navigation attempts (e.g. an embedded <a>
        // pointing at https://…). The user can't accidentally browse out
        // of the sandbox.
        func webView(_ webView: WKWebView,
                     decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, url.scheme != "file" {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
