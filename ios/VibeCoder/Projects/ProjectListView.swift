import SwiftUI

struct ProjectListView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading projects...")
                } else if projects.isEmpty {
                    emptyState
                } else {
                    projectsList
                }
            }
            .navigationTitle("My Projects")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await loadProjects() } }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .task {
                await loadProjects()
            }
            .alert("Error", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("No Projects Yet")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Create your first web project using AI")
                .font(.subheadline)
                .foregroundColor(.secondary)

            NavigationLink(destination: Text("Create")) {
                Label("Create Project", systemImage: "wand.and.stars")
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
        }
        .padding()
    }

    private var projectsList: some View {
        List {
            ForEach(projects) { project in
                NavigationLink(destination: ProjectDetailView(project: project)) {
                    ProjectRow(project: project)
                }
            }
            .onDelete(perform: deleteProjects)
        }
        .refreshable {
            await loadProjects()
        }
    }

    private func loadProjects() async {
        guard let userId = authManager.userId else { return }

        isLoading = true
        errorMessage = nil

        do {
            let response: ProjectsResponse = try await NetworkManager.shared.request(
                path: "/api/projects/my?userId=\(userId)",
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

    private func deleteProjects(at offsets: IndexSet) {
        for index in offsets {
            let project = projects[index]
            Task {
                await deleteProject(project.id)
            }
        }
    }

    private func deleteProject(_ projectId: String) async {
        guard let userId = authManager.userId else { return }

        do {
            let _: EmptyResponse = try await NetworkManager.shared.request(
                path: "/api/projects/\(projectId)",
                method: "DELETE",
                body: ["userId": userId]
            )

            await MainActor.run {
                projects.removeAll { $0.id == projectId }
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct ProjectRow: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(project.title)
                .font(.headline)

            if let description = project.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            HStack {
                if !project.isPublic {
                    Label("Private", systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Text(relativeDate(from: project.createdAt))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func relativeDate(from dateString: String?) -> String {
        guard let dateString = dateString,
              let date = ISO8601DateFormatter().date(from: dateString) else {
            return "Unknown"
        }

        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct ProjectDetailView: View {
    let project: Project

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(project.title)
                    .font(.title)
                    .fontWeight(.bold)

                if let description = project.description {
                    Text(description)
                        .foregroundColor(.secondary)
                }

                // TODO: Add preview, edit code, deploy buttons
            }
            .padding()
        }
        .navigationTitle("Project Details")
    }
}

// MARK: - Response Models

struct ProjectsResponse: Codable {
    let success: Bool
    let projects: [Project]
}

struct EmptyResponse: Codable {
    let success: Bool
}

#Preview {
    ProjectListView()
        .environmentObject(AuthManager.shared)
}
