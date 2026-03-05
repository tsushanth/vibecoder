import SwiftUI

struct ReplitStyleAppsView: View {
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var generationManager: ProjectGenerationManager
    @State private var projects: [AppCardItem] = []
    @State private var isLoading = false
    @State private var selectedBundleDir: URL?
    @State private var selectedBundleBase64: String?
    @State private var selectedTitle: String = ""
    @State private var selectedPrompt: String = ""
    @State private var showPreview = false
    @State private var loadingProjectId: String?
    @State private var projectToDelete: AppCardItem?
    @State private var showDeleteConfirm = false
    @State private var domainProjectId: String?
    @State private var showDomainSheet = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 0) {
                    // All Projects header
                    HStack {
                        Image(systemName: "folder")
                            .foregroundColor(.white.opacity(0.7))
                        Text("My Projects")
                            .font(.headline)
                            .foregroundColor(.white)
                        Spacer()
                    }
                    .padding()
                    .background(Color(white: 0.1))

                    Divider()
                        .background(Color.white.opacity(0.1))

                    // Project cards
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                            .padding(.top, 100)
                    } else if projects.isEmpty {
                        emptyStateView
                    } else {
                        LazyVStack(spacing: 16) {
                            ForEach(projects) { project in
                                Button {
                                    openProject(project)
                                } label: {
                                    AppCardItemView(
                                        project: project,
                                        isLoadingThis: loadingProjectId == project.id
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    if project.publishedUrl != nil {
                                        Button {
                                            domainProjectId = project.id
                                            showDomainSheet = true
                                        } label: {
                                            Label("Custom Domain", systemImage: "globe")
                                        }
                                    }

                                    Button(role: .destructive) {
                                        projectToDelete = project
                                        showDeleteConfirm = true
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: loadProjects) {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(.white)
                    }
                }
            }
            .onAppear {
                loadProjects()
            }
        }
        .alert("Delete Project", isPresented: $showDeleteConfirm, presenting: projectToDelete) { item in
            Button("Delete", role: .destructive) {
                deleteProject(item)
            }
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text("Are you sure you want to delete \"\(item.title)\"? This cannot be undone.")
        }
        .sheet(isPresented: $showDomainSheet) {
            if let projectId = domainProjectId {
                CustomDomainView(projectId: projectId)
                    .environmentObject(authManager)
            }
        }
        .fullScreenCover(isPresented: $showPreview) {
            if let bundleDir = selectedBundleDir {
                LivePreviewView(
                    bundleDir: bundleDir,
                    bundleBase64: selectedBundleBase64,
                    projectTitle: selectedTitle,
                    initialPrompt: selectedPrompt,
                    isExistingProject: true
                )
                .environmentObject(generationManager)
                .environmentObject(authManager)
            }
        }
    }

    private func openProject(_ item: AppCardItem) {
        guard loadingProjectId == nil else { return }
        loadingProjectId = item.id

        Task {
            do {
                let response = try await NetworkManager.shared.getProject(id: item.id)
                let project = response.project

                // Extract bundle to a temp directory
                guard let bundleData = Data(base64Encoded: project.bundle) else {
                    throw NSError(domain: "ReplitStyleAppsView", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid bundle data"])
                }

                let tmpDir = FileManager.default.temporaryDirectory
                    .appendingPathComponent("vibecoder-preview-\(item.id)")
                try? FileManager.default.removeItem(at: tmpDir)
                try ZipExtractor.extract(data: bundleData, to: tmpDir)

                // GitHub zipballs wrap files in a subfolder — find the actual bundle root
                var bundleRoot = tmpDir
                let fm = FileManager.default
                if let contents = try? fm.contentsOfDirectory(at: tmpDir, includingPropertiesForKeys: [.isDirectoryKey]) {
                    for item in contents {
                        let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                        if isDir && fm.fileExists(atPath: item.appendingPathComponent("index.html").path) {
                            bundleRoot = item
                            break
                        }
                    }
                }

                await MainActor.run {
                    selectedBundleDir = bundleRoot
                    selectedBundleBase64 = project.bundle
                    selectedTitle = project.title
                    selectedPrompt = project.description ?? ""
                    loadingProjectId = nil
                    showPreview = true
                }
            } catch {
                print("[openProject] Error: \(error)")
                await MainActor.run {
                    loadingProjectId = nil
                }
            }
        }
    }

    private func deleteProject(_ item: AppCardItem) {
        Task {
            do {
                let userId = authManager.userId ?? UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
                try await NetworkManager.shared.deleteProject(id: item.id, userId: userId)
                await MainActor.run {
                    projects.removeAll { $0.id == item.id }
                }
            } catch {
                print("[deleteProject] Error: \(error)")
            }
        }
    }

    private func loadProjects() {
        guard !isLoading else { return }
        isLoading = true

        Task {
            do {
                let userId = authManager.userId ?? UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
                let response = try await NetworkManager.shared.loadMyProjects(userId: userId)

                await MainActor.run {
                    projects = response.projects.map { summary in
                        AppCardItem(
                            id: summary.id,
                            title: summary.title,
                            creatorName: summary.creatorName,
                            isPublic: summary.isPublic,
                            thumbnailURL: summary.thumbnailUrl,
                            icon: "app.badge",
                            publishedUrl: summary.publishedUrl
                        )
                    }
                    isLoading = false
                }
            } catch {
                print("Error loading projects: \(error)")
                await MainActor.run {
                    isLoading = false
                }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "chevron.left.forwardslash.chevron.right")
                .font(.system(size: 60))
                .foregroundColor(.white.opacity(0.3))

            Text("No projects yet")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(.white)

            Text("Create your first coding project to see it here")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.6))

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
    }
}

