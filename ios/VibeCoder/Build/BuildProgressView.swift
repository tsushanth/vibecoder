//
//  BuildProgressView.swift
//  VibeCoder
//
//  Real generate + poll flow. Sequence:
//   1. POST /api/projects/generate (stream:false)
//      → SSE emits a single `queued` event with the placeholder projectId,
//        then the server closes the stream and the worker builds out of band.
//   2. Poll GET /api/projects/:id every ~4s until `status == .ready` or
//      `.failed`, with a 12-minute ceiling.
//   3. On ready, swap the view to ProjectPreviewView so the user can interact
//      with their generated app.
//
//  Phase copy is rotated locally because the poll endpoint only surfaces
//  coarse status; the worker's per-phase logs aren't reflected in the row.
//

import SwiftUI

@MainActor
final class BuildProgressModel: ObservableObject {
    enum State: Equatable {
        case idle
        case queuing
        case building
        case ready(VBProject)
        case failed(message: String)
    }

    @Published var state: State = .idle
    @Published var phase: String = "Starting build…"

    private var task: Task<Void, Never>?
    private let phases = [
        "Designing layout…",
        "Generating code…",
        "Wiring components…",
        "Validating output…",
        "Polishing details…",
    ]

    /// Kick off a generate. Caller supplies prompt + identity from AuthManager.
    /// `referenceImage` is optional raw base64 (no `data:` prefix) attached as
    /// visual context — the backend forwards it to the worker which decodes onto
    /// disk for Claude CLI to read alongside the prompt.
    func start(prompt: String, userId: String, userName: String?, referenceImage: String? = nil) {
        task?.cancel()
        state = .queuing
        phase = "Starting build…"

        task = Task { [weak self] in
            guard let self else { return }
            await self.run(prompt: prompt, userId: userId, userName: userName, referenceImage: referenceImage)
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    private func run(prompt: String, userId: String, userName: String?, referenceImage: String?) async {
        // 0) Ensure the user row exists in the backend so projects.creator_id
        //    FK passes. Failure is non-fatal — generate() will surface a
        //    clearer error if the missing row blocks the placeholder insert.
        try? await VibeBuildAPI.shared.registerUser(
            userId: userId,
            displayName: userName,
            email: nil
        )

        // 1) Kick off generate. Async-callback mode means the server emits
        //    a single `queued` event then closes; the build happens server-side.
        var projectId: String?
        do {
            let stream = VibeBuildAPI.shared.generate(
                prompt: prompt,
                userId: userId,
                userName: userName,
                referenceImage: referenceImage,
                stream: false
            )
            for try await event in stream {
                if Task.isCancelled { return }
                switch event {
                case .queued(let id):
                    projectId = id
                case .complete(let id, _):
                    // Some backends emit complete inline — accept it.
                    projectId = projectId ?? id
                case .failed(let msg):
                    await MainActor.run { self.state = .failed(message: msg) }
                    return
                case .phase, .heartbeat, .unknown, .result:
                    continue
                }
            }
        } catch let err as VBAPIError {
            await MainActor.run { self.state = .failed(message: err.localizedDescription) }
            return
        } catch {
            if Task.isCancelled { return }
            await MainActor.run { self.state = .failed(message: error.localizedDescription) }
            return
        }

        guard let id = projectId else {
            await MainActor.run {
                self.state = .failed(message: "Server didn't return a project ID.")
            }
            return
        }

        // 2) Poll until status is terminal.
        await MainActor.run { self.state = .building }
        let start = Date()
        let maxWait: TimeInterval = 12 * 60   // 12 min ceiling
        var attempt = 0
        var delayMs: UInt64 = 3_000          // 3 → 6 → 9 → 12 → 15s
        while !Task.isCancelled, Date().timeIntervalSince(start) < maxWait {
            try? await Task.sleep(nanoseconds: delayMs * 1_000_000)
            attempt += 1
            await MainActor.run { self.phase = self.phases[attempt % self.phases.count] }

            do {
                // /api/projects/:id omits `status` and `preview_url` entirely
                // (only returns the bundle). Poll /api/projects/my which
                // returns the row shape we need and filter for our id.
                let resp = try await VibeBuildAPI.shared.fetchMyProjects(userId: userId)
                if let project = resp.projects.first(where: { $0.id == id }) {
                    switch project.status {
                    case .ready:
                        await MainActor.run { self.state = .ready(project) }
                        return
                    case .failed:
                        await MainActor.run {
                            self.state = .failed(message: "The build failed. Try again or rephrase your prompt.")
                        }
                        return
                    case .building, .unknown:
                        break
                    }
                }
            } catch {
                // Transient — keep polling. The build is server-side.
                continue
            }
            delayMs = min(delayMs + 3_000, 15_000)
        }
        if !Task.isCancelled {
            await MainActor.run {
                self.state = .failed(message: "Build is taking longer than expected. Check My Projects in a few minutes.")
            }
        }
    }
}

struct BuildProgressView: View {
    let prompt: String
    let userId: String
    let userName: String?
    /// Optional reference image, raw base64. Forwarded to /generate verbatim.
    var referenceImage: String? = nil
    let onClose: () -> Void

    @StateObject private var model = BuildProgressModel()
    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    var body: some View {
        Group {
            switch model.state {
            case .ready(let project):
                ProjectPreviewView(project: project, onClose: onClose)
            default:
                progressUI
            }
        }
        .task {
            // Re-entry guard: only kick off the first time. Switching from
            // .building → .ready triggers a recompose; we don't want a 2nd run.
            if model.state == .idle {
                model.start(prompt: prompt, userId: userId, userName: userName, referenceImage: referenceImage)
            }
        }
    }

    private var progressUI: some View {
        VStack(spacing: 24) {
            Spacer()

            if case .failed(let msg) = model.state {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.red)
                Text(msg)
                    .font(.callout)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            } else {
                ProgressView()
                    .tint(accent)
                    .scaleEffect(1.6)
                Text(model.phase)
                    .font(.callout)
                    .foregroundColor(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                Text("This usually takes 2–5 minutes. You can leave this screen — your project will be saved to My Projects either way.")
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.45))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Text("\u{201C}\(prompt)\u{201D}")
                .font(.footnote)
                .italic()
                .foregroundColor(.white.opacity(0.4))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.top, 8)

            Spacer()

            Button {
                // Don't cancel the polling task — the server build keeps
                // running and surfaces in My Projects either way. We just
                // close this screen and return the user to Build.
                onClose()
            } label: {
                Text("Close")
                    .font(.callout.weight(.semibold))
                    .foregroundColor(.white.opacity(0.85))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.25), lineWidth: 1))
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
