//
//  LessonDetailView.swift
//  VibeCoder
//
//  Detail screen for a single curated lesson. Shows what the user will
//  learn, then offers two actions: View Source (read-only code reader)
//  and Run Preview (sandboxed WKWebView).
//

import SwiftUI

struct LessonDetailView: View {
    let project: CatalogProject

    @State private var showCode = false
    @State private var showPreview = false
    @State private var showPaywall = false
    @State private var paywallTrigger = "lesson_detail"
    @State private var newPadName = ""
    @State private var showCreatePadAlert = false
    @ObservedObject private var edits = LessonEditStore.shared
    @ObservedObject private var premium = PremiumManager.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero
                learningObjectives
                actionButtons
                if edits.hasEdits(slug: project.slug) {
                    tinkerBanner
                }
                scratchpadsSection
                if !project.description.isEmpty {
                    sourcePrompt
                }
                disclosure
                Spacer(minLength: 40)
            }
            .padding()
        }
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $showCode) {
            CodeReaderView(project: project)
        }
        .fullScreenCover(isPresented: $showPreview) {
            SandboxedPreviewView(project: project)
        }
        .fullScreenCover(isPresented: $showPaywall) {
            RemotePaywallView(triggerSource: paywallTrigger)
        }
        .alert("Name this attempt", isPresented: $showCreatePadAlert) {
            TextField("e.g. with red header", text: $newPadName)
            Button("Cancel", role: .cancel) { newPadName = "" }
            Button("Create") {
                let trimmed = newPadName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    edits.createPad(slug: project.slug, name: trimmed)
                }
                newPadName = ""
            }
        } message: {
            Text("Each attempt keeps its own edits. Switch between them anytime.")
        }
    }

    private func showPaywall(_ trigger: String) {
        paywallTrigger = trigger
        showPaywall = true
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                badge(project.difficulty, color: difficultyColor)
                badge(project.category, color: .white.opacity(0.15))
            }
            Text(project.title)
                .font(.title.bold())
                .foregroundStyle(.white)
            Text("Created by \(project.creator)")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.55))
        }
    }

    private var learningObjectives: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What you'll learn")
                .font(.headline)
                .foregroundStyle(.white)
            ForEach(project.learn, id: \.self) { item in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.subheadline)
                    Text(item)
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.85))
                }
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            Button { showCode = true } label: {
                actionRow(icon: "chevron.left.forwardslash.chevron.right",
                          title: "View Source Code",
                          subtitle: "Read all \(project.fileCount) \(project.fileCount == 1 ? "file" : "files"). Edit a local copy.")
            }
            Button { showPreview = true } label: {
                actionRow(icon: "play.rectangle.fill",
                          title: "Run Preview",
                          subtitle: "See it running in a sandboxed WebView. No network access.")
            }
            if let repo = project.githubRepo, let url = URL(string: repo) {
                Link(destination: url) {
                    actionRow(icon: "link",
                              title: "View on GitHub",
                              subtitle: "Open the project's repository in Safari.")
                }
            }
        }
    }

    private var scratchpadsSection: some View {
        let pads = edits.pads(slug: project.slug)
        let active = edits.activePad(slug: project.slug)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Attempts")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.5))
                if !premium.isPremium {
                    Text("PRO")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(Color.orange.opacity(0.6)))
                        .foregroundStyle(.white)
                }
                Spacer()
                Button {
                    if premium.isPremium {
                        showCreatePadAlert = true
                    } else {
                        showPaywall("scratchpads")
                    }
                } label: {
                    Label("New attempt", systemImage: "plus.circle.fill")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(.white)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(pads, id: \.self) { name in
                        Button {
                            edits.selectPad(slug: project.slug, name: name)
                        } label: {
                            Text(name)
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Capsule().fill(active == name ? Color.white : Color.white.opacity(0.10)))
                                .foregroundStyle(active == name ? .black : .white)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if !premium.isPremium {
                Text("Free plan: one in-memory attempt that resets when you quit the app. Pro saves attempts across launches and lets you keep several side-by-side.")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private var tinkerBanner: some View {
        let edited = edits.editedFiles(slug: project.slug)
        return HStack(spacing: 12) {
            Image(systemName: "pencil.circle.fill")
                .font(.title3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your edits are active")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text("Run Preview shows \(edited.count) tinkered \(edited.count == 1 ? "file" : "files"). Edits live only in this app on your device.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
            Button("Reset") {
                edits.discardEdits(slug: project.slug)
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Capsule().fill(Color.white.opacity(0.15)))
            .foregroundStyle(.white)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.orange.opacity(0.10)))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
        )
    }

    private var sourcePrompt: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Original prompt")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.5))
            Text(project.description)
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private var disclosure: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About the preview")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.5))
            Text("Previews run inside a sandboxed WKWebView. No code in this app accesses the camera, microphone, location, or your files. Network access is blocked at preview time via Content Security Policy.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.03)))
    }

    private func badge(_ label: String, color: Color) -> some View {
        Text(label.uppercased())
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(color))
            .foregroundStyle(.white)
    }

    private func actionRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.6))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.3))
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.08)))
    }

    private var difficultyColor: Color {
        switch project.difficulty {
        case "Beginner": return Color.green.opacity(0.6)
        case "Intermediate": return Color.blue.opacity(0.6)
        default: return Color.orange.opacity(0.6)
        }
    }
}
