//
//  VersionHistorySheet.swift
//  VibeCoder
//
//  Lists prior commits for a project and lets the user revert to any of them.
//  Mirrors the Android `VersionHistorySheet` UX. Reverting calls
//  POST /api/projects/:id/revert/:sha and asks the caller to reload the preview.
//

import SwiftUI

@MainActor
final class VersionHistoryModel: ObservableObject {
    @Published var versions: [VBAppVersion] = []
    @Published var isLoading: Bool = false
    @Published var revertingSha: String? = nil
    @Published var errorMessage: String? = nil

    private let projectId: String
    private let userId: String

    init(projectId: String, userId: String) {
        self.projectId = projectId
        self.userId = userId
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            versions = try await VibeBuildAPI.shared.fetchVersions(projectId: projectId)
        } catch let err as VBAPIError {
            errorMessage = err.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Reverts to the given commit. On success, returns true so the caller
    /// can reload the WebView and dismiss.
    func revert(to sha: String) async -> Bool {
        revertingSha = sha
        errorMessage = nil
        defer { revertingSha = nil }
        do {
            _ = try await VibeBuildAPI.shared.useVersion(projectId: projectId, sha: sha, userId: userId)
            return true
        } catch let err as VBAPIError {
            errorMessage = err.localizedDescription
            return false
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

struct VersionHistorySheet: View {
    let projectId: String
    let userId: String
    /// Called after a successful revert so the parent can reload the WebView.
    let onReverted: () -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: VersionHistoryModel
    @State private var confirmSha: String? = nil

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    init(projectId: String, userId: String, onReverted: @escaping () -> Void) {
        self.projectId = projectId
        self.userId = userId
        self.onReverted = onReverted
        _model = StateObject(wrappedValue: VersionHistoryModel(projectId: projectId, userId: userId))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                content
            }
            .navigationTitle("Version History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.white)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.load() }
        .alert(
            "Revert to this version?",
            isPresented: Binding(
                get: { confirmSha != nil },
                set: { if !$0 { confirmSha = nil } }
            )
        ) {
            Button("Cancel", role: .cancel) { confirmSha = nil }
            Button("Revert", role: .destructive) {
                guard let sha = confirmSha else { return }
                confirmSha = nil
                Task {
                    let ok = await model.revert(to: sha)
                    if ok {
                        onReverted()
                        dismiss()
                    }
                }
            }
        } message: {
            Text("Your project will be restored to this version. The live preview will reload.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let sha = model.revertingSha {
            VStack(spacing: 12) {
                ProgressView().tint(accent).scaleEffect(1.4)
                Text("Restoring…")
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.7))
                Text("v\(shortLabel(forSha: sha))")
                    .font(.footnote.monospaced())
                    .foregroundColor(.white.opacity(0.4))
            }
        } else if model.isLoading && model.versions.isEmpty {
            ProgressView().tint(accent).scaleEffect(1.4)
        } else if let err = model.errorMessage, model.versions.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 30))
                    .foregroundColor(.red.opacity(0.8))
                Text(err)
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Try again") {
                    Task { await model.load() }
                }
                .foregroundColor(accent)
                .padding(.top, 4)
            }
        } else if model.versions.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 30))
                    .foregroundColor(.white.opacity(0.4))
                Text("No history yet.")
                    .font(.callout)
                    .foregroundColor(.white.opacity(0.5))
            }
        } else {
            ScrollView {
                VStack(spacing: 8) {
                    // Surface a recent revert/load error inline so it doesn't disappear
                    // when the version list is still populated. Without this banner,
                    // a failed revert silently dismisses the spinner and the user sees
                    // the same list again with no signal that the action failed.
                    if let err = model.errorMessage {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red.opacity(0.85))
                            Text(err)
                                .font(.footnote)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button {
                                model.errorMessage = nil
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.red.opacity(0.15)))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.red.opacity(0.30), lineWidth: 1))
                    }
                    ForEach(Array(model.versions.enumerated()), id: \.element.id) { idx, version in
                        row(version: version, versionNumber: model.versions.count - idx, isCurrent: idx == 0)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
    }

    private func row(version: VBAppVersion, versionNumber: Int, isCurrent: Bool) -> some View {
        HStack(spacing: 12) {
            // Version badge
            Text("v\(versionNumber)")
                .font(.system(size: 13, weight: .bold).monospacedDigit())
                .foregroundColor(isCurrent ? .white : .white.opacity(0.7))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 8).fill(
                    isCurrent ? accent : Color.white.opacity(0.15)
                ))

            VStack(alignment: .leading, spacing: 3) {
                Text(formatMessage(version.message))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white)
                    .lineLimit(2)
                Text(relativeDateString(version.date))
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.45))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isCurrent {
                Text("Current")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(accent))
            } else {
                Button {
                    confirmSha = version.sha
                } label: {
                    Image(systemName: "arrow.counterclockwise.circle")
                        .font(.system(size: 22))
                        .foregroundColor(accent)
                }
                .accessibilityLabel("Revert to v\(versionNumber)")
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(
            isCurrent ? accent.opacity(0.10) : Color.white.opacity(0.06)
        ))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isCurrent ? accent.opacity(0.30) : Color.white.opacity(0.10), lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private func formatMessage(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "Initial version" }
        var s = raw
        if s.hasPrefix("Tweak: ") { s.removeFirst("Tweak: ".count) }
        if s.hasPrefix("tweak: ") { s.removeFirst("tweak: ".count) }
        if s == "Initial app creation" { return "Initial version" }
        return s
    }

    private func relativeDateString(_ date: Date?) -> String {
        guard let date else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func shortLabel(forSha sha: String) -> String {
        String(sha.prefix(7))
    }
}
