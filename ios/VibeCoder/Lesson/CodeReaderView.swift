//
//  CodeReaderView.swift
//  VibeCoder
//
//  Read-only-by-default multi-file code viewer. The user can tap "Edit"
//  to modify a LOCAL copy of the file (kept in memory only; never uploaded
//  anywhere) and see their changes reflected in the Sandboxed Preview.
//
//  This satisfies Apple's 2.5.2 educational exception: "Such apps must
//  make the source code provided by the app completely viewable and
//  editable by the user."
//

import SwiftUI

@MainActor
final class CodeReaderStore: ObservableObject {
    @Published var files: [String] = []
    @Published var selected: String?
    @Published var content: String = ""

    let project: CatalogProject

    init(project: CatalogProject) {
        self.project = project
        load()
    }

    /// Indicates which files have user edits. Read from the shared
    /// LessonEditStore so it stays in sync across CodeReader presentations
    /// and the Sandboxed Preview.
    var editedFiles: Set<String> {
        Set(LessonEditStore.shared.editedFiles(slug: project.slug))
    }

    private func load() {
        files = CatalogStore.shared.files(in: project)
        if let first = files.first { selectFile(first) }
    }

    func selectFile(_ rel: String) {
        selected = rel
        if let override = LessonEditStore.shared.edit(slug: project.slug, file: rel) {
            content = override
            return
        }
        guard let root = CatalogStore.shared.bundleURL(for: project) else { content = ""; return }
        let url = root.appendingPathComponent(rel)
        content = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    func saveEdit(_ newText: String) {
        guard let rel = selected else { return }
        LessonEditStore.shared.setEdit(slug: project.slug, file: rel, content: newText)
        content = newText
    }
}

struct CodeReaderView: View {
    let project: CatalogProject
    @Environment(\.dismiss) private var dismiss
    @StateObject private var store: CodeReaderStore
    @ObservedObject private var edits = LessonEditStore.shared
    @State private var editing = false
    @State private var editingBuffer: String = ""

    init(project: CatalogProject) {
        self.project = project
        _store = StateObject(wrappedValue: CodeReaderStore(project: project))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                fileTabs
                Divider().background(Color.white.opacity(0.1))
                codeBody
            }
            .background(Color.black.ignoresSafeArea())
            .preferredColorScheme(.dark)
            .navigationTitle(project.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(editing ? "Done" : "Edit") {
                        if editing {
                            store.saveEdit(editingBuffer)
                            editing = false
                        } else {
                            editingBuffer = store.content
                            editing = true
                        }
                    }
                    .disabled(store.selected == nil)
                }
            }
        }
    }

    private var fileTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(store.files, id: \.self) { rel in
                    Button {
                        editing = false
                        store.selectFile(rel)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: iconForFile(rel))
                                .font(.caption2)
                            Text(rel)
                                .font(.caption.monospaced())
                            if edits.edit(slug: project.slug, file: rel) != nil {
                                Image(systemName: "pencil.circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .foregroundStyle(store.selected == rel ? .black : .white)
                        .background(
                            Capsule().fill(store.selected == rel ? Color.white : Color.white.opacity(0.10))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color.white.opacity(0.03))
    }

    private var codeBody: some View {
        Group {
            if editing {
                TextEditor(text: $editingBuffer)
                    .font(.system(size: 13, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .background(Color.black)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
            } else {
                ScrollView([.horizontal, .vertical]) {
                    Text(store.content)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.92))
                        .textSelection(.enabled)
                        .multilineTextAlignment(.leading)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.black)
            }
        }
    }

    private func iconForFile(_ name: String) -> String {
        if name.hasSuffix(".html") { return "doc.text" }
        if name.hasSuffix(".css") { return "paintbrush" }
        if name.hasSuffix(".js") { return "curlybraces" }
        if name.hasSuffix(".json") { return "list.bullet.rectangle" }
        return "doc"
    }
}
