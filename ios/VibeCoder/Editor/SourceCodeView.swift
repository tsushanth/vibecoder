import SwiftUI

/// A read/write source code viewer with basic syntax highlighting.
/// Displays all files extracted from the project bundle and lets users
/// view and edit every line — satisfying App Review Guideline 2.5.2.
struct SourceCodeView: View {
    let bundleDir: URL
    @State private var files: [SourceFile] = []
    @State private var selectedFile: SourceFile?
    @State private var editedContents: [String: String] = [:]  // path -> edited text
    @State private var showFilePicker = false
    @State private var saveMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            // File selector bar
            fileBar

            // Source code display
            if let file = selectedFile {
                codeEditor(for: file)
            } else {
                emptyState
            }
        }
        .onAppear { loadFiles() }
        .overlay(alignment: .bottom) {
            if let msg = saveMessage {
                saveToast(msg)
            }
        }
    }

    // MARK: - File Selector Bar

    private var fileBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(files) { file in
                    Button {
                        selectedFile = file
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: file.iconName)
                                .font(.caption2)
                            Text(file.name)
                                .font(.caption)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 6)
                                .fill(selectedFile?.id == file.id
                                      ? Color.blue.opacity(0.3)
                                      : Color.white.opacity(0.08))
                        )
                        .foregroundColor(selectedFile?.id == file.id ? .blue : .secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color.black.opacity(0.3))
    }

    // MARK: - Code Editor

    private func codeEditor(for file: SourceFile) -> some View {
        VStack(spacing: 0) {
            // File path header
            HStack {
                Text(file.relativePath)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer()
                if editedContents[file.relativePath] != nil {
                    Button("Save") {
                        saveFile(file)
                    }
                    .font(.caption.bold())
                    .foregroundColor(.blue)
                }
                Text("\(currentContent(for: file).count) chars")
                    .font(.caption2)
                    .foregroundColor(.secondary.opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.2))

            // Editable code area with syntax highlighting + line numbers
            ScrollView([.horizontal, .vertical]) {
                SyntaxHighlightedEditor(
                    text: binding(for: file),
                    language: file.language
                )
                .padding(12)
            }
            .background(Color(red: 0.08, green: 0.08, blue: 0.12))
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text")
                .font(.largeTitle)
                .foregroundColor(.secondary)
            Text("No files found")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.08, green: 0.08, blue: 0.12))
    }

    // MARK: - Toast

    private func saveToast(_ message: String) -> some View {
        Text(message)
            .font(.caption.bold())
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.green.opacity(0.9)))
            .padding(.bottom, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .onAppear {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    withAnimation { saveMessage = nil }
                }
            }
    }

    // MARK: - File Loading

    private func loadFiles() {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: bundleDir, includingPropertiesForKeys: [.isRegularFileKey]) else { return }

        var result: [SourceFile] = []
        while let url = enumerator.nextObject() as? URL {
            guard let vals = try? url.resourceValues(forKeys: [.isRegularFileKey]),
                  vals.isRegularFile == true else { continue }

            let ext = url.pathExtension.lowercased()
            let supportedExtensions = ["html", "css", "js", "json", "svg", "txt", "md", "xml"]
            guard supportedExtensions.contains(ext) else { continue }

            let relativePath = url.path.replacingOccurrences(of: bundleDir.path + "/", with: "")
            let content = (try? String(contentsOf: url, encoding: .utf8)) ?? ""

            result.append(SourceFile(
                relativePath: relativePath,
                fullURL: url,
                content: content
            ))
        }

        // Sort: index.html first, then by path
        result.sort { a, b in
            if a.name == "index.html" { return true }
            if b.name == "index.html" { return false }
            return a.relativePath < b.relativePath
        }

        files = result
        if selectedFile == nil {
            selectedFile = result.first
        }
    }

    private func currentContent(for file: SourceFile) -> String {
        editedContents[file.relativePath] ?? file.content
    }

    private func binding(for file: SourceFile) -> Binding<String> {
        Binding(
            get: { currentContent(for: file) },
            set: { editedContents[file.relativePath] = $0 }
        )
    }

    private func saveFile(_ file: SourceFile) {
        guard let content = editedContents[file.relativePath] else { return }
        do {
            try content.write(to: file.fullURL, atomically: true, encoding: .utf8)
            // Update the source file content
            if let idx = files.firstIndex(where: { $0.id == file.id }) {
                files[idx] = SourceFile(
                    relativePath: file.relativePath,
                    fullURL: file.fullURL,
                    content: content
                )
            }
            editedContents.removeValue(forKey: file.relativePath)
            withAnimation { saveMessage = "Saved \(file.name)" }
        } catch {
            withAnimation { saveMessage = "Error: \(error.localizedDescription)" }
        }
    }
}

