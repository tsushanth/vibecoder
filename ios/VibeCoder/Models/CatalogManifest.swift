//
//  CatalogManifest.swift
//  VibeCoder
//
//  Decodes the catalog.json manifest shipped in the app bundle and exposes
//  the curated lessons as a typed model.
//
//  The catalog is FROZEN at build time — there is no network fetch and no
//  way to add or modify lessons at runtime. Lessons only change when a new
//  version of the app ships through full App Review.
//

import Foundation

struct CatalogManifest: Decodable {
    let version: Int
    let projects: [CatalogProject]
}

struct CatalogProject: Identifiable, Decodable, Hashable {
    let id: String
    let slug: String
    let title: String
    let creator: String
    let difficulty: String
    let category: String
    let learn: [String]
    let fileCount: Int
    let description: String
    let githubRepo: String?
}

enum Difficulty: String, CaseIterable, Identifiable {
    case beginner = "Beginner"
    case intermediate = "Intermediate"
    case advanced = "Advanced"
    var id: String { rawValue }
}

@MainActor
final class CatalogStore: ObservableObject {
    static let shared = CatalogStore()

    @Published private(set) var projects: [CatalogProject] = []
    @Published private(set) var loadError: String?

    private init() { load() }

    func load() {
        guard let url = Bundle.main.url(forResource: "catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            loadError = "Catalog missing from app bundle."
            return
        }
        do {
            let manifest = try JSONDecoder().decode(CatalogManifest.self, from: data)
            self.projects = manifest.projects
        } catch {
            loadError = "Could not read catalog: \(error.localizedDescription)"
        }
    }

    func projects(in difficulty: Difficulty) -> [CatalogProject] {
        projects.filter { $0.difficulty == difficulty.rawValue }
    }

    /// On-disk URL of a project's static bundle folder, inside the app bundle.
    /// The folder is added as a Folder Reference to the Xcode project so the
    /// whole `projects/<slug>/` tree is copied verbatim into the .app.
    func bundleURL(for project: CatalogProject) -> URL? {
        guard let projectsRoot = Bundle.main.url(forResource: "projects", withExtension: nil) else {
            return nil
        }
        return projectsRoot.appendingPathComponent(project.slug, isDirectory: true)
    }

    /// Lists every file in a project's bundle as relative paths.
    func files(in project: CatalogProject) -> [String] {
        guard let root = bundleURL(for: project),
              let enumerator = FileManager.default.enumerator(at: root,
                                                              includingPropertiesForKeys: nil,
                                                              options: [.skipsHiddenFiles]) else {
            return []
        }
        var out: [String] = []
        for case let url as URL in enumerator where !url.hasDirectoryPath {
            let rel = url.path.replacingOccurrences(of: root.path + "/", with: "")
            out.append(rel)
        }
        return out.sorted()
    }
}
