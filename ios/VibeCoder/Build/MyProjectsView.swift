//
//  MyProjectsView.swift
//  VibeCoder
//
//  Lists the signed-in user's generated projects. Read from
//  GET /api/projects/my, refreshes via pull-to-refresh, swipe-to-delete
//  hits DELETE /api/projects/:id. Tapping a row opens the project's
//  preview in a fullScreenCover.
//

import SwiftUI

@MainActor
final class MyProjectsModel: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case empty
        case error(String)
    }

    @Published var projects: [VBProject] = []
    @Published var state: LoadState = .idle

    private(set) var userId: String = ""

    /// True if any project is still building. Drives the auto-poll task in
    /// MyProjectsView so the "Building" badges flip to "Ready" without the
    /// user having to pull-to-refresh.
    var hasBuildingProjects: Bool {
        projects.contains { $0.status == .building }
    }

    func configure(userId: String) {
        self.userId = userId
    }

    func reload() async {
        state = .loading
        do {
            let resp = try await VibeBuildAPI.shared.fetchMyProjects(userId: userId)
            projects = resp.projects
            state = projects.isEmpty ? .empty : .loaded
        } catch let err as VBAPIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Soft-refresh without flipping into the full loading state (used by
    /// pull-to-refresh so the existing list doesn't flash empty).
    func refreshInPlace() async {
        do {
            let resp = try await VibeBuildAPI.shared.fetchMyProjects(userId: userId)
            projects = resp.projects
            state = projects.isEmpty ? .empty : .loaded
        } catch {
            // Quietly ignore on a soft refresh — the user still sees the prior list.
        }
    }

    func delete(_ project: VBProject) async -> Bool {
        do {
            try await VibeBuildAPI.shared.deleteProject(id: project.id, userId: userId)
            projects.removeAll { $0.id == project.id }
            if projects.isEmpty { state = .empty }
            return true
        } catch {
            return false
        }
    }
}

struct MyProjectsView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var model = MyProjectsModel()
    @State private var selectedProject: VBProject?
    @State private var pendingDelete: VBProject?
    @State private var deleteError: String?

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    var body: some View {
        content
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("My Projects")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .task {
                // Always refresh on appear. The previous once-per-session
                // guard left stale "Building" rows hanging around after the
                // user re-entered the view post-build.
                model.configure(userId: resolvedUserId)
                if model.projects.isEmpty {
                    await model.reload()
                } else {
                    await model.refreshInPlace()
                }
            }
            .task(id: model.hasBuildingProjects) {
                // Poll every 5s while at least one project is in `building`
                // status. The task is restarted whenever the flag flips, so
                // it self-stops as soon as the last building row turns ready.
                guard model.hasBuildingProjects else { return }
                while !Task.isCancelled, model.hasBuildingProjects {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if Task.isCancelled { return }
                    await model.refreshInPlace()
                }
            }
            .refreshable {
                await model.refreshInPlace()
            }
            .fullScreenCover(item: $selectedProject) { project in
                ProjectPreviewView(project: project) { selectedProject = nil }
            }
            .alert(
                "Delete \"\(pendingDelete?.title ?? "project")\"?",
                isPresented: Binding(
                    get: { pendingDelete != nil },
                    set: { if !$0 { pendingDelete = nil } }
                ),
                presenting: pendingDelete
            ) { project in
                Button("Delete", role: .destructive) {
                    Task {
                        let ok = await model.delete(project)
                        if !ok { deleteError = "Couldn't delete that project. Try again." }
                        pendingDelete = nil
                    }
                }
                Button("Cancel", role: .cancel) { pendingDelete = nil }
            } message: { _ in
                Text("This can't be undone.")
            }
            .alert("Delete failed",
                   isPresented: Binding(get: { deleteError != nil },
                                        set: { if !$0 { deleteError = nil } })) {
                Button("OK") { deleteError = nil }
            } message: {
                Text(deleteError ?? "")
            }
    }

    // MARK: - Sections

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .loading:
            ProgressView()
                .tint(accent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .empty:
            emptyState
        case .error(let msg):
            errorState(msg)
        case .loaded:
            projectList
        }
    }

    private var projectList: some View {
        List {
            ForEach(model.projects) { project in
                Button {
                    selectedProject = project
                } label: {
                    ProjectRow(project: project)
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.white.opacity(0.04))
                .listRowSeparatorTint(.white.opacity(0.08))
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        pendingDelete = project
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 36))
                .foregroundColor(.white.opacity(0.4))
            Text("No projects yet")
                .font(.headline)
                .foregroundColor(.white)
            Text("Tap Build to make your first one.")
                .font(.footnote)
                .foregroundColor(.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 30))
                .foregroundColor(.red.opacity(0.85))
            Text(message)
                .font(.footnote)
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task { await model.reload() }
            }
            .foregroundColor(accent)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var resolvedUserId: String {
        BuildIdentity.resolve(authManager: authManager)
    }
}

// MARK: - Row

private struct ProjectRow: View {
    let project: VBProject

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)
    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            VStack(alignment: .leading, spacing: 4) {
                Text(project.title ?? "Untitled")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)

                if let prompt = project.initialPrompt, !prompt.isEmpty {
                    Text(prompt)
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.55))
                        .lineLimit(2)
                }

                HStack(spacing: 6) {
                    statusBadge
                    if let created = project.createdAt {
                        Text("·").foregroundColor(.white.opacity(0.3))
                        Text(Self.dateFormatter.string(from: created))
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.45))
                    }
                }
                .padding(.top, 2)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.white.opacity(0.25))
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var thumbnail: some View {
        let placeholder = RoundedRectangle(cornerRadius: 10)
            .fill(Color.white.opacity(0.08))
            .frame(width: 56, height: 56)
            .overlay(Image(systemName: "sparkles")
                .foregroundColor(accent.opacity(0.7)))

        if let url = project.thumbnailUrl {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    img.resizable().scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                default:
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch project.status {
        case .building:
            HStack(spacing: 4) {
                ProgressView().scaleEffect(0.5).tint(accent)
                Text("Building")
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(accent)
        case .ready:
            Text("Ready")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.green.opacity(0.8))
        case .failed:
            Text("Failed")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.red.opacity(0.85))
        case .unknown:
            EmptyView()
        }
    }
}
