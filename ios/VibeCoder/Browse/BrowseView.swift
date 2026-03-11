import SwiftUI

struct BrowseView: View {
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var sortOption: SortOption = .newest

    enum SortOption: String, CaseIterable {
        case newest = "Newest"
        case popular = "Popular"
    }

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading projects...")
                } else if projects.isEmpty {
                    emptyState
                } else {
                    projectsGrid
                }
            }
            .navigationTitle("Explore")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Picker("Sort", selection: $sortOption) {
                            ForEach(SortOption.allCases, id: \.self) { option in
                                Text(option.rawValue).tag(option)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                }
            }
            .task {
                await loadProjects()
            }
            .onChange(of: sortOption) { _ in
                Task { await loadProjects() }
            }
            .refreshable {
                await loadProjects()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            Image(systemName: "globe")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("No Projects Yet")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Be the first to create and share")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .padding()
    }

    private var projectsGrid: some View {
        ScrollView {
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 16) {
                ForEach(projects) { project in
                    NavigationLink(destination: BrowseProjectDetailView(project: project)) {
                        ProjectCard(project: project)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
            .padding()
        }
    }

    private func loadProjects() async {
        isLoading = true
        errorMessage = nil

        do {
            let sort = sortOption == .newest ? "newest" : "popular"
            let response: BrowseResponse = try await NetworkManager.shared.request(
                path: "/api/projects/browse?sort=\(sort)&limit=50",
                method: "GET"
            )

            await MainActor.run {
                projects = response.projects
                isLoading = false
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }
}

struct ProjectCard: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Placeholder preview image
            Rectangle()
                .fill(LinearGradient(
                    colors: [.blue.opacity(0.3), .purple.opacity(0.3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .aspectRatio(16/9, contentMode: .fit)
                .cornerRadius(12)
                .overlay(
                    Image(systemName: "globe")
                        .font(.system(size: 40))
                        .foregroundColor(.white.opacity(0.7))
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(project.title)
                    .font(.headline)
                    .lineLimit(2)
                    .foregroundColor(.primary)

                if let creator = project.creatorName {
                    Text("by \(creator)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                HStack(spacing: 12) {
                    Label("\(project.playCount)", systemImage: "eye")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if project.forkCount > 0 {
                        Label("\(project.forkCount)", systemImage: "arrow.triangle.branch")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
    }
}

struct BrowseProjectDetailView: View {
    let project: Project
    @EnvironmentObject var authManager: AuthManager
    @EnvironmentObject var subscriptionManager: SubscriptionManager
    @State private var showForkConfirmation = false

    var body: some View {
        VStack {
            // Show web project details
            Text("Web Project: \(project.title)")
                .font(.title2)

            Spacer()

            HStack(spacing: 20) {
                Button(action: { showForkConfirmation = true }) {
                    Label("Remix (10 coins)", systemImage: "arrow.triangle.branch")
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }

                Button(action: {}) {
                    Label("View Code", systemImage: "chevron.left.slash.chevron.right")
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.gray.opacity(0.2))
                        .foregroundColor(.primary)
                        .cornerRadius(12)
                }
            }
            .padding()
        }
        .navigationTitle(project.title)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Remix Project", isPresented: $showForkConfirmation) {
            Button("Remix for 10 coins") {
                Task { await forkProject() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Create your own copy of this web project to customize")
        }
    }

    private func forkProject() async {
        // TODO: Implement fork logic
    }
}

struct BrowseResponse: Codable {
    let success: Bool
    let projects: [Project]
    let totalCount: Int
    let hasMore: Bool
}

#Preview {
    BrowseView()
}
