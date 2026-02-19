import SwiftUI
import UIKit
import UserNotifications

class ProjectGenerationManager: ObservableObject {
    static let shared = ProjectGenerationManager()

    // Generation state
    @Published var isGenerating: Bool = false
    @Published var buildPhase: String = ""
    @Published var buildDetail: String = ""
    @Published var progressPercent: Double = 0
    @Published var estimatedSecondsRemaining: Int = 0
    @Published var errorMessage: String? = nil

    // Result state
    @Published var bundleDir: URL? = nil
    @Published var bundleBase64: String? = nil
    @Published var showPreview: Bool = false

    // Notification state
    @Published var showCompletionBanner: Bool = false
    @Published var completionPrompt: String = ""

    // Track whether user is currently on the Create tab
    var isOnCreateTab: Bool = true  // Default to true since we always generate from Create tab

    // The prompt used for the current/last generation
    var currentPrompt: String = ""

    private var generationTask: Task<Void, Never>?
    private var progressTimer: Timer?
    private var phaseStartPct: Double = 0
    private var phaseEndPct: Double = 0
    private var phaseDuration: Double = 0
    private var phaseStartTime: Date?
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid

    func startGeneration(prompt: String, imageBase64: String? = nil) {
        guard !isGenerating else { return }

        isGenerating = true
        errorMessage = nil
        buildPhase = "Connecting..."
        buildDetail = ""
        progressPercent = 0
        estimatedSecondsRemaining = 0
        completionPrompt = prompt
        currentPrompt = prompt

        // Keep screen on during generation
        UIApplication.shared.isIdleTimerDisabled = true

        // Request background time to finish generation even if app is backgrounded
        backgroundTaskID = UIApplication.shared.beginBackgroundTask { [weak self] in
            self?.endBackgroundTask()
        }

        generationTask = Task {
            do {
                let (dir, base64) = try await streamGenerate(prompt: prompt, imageBase64: imageBase64)
                await MainActor.run {
                    self.stopProgressInterpolation()
                    bundleDir = dir
                    bundleBase64 = base64
                    isGenerating = false
                    progressPercent = 100
                    UIApplication.shared.isIdleTimerDisabled = false
                    self.endBackgroundTask()
                    self.completionPrompt = prompt
                    self.sendCompletionNotification(prompt: prompt)
                    showPreview = true
                }
            } catch {
                if Task.isCancelled { return }
                NSLog("[ProjectGen] ERROR: %@", "\(error)")
                await MainActor.run {
                    self.stopProgressInterpolation()
                    errorMessage = error.localizedDescription
                    isGenerating = false
                    UIApplication.shared.isIdleTimerDisabled = false
                    self.endBackgroundTask()
                }
            }
        }
    }

    func cancelGeneration() {
        generationTask?.cancel()
        stopProgressInterpolation()
        isGenerating = false
        buildPhase = ""
        buildDetail = ""
        progressPercent = 0
        UIApplication.shared.isIdleTimerDisabled = false
        endBackgroundTask()
    }

