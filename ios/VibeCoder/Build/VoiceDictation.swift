//
//  VoiceDictation.swift
//  VibeCoder
//
//  Mic button + sheet that uses SFSpeechRecognizer + AVAudioEngine to
//  transcribe a user's spoken app idea into the prompt field.
//
//  Permissions: NSMicrophoneUsageDescription + NSSpeechRecognitionUsageDescription
//  are already declared in Info.plist.
//

import SwiftUI
import Speech
import AVFoundation

@MainActor
final class VoiceDictationModel: ObservableObject {
    @Published var transcript: String = ""
    @Published var isRecording: Bool = false
    @Published var errorMessage: String? = nil

    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func start() async {
        errorMessage = nil
        transcript = ""

        let speechAuth = await requestSpeechAuth()
        guard speechAuth == .authorized else {
            errorMessage = "Speech recognition permission denied. Enable it in Settings."
            return
        }

        let micGranted: Bool = await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        guard micGranted else {
            errorMessage = "Microphone permission denied. Enable it in Settings."
            return
        }

        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Speech recognition is not available on this device."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak req] buffer, _ in
                req?.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()

            isRecording = true

            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self else { return }
                Task { @MainActor in
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                    }
                    if error != nil || (result?.isFinal ?? false) {
                        self.stop()
                    }
                }
            }
        } catch {
            errorMessage = "Could not start recording: \(error.localizedDescription)"
            stop()
        }
    }

    func stop() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isRecording = false
    }

    private func requestSpeechAuth() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status)
            }
        }
    }
}

struct VoiceDictationSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = VoiceDictationModel()
    let onFinish: (String) -> Void

    private let accent = Color(red: 1.0, green: 0.59, blue: 0.0)

    var body: some View {
        VStack(spacing: 20) {
            Text(model.isRecording ? "Listening…" : "Speak your idea")
                .font(.headline)
                .foregroundColor(.white)
                .padding(.top, 8)

            ScrollView {
                Text(displayText)
                    .font(.body)
                    .foregroundColor(model.transcript.isEmpty ? .white.opacity(0.4) : .white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .frame(maxWidth: .infinity, minHeight: 140)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.06)))

            if let err = model.errorMessage {
                Text(err)
                    .font(.footnote)
                    .foregroundColor(.red.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button {
                Task {
                    if model.isRecording { model.stop() }
                    else { await model.start() }
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(model.isRecording ? Color.red : accent)
                        .frame(width: 88, height: 88)
                        .shadow(color: (model.isRecording ? Color.red : accent).opacity(0.4), radius: 10)
                    Image(systemName: model.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundColor(.white)
                }
            }
            .buttonStyle(.plain)
            .scaleEffect(model.isRecording ? 1.1 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: model.isRecording)

            HStack {
                Button("Cancel") {
                    model.stop()
                    dismiss()
                }
                .foregroundColor(.white.opacity(0.6))

                Spacer()

                Button("Use Text") {
                    let final = model.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                    model.stop()
                    if !final.isEmpty { onFinish(final) }
                    dismiss()
                }
                .foregroundColor(accent)
                .disabled(model.transcript.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .font(.body.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onDisappear { model.stop() }
    }

    private var displayText: String {
        if !model.transcript.isEmpty { return model.transcript }
        return model.isRecording
            ? "Start talking. We'll transcribe in real time."
            : "Tap the mic to start."
    }
}
