//
//  LessonEditStore.swift
//  VibeCoder
//
//  Per-lesson user edits, organized into named scratchpads. Free users get
//  exactly one in-memory scratchpad called "draft" that lives for the
//  current app launch. Pro users get multiple scratchpads persisted to disk
//  across launches.
//
//  Positioning for App Review:
//    - Edits are always scoped to one of the 30 bundled lessons; there is
//      no "new project" surface. Users explore curated examples, not
//      author new apps.
//    - Edits stay on-device: in memory + Application Support (Pro) or
//      Caches (Free). Nothing leaves the phone — no upload, share, export,
//      or publish.
//

import Foundation

@MainActor
final class LessonEditStore: ObservableObject {
    static let shared = LessonEditStore()

    /// Default scratchpad name everyone starts with.
    static let defaultPadName = "draft"

    /// Top-level: [slug: [scratchpadName: [relativeFilePath: editedText]]]
    @Published private var data: [String: [String: [String: String]]] = [:]

    /// Active scratchpad per lesson. Defaults to "draft" if not set.
    @Published private var activePadBySlug: [String: String] = [:]

    private init() {
        loadFromDisk()
    }

    // MARK: - Active scratchpad

    func activePad(slug: String) -> String {
        activePadBySlug[slug] ?? Self.defaultPadName
    }

    func selectPad(slug: String, name: String) {
        activePadBySlug[slug] = name
    }

    func pads(slug: String) -> [String] {
        let names = Array((data[slug] ?? [:]).keys)
        if names.isEmpty { return [Self.defaultPadName] }
        return names.sorted()
    }

    /// Pro feature: create a new named scratchpad and switch to it.
    func createPad(slug: String, name: String) {
        var bySlug = data[slug] ?? [:]
        if bySlug[name] == nil { bySlug[name] = [:] }
        data[slug] = bySlug
        activePadBySlug[slug] = name
        persistIfPro()
    }

    /// Pro feature: delete a scratchpad. The default pad cannot be deleted
    /// — it is recreated empty if it's the last one.
    func deletePad(slug: String, name: String) {
        var bySlug = data[slug] ?? [:]
        bySlug[name] = nil
        if bySlug.isEmpty { bySlug[Self.defaultPadName] = [:] }
        data[slug] = bySlug
        if activePadBySlug[slug] == name {
            activePadBySlug[slug] = bySlug.keys.sorted().first ?? Self.defaultPadName
        }
        persistIfPro()
    }

    // MARK: - Mutations (always target the active pad)

    func setEdit(slug: String, file: String, content: String) {
        let pad = activePad(slug: slug)
        var bySlug = data[slug] ?? [:]
        var byPad = bySlug[pad] ?? [:]
        byPad[file] = content
        bySlug[pad] = byPad
        data[slug] = bySlug
        persistIfPro()
    }

    func discardEdits(slug: String) {
        let pad = activePad(slug: slug)
        var bySlug = data[slug] ?? [:]
        bySlug[pad] = [:]
        data[slug] = bySlug
        if let dir = tinkerDir(slug: slug) {
            try? FileManager.default.removeItem(at: dir)
        }
        persistIfPro()
    }

    /// Drops every scratchpad for the lesson (used by Account → Sign Out
    /// where appropriate, or by the user's explicit "clear all attempts").
    func discardAll(slug: String) {
        data[slug] = nil
        activePadBySlug[slug] = nil
        if let dir = tinkerDir(slug: slug) {
            try? FileManager.default.removeItem(at: dir)
        }
        persistIfPro()
    }

    // MARK: - Reads

    func edit(slug: String, file: String) -> String? {
        data[slug]?[activePad(slug: slug)]?[file]
    }

    func hasEdits(slug: String) -> Bool {
        !(data[slug]?[activePad(slug: slug)]?.isEmpty ?? true)
    }

    func editedFiles(slug: String) -> [String] {
        Array((data[slug]?[activePad(slug: slug)] ?? [:]).keys).sorted()
    }

    // MARK: - Materialize for preview

    func materializeIfEdited(project: CatalogProject) -> URL? {
        guard hasEdits(slug: project.slug) else { return nil }
        guard let dir = tinkerDir(slug: project.slug),
              let source = CatalogStore.shared.bundleURL(for: project) else { return nil }
        let pad = activePad(slug: project.slug)
        let edits = data[project.slug]?[pad] ?? [:]

        let fm = FileManager.default
        try? fm.removeItem(at: dir)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            for rel in CatalogStore.shared.files(in: project) {
                let dest = dir.appendingPathComponent(rel)
                try fm.createDirectory(
                    at: dest.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                if let override = edits[rel] {
                    try override.write(to: dest, atomically: true, encoding: .utf8)
                } else {
                    let src = source.appendingPathComponent(rel)
                    if fm.fileExists(atPath: src.path) {
                        try fm.copyItem(at: src, to: dest)
                    }
                }
            }
            let index = dir.appendingPathComponent("index.html")
            return fm.fileExists(atPath: index.path) ? index : nil
        } catch {
            return nil
        }
    }

    // MARK: - Persistence (Pro-gated)

    /// Saves the current edit map to Application Support if the user is on
    /// Pro. Free users' edits stay in memory and vanish at app exit.
    private func persistIfPro() {
        guard PremiumManager.shared.isPremium else { return }
        guard let url = persistedFileURL() else { return }
        let payload = PersistedState(data: data, activePads: activePadBySlug)
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(payload).write(to: url, options: [.atomic])
        } catch {
            // Silent failure — non-critical, will retry on next edit.
        }
    }

    private func loadFromDisk() {
        guard let url = persistedFileURL(),
              FileManager.default.fileExists(atPath: url.path),
              let bytes = try? Data(contentsOf: url),
              let payload = try? JSONDecoder().decode(PersistedState.self, from: bytes) else {
            return
        }
        self.data = payload.data
        self.activePadBySlug = payload.activePads
    }

    /// Public for callers that want to wipe persisted state on sign-out or
    /// "delete account."
    func wipePersistedState() {
        if let url = persistedFileURL() {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private struct PersistedState: Codable {
        var data: [String: [String: [String: String]]]
        var activePads: [String: String]
    }

    private func persistedFileURL() -> URL? {
        guard let support = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        return support
            .appendingPathComponent("VibeBuild", isDirectory: true)
            .appendingPathComponent("lesson-edits.json")
    }

    private func tinkerDir(slug: String) -> URL? {
        guard let caches = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return caches
            .appendingPathComponent("lesson-tinker", isDirectory: true)
            .appendingPathComponent(slug, isDirectory: true)
    }
}