    private func endBackgroundTask() {
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    private func sendCompletionNotification(prompt: String) {
        let content = UNMutableNotificationContent()
        content.title = "Project Ready!"
        content.body = "Your project \"\(String(prompt.prefix(40)))\" has been created. Tap to view!"
        content.sound = .default
        let request = UNNotificationRequest(identifier: "project-gen-\(UUID().uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    func dismissBanner() {
        showCompletionBanner = false
    }

    func openCompletedProject() {
        showCompletionBanner = false
        showPreview = true
    }

    // MARK: - Progress Interpolation

    private func startProgressInterpolation() {
        progressTimer?.invalidate()
        guard phaseDuration > 0 else { return }
        phaseStartTime = Date()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let startTime = self.phaseStartTime else { return }
            let elapsed = Date().timeIntervalSince(startTime)
            let fraction = min(elapsed / self.phaseDuration, 0.95)
            let interpolated = self.phaseStartPct + (self.phaseEndPct - self.phaseStartPct) * fraction
            DispatchQueue.main.async {
                self.progressPercent = interpolated
            }
        }
    }

    private func stopProgressInterpolation() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    // MARK: - SSE Streaming

    private func streamGenerate(prompt: String, imageBase64: String? = nil) async throws -> (URL, String) {
        // Use NetworkManager's base URL
        let baseURL = "https://vibecoder-api-917362189743.us-central1.run.app"
        guard let url = URL(string: "\(baseURL)/api/projects/generate") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("ios", forHTTPHeaderField: "x-platform")
        request.timeoutInterval = 600

        // Use device-specific identifier when no auth
        let userId = UIDevice.current.identifierForVendor?.uuidString ?? "device-\(UUID().uuidString)"
        let userName = "VibeBuild User"

        var body: [String: Any] = [
            "prompt": prompt.trimmingCharacters(in: .whitespacesAndNewlines),
            "userId": userId,
            "userName": userName
        ]
        if let imageBase64 = imageBase64 {
            body["referenceImage"] = imageBase64
        }
        if let deviceToken = DeviceTokenManager.shared.deviceToken {
            body["deviceToken"] = deviceToken
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        NSLog("[ProjectGen] Sending request to: %@ userId=%@", url.absoluteString, userId)
        let (bytes, response) = try await URLSession.shared.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        if httpResponse.statusCode != 200 {
            // Read error body from the existing response stream (not a new request)
            var errorBody = ""
            for try await byte in bytes {
                errorBody.append(Character(UnicodeScalar(byte)))
                if errorBody.count > 2000 { break }
            }

            var serverError = "Server error (\(httpResponse.statusCode))"
            if httpResponse.statusCode == 429 {
                serverError = "Rate limit exceeded. Try again in an hour."
            }
            // Try to parse JSON error from the body we already read
            if let data = errorBody.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errMsg = json["error"] as? String {
                serverError = errMsg
            }
            throw NSError(domain: "ProjectGen", code: httpResponse.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: serverError])
        }

        var bundleBase64Result: String?
        var lineBuffer = ""

        for try await byte in bytes {
            try Task.checkCancellation()
            lineBuffer.append(Character(UnicodeScalar(byte)))

            while let range = lineBuffer.range(of: "\n\n") {
                let eventText = String(lineBuffer[lineBuffer.startIndex..<range.lowerBound])
                lineBuffer = String(lineBuffer[range.upperBound...])

                for line in eventText.components(separatedBy: "\n") {
                    guard line.hasPrefix("data: ") else { continue }
                    let jsonStr = String(line.dropFirst(6))

                    // Skip empty lines
                    guard !jsonStr.trimmingCharacters(in: .whitespaces).isEmpty else { continue }

                    guard let data = jsonStr.data(using: .utf8) else {
                        print("[ProjectGen] Failed to convert to data: \(jsonStr)")
                        continue
                    }

                    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        print("[ProjectGen] Failed to parse JSON: \(jsonStr)")
                        continue
                    }

                    guard let type = json["type"] as? String else {
                        print("[ProjectGen] Missing type field: \(json)")
                        continue
                    }

                    switch type {
                    case "status":
                        let message = json["message"] as? String ?? ""
                        let detail = json["detail"] as? String ?? ""
                        let pct = json["progressPercent"] as? Double ?? self.progressPercent
                        let endPct = json["progressEndPct"] as? Double ?? pct
                        let phaseSecs = json["phaseDurationSeconds"] as? Double ?? 0
                        let eta = json["estimatedSecondsRemaining"] as? Int ?? 0
                        await MainActor.run {
                            self.buildPhase = message
                            self.buildDetail = detail
                            self.progressPercent = pct
                            self.estimatedSecondsRemaining = eta
                            self.phaseStartPct = pct
                            self.phaseEndPct = endPct
                            self.phaseDuration = phaseSecs
                            self.startProgressInterpolation()
                        }

                    case "result":
                        bundleBase64Result = json["bundle"] as? String

                    case "error":
                        let errorMsg = json["error"] as? String ?? "Unknown error"
                        throw NSError(domain: "ProjectGen", code: 0,
                                      userInfo: [NSLocalizedDescriptionKey: errorMsg])
                    default:
                        break
                    }
                }
            }
        }

        guard let base64 = bundleBase64Result else {
            throw NSError(domain: "ProjectGen", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "Build completed but no project bundle received. Please try again."])
        }

        await MainActor.run {
            self.buildPhase = "Extracting project..."
            self.buildDetail = ""
            self.progressPercent = 95
        }

        let dir = try ZipExtractor.extractBundle(base64: base64)
        return (dir, base64)
    }
}

// MARK: - Completion Banner

struct ProjectCompletionBanner: View {
    let onTap: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
                .font(.title2)

            VStack(alignment: .leading, spacing: 2) {
                Text("Project Ready!")
                    .font(.subheadline.bold())
                    .foregroundColor(.white)
                Text("Tap to preview your project")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.7))
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundColor(.white.opacity(0.6))
                    .font(.caption)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(red: 0.15, green: 0.15, blue: 0.25))
                .shadow(color: .black.opacity(0.3), radius: 8)
        )
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .onTapGesture(perform: onTap)
    }
}