struct AppCardItemView: View {
    let project: AppCardItem
    var isLoadingThis: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Preview/Thumbnail
            ZStack {
                Rectangle()
                    .fill(Color(white: 0.15))
                    .aspectRatio(16/9, contentMode: .fit)

                if let thumbnail = project.thumbnailURL {
                    AsyncImage(url: URL(string: thumbnail)) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        ProgressView()
                            .tint(.white.opacity(0.5))
                    }
                } else {
                    Image(systemName: project.icon)
                        .font(.system(size: 48))
                        .foregroundColor(.white.opacity(0.3))
                }

                if isLoadingThis {
                    Color.black.opacity(0.5)
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.5)
                }
            }
            .clipped()

            // Info
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(project.title)
                        .font(.headline)
                        .foregroundColor(.white)

                    Spacer()
                }

                Text(project.creatorName)
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.6))

                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Image(systemName: project.isPublic ? "globe" : "lock.fill")
                            .font(.caption)
                        Text(project.isPublic ? "Public" : "Private")
                            .font(.caption)
                    }
                    .foregroundColor(.white.opacity(0.5))

                    if let customDomain = project.customDomain {
                        HStack(spacing: 3) {
                            Image(systemName: "globe.americas.fill")
                                .font(.caption2)
                            Text(customDomain)
                                .font(.caption2)
                        }
                        .foregroundColor(.green)
                    } else if project.publishedUrl != nil {
                        HStack(spacing: 3) {
                            Image(systemName: "link")
                                .font(.caption2)
                            Text("Shared")
                                .font(.caption2)
                        }
                        .foregroundColor(.blue)
                    }
                }
            }
            .padding(12)
            .background(Color(white: 0.08))
        }
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
    }
}

// MARK: - Model

struct AppCardItem: Identifiable {
    let id: String
    let title: String
    let creatorName: String
    let isPublic: Bool
    let thumbnailURL: String?
    let icon: String
    var publishedUrl: String?
    var customDomain: String?

    static let examples: [AppCardItem] = [
        AppCardItem(id: "1", title: "Memory Match", creatorName: "SushanthTiruvai", isPublic: false, thumbnailURL: nil, icon: "gamecontroller.fill", publishedUrl: nil, customDomain: nil),
        AppCardItem(id: "2", title: "Weather App", creatorName: "SushanthTiruvai", isPublic: true, thumbnailURL: nil, icon: "cloud.sun.fill", publishedUrl: "https://weather.vibebuild.cc", customDomain: nil)
    ]
}

#Preview {
    ReplitStyleAppsView()
        .environmentObject(AuthManager.shared)
        .environmentObject(ProjectGenerationManager.shared)
}
