import SwiftUI

struct LivePreviewView: View {
    let bundleDir: URL
    var bundleBase64: String? = nil
    var projectTitle: String = "My Project"
    var initialPrompt: String = ""
    var isExistingProject: Bool = false
    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @EnvironmentObject var authManager: AuthManager
    @State private var showSaveSuccess = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var isOpeningInSafari = false
    @State private var safariError: String?

    var body: some View {
        NavigationView {
            SourceCodeView(bundleDir: bundleDir)
                .navigationTitle("Source Code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Close") {
                            dismiss()
                        }
                    }

                    ToolbarItem(placement: .navigationBarTrailing) {
                        HStack(spacing: 12) {
                            // Open in Safari button
                            Button(action: openInSafari) {
                                if isOpeningInSafari {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Label("Run in Safari", systemImage: "safari")
                                        .labelStyle(.titleAndIcon)
                                        .font(.subheadline.weight(.medium))
                                }
                            }
                            .disabled(isOpeningInSafari)

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
                .alert("Could Not Open", isPresented: .constant(safariError != nil)) {
                    Button("OK") { safariError = nil }
                } message: {
                    Text(safariError ?? "Unknown error")
                }
        }
    }

    // MARK: - Open in Safari

    private func openInSafari() {
        guard !isOpeningInSafari else { return }
        isOpeningInSafari = true

        Task {
            do {
                let base64Bundle: String
                if let original = bundleBase64 {
                    base64Bundle = original
                } else {
                    let zipData = try ZipExtractor.zipDirectory(bundleDir)
                    base64Bundle = zipData.base64EncodedString()
                }

                NSLog("[Safari] Uploading bundle for Safari preview (%d chars)", base64Bundle.count)
                let response = try await NetworkManager.shared.previewDeploy(bundle: base64Bundle)

                if let url = URL(string: response.url) {
                    await MainActor.run {
                        isOpeningInSafari = false
                        UIApplication.shared.open(url)
                    }
                } else {
                    await MainActor.run {
                        isOpeningInSafari = false
                        safariError = "Invalid URL returned from server"
                    }
                }
            } catch {
                NSLog("[Safari] Error: %@", "\(error)")
                await MainActor.run {
                    isOpeningInSafari = false
                    safariError = error.localizedDescription
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

#Preview {
    NavigationStack {
        if let bundleDir = Bundle.main.url(forResource: "example", withExtension: nil) {
            LivePreviewView(bundleDir: bundleDir)
        } else {
            Text("No preview available")
        }
    }
}