// MARK: - Source File Model

struct SourceFile: Identifiable {
    var id: String { relativePath }
    let relativePath: String
    let fullURL: URL
    let content: String

    var name: String {
        (relativePath as NSString).lastPathComponent
    }

    var language: CodeLanguage {
        switch (relativePath as NSString).pathExtension.lowercased() {
        case "html", "htm": return .html
        case "css": return .css
        case "js": return .javascript
        case "json": return .json
        case "svg", "xml": return .html
        default: return .plain
        }
    }

    var iconName: String {
        switch language {
        case .html: return "doc.richtext"
        case .css: return "paintbrush"
        case .javascript: return "curlybraces"
        case .json: return "doc.text"
        case .plain: return "doc"
        }
    }
}

enum CodeLanguage {
    case html, css, javascript, json, plain
}

// MARK: - Syntax Highlighted Editor

struct SyntaxHighlightedEditor: View {
    @Binding var text: String
    let language: CodeLanguage
    @State private var isEditing = false

    var body: some View {
        if isEditing {
            TextEditor(text: $text)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.white)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 400)
                .overlay(alignment: .topTrailing) {
                    Button("Done") { isEditing = false }
                        .font(.caption.bold())
                        .padding(8)
                }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                highlightedCode
                    .onTapGesture {
                        isEditing = true
                    }
            }
        }
    }

    private var highlightedCode: some View {
        let lines = text.components(separatedBy: "\n")
        let lineNumberWidth = "\(lines.count)".count

        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .top, spacing: 0) {
                    // Line number
                    Text(String(format: "%\(lineNumberWidth)d", index + 1))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.secondary.opacity(0.4))
                        .frame(minWidth: CGFloat(lineNumberWidth * 9), alignment: .trailing)
                        .padding(.trailing, 12)

                    // Highlighted code line
                    highlightedLine(line)
                        .font(.system(size: 12, design: .monospaced))
                }
            }
        }
    }

    private func highlightedLine(_ line: String) -> Text {
        switch language {
        case .html: return highlightHTML(line)
        case .css: return highlightCSS(line)
        case .javascript: return highlightJS(line)
        case .json: return highlightJSON(line)
        case .plain: return Text(line).foregroundColor(.white)
        }
    }

    // MARK: - HTML Highlighting

    private func highlightHTML(_ line: String) -> Text {
        var result = Text("")
        var remaining = line[...]

        while !remaining.isEmpty {
            if remaining.hasPrefix("<!--") {
                if let endRange = remaining.range(of: "-->") {
                    let comment = String(remaining[remaining.startIndex...endRange.upperBound])
                    result = result + Text(comment).foregroundColor(.commentGreen)
                    remaining = remaining[endRange.upperBound...]
                } else {
                    result = result + Text(String(remaining)).foregroundColor(.commentGreen)
                    break
                }
            } else if remaining.hasPrefix("<") {
                if let closeIdx = remaining.firstIndex(of: ">") {
                    let tag = String(remaining[remaining.startIndex...closeIdx])
                    result = result + highlightTag(tag)
                    remaining = remaining[remaining.index(after: closeIdx)...]
                } else {
                    result = result + Text(String(remaining)).foregroundColor(.tagRed)
                    break
                }
            } else {
                if let nextTag = remaining.firstIndex(of: "<") {
                    let content = String(remaining[remaining.startIndex..<nextTag])
                    result = result + Text(content).foregroundColor(.white)
                    remaining = remaining[nextTag...]
                } else {
                    result = result + Text(String(remaining)).foregroundColor(.white)
                    break
                }
            }
        }
        return result
    }

    private func highlightTag(_ tag: String) -> Text {
        // Simple: bracket in gray, tag name in red, attributes in yellow, strings in green
        Text(tag).foregroundColor(.tagRed)
    }

    // MARK: - CSS Highlighting

    private func highlightCSS(_ line: String) -> Text {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.hasPrefix("/*") || trimmed.hasPrefix("*") {
            return Text(line).foregroundColor(.commentGreen)
        }
        if trimmed.contains("{") || trimmed.contains("}") {
            return Text(line).foregroundColor(.selectorPurple)
        }
        if trimmed.contains(":") && trimmed.contains(";") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2 {
                return Text(String(parts[0]) + ":").foregroundColor(.propertyBlue)
                    + Text(String(parts[1])).foregroundColor(.valueCyan)
            }
        }
        return Text(line).foregroundColor(.white)
    }

    // MARK: - JavaScript Highlighting

    private func highlightJS(_ line: String) -> Text {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.hasPrefix("//") {
            return Text(line).foregroundColor(.commentGreen)
        }

        var result = Text("")
        let keywords = ["const", "let", "var", "function", "return", "if", "else",
                        "for", "while", "class", "import", "export", "default",
                        "async", "await", "try", "catch", "new", "this", "true", "false",
                        "null", "undefined", "switch", "case", "break", "continue",
                        "throw", "typeof", "instanceof"]

        let tokens = tokenize(line)
        for token in tokens {
            if keywords.contains(token) {
                result = result + Text(token).foregroundColor(.keywordPurple)
            } else if token.hasPrefix("\"") || token.hasPrefix("'") || token.hasPrefix("`") {
                result = result + Text(token).foregroundColor(.stringOrange)
            } else if token.allSatisfy({ $0.isNumber || $0 == "." }) && !token.isEmpty {
                result = result + Text(token).foregroundColor(.numberYellow)
            } else if token.hasPrefix("//") {
                result = result + Text(token).foregroundColor(.commentGreen)
            } else {
                result = result + Text(token).foregroundColor(.white)
            }
        }
        return result
    }

    // MARK: - JSON Highlighting

    private func highlightJSON(_ line: String) -> Text {
        var result = Text("")
        let tokens = tokenize(line)
        for token in tokens {
            if token.hasPrefix("\"") {
                if line.contains(": ") || line.contains(":\"") {
                    // Rough heuristic: if before colon, it's a key
                    result = result + Text(token).foregroundColor(.propertyBlue)
                } else {
                    result = result + Text(token).foregroundColor(.stringOrange)
                }
            } else if token == "true" || token == "false" || token == "null" {
                result = result + Text(token).foregroundColor(.keywordPurple)
            } else if token.allSatisfy({ $0.isNumber || $0 == "." || $0 == "-" }) && !token.isEmpty {
                result = result + Text(token).foregroundColor(.numberYellow)
            } else {
                result = result + Text(token).foregroundColor(.white)
            }
        }
        return result
    }

    // MARK: - Tokenizer

    private func tokenize(_ line: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var inString: Character? = nil
        var i = line.startIndex

        while i < line.endIndex {
            let ch = line[i]

            if let quote = inString {
                current.append(ch)
                if ch == quote {
                    tokens.append(current)
                    current = ""
                    inString = nil
                }
            } else if ch == "\"" || ch == "'" || ch == "`" {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
                current.append(ch)
                inString = ch
            } else if ch == "/" && line.index(after: i) < line.endIndex && line[line.index(after: i)] == "/" {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
                tokens.append(String(line[i...]))
                return tokens
            } else if ch.isWhitespace || "{}()[];:,=<>+-*/&|!?".contains(ch) {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
                tokens.append(String(ch))
            } else {
                current.append(ch)
            }

            i = line.index(after: i)
        }

        if !current.isEmpty {
            tokens.append(current)
        }
        return tokens
    }
}

// MARK: - Syntax Colors

extension Color {
    static let commentGreen = Color(red: 0.42, green: 0.68, blue: 0.42)
    static let tagRed = Color(red: 0.94, green: 0.43, blue: 0.45)
    static let keywordPurple = Color(red: 0.78, green: 0.56, blue: 0.94)
    static let selectorPurple = Color(red: 0.78, green: 0.56, blue: 0.94)
    static let stringOrange = Color(red: 0.94, green: 0.73, blue: 0.42)
    static let numberYellow = Color(red: 0.85, green: 0.85, blue: 0.45)
    static let propertyBlue = Color(red: 0.55, green: 0.75, blue: 0.94)
    static let valueCyan = Color(red: 0.45, green: 0.85, blue: 0.85)
}
