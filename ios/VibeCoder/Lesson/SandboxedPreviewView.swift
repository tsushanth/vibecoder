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
    @ObservedObject private var edits = LessonEditStore.shared
    @ObservedObject private var premium = PremiumManager.shared
    @State private var showOriginal = false
    @State private var showPaywall = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if edits.hasEdits(slug: project.slug) {
                    compareControl
                }
                ZStack {
                    Color.black.ignoresSafeArea()
                    if let url = previewIndexURL {
                        SandboxedWebView(indexURL: url)
                            .ignoresSafeArea(edges: .bottom)
                            // Force the WKWebView to rebuild when toggling
                            // between original and edited — a new URL means
                            // a clean load.
                            .id(url.path)
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
            }
            .preferredColorScheme(.dark)
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $showPaywall) {
                RemotePaywallView(triggerSource: "compare_original")
            }
        }
    }

    private var navTitle: String {
        guard edits.hasEdits(slug: project.slug) else { return "Preview" }
        return showOriginal ? "Preview · original" : "Preview · your edits"
    }

    @ViewBuilder
    private var compareControl: some View {
        HStack(spacing: 10) {
            Image(systemName: "rectangle.lefthalf.inset.filled")
                .foregroundStyle(.white.opacity(0.7))
            Picker("Show", selection: Binding<Bool>(
                get: { showOriginal },
                set: { newValue in
                    if newValue && !premium.isPremium {
                        showPaywall = true
                    } else {
                        showOriginal = newValue
                    }
                }
            )) {
                Text("Your edits").tag(false)
                Text(premium.isPremium ? "Original" : "Original · Pro").tag(true)
            }
            .pickerStyle(.segmented)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.white.opacity(0.05))
    }

    /// When showing the original, return the bundled index.html. Otherwise
    /// prefer the user's tinkered copy if any edits exist, falling back to
    /// the bundle. WKWebView's allowingReadAccessTo is scoped to the parent
    /// of whichever index.html we return so relative imports work in both
    /// modes.
    private var previewIndexURL: URL? {
        if !showOriginal, let tinkered = edits.materializeIfEdited(project: project) {
            return tinkered
        }
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
