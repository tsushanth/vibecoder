//
//  SSEClient.swift
//  VibeCoder
//
//  Minimal Server-Sent Events client built on URLSession. No third-party
//  dependency. Used by the build pipeline to consume `text/event-stream`
//  responses from vibecoder-api `/generate` and `/:id/tweak`.
//
//  Only the subset of SSE we actually emit is parsed:
//    `data: <json>\n\n` → one event
//    `:heartbeat\n\n`    → ignored (kept connection alive)
//

import Foundation

/// Async sequence of VBBuildEvent values from an SSE endpoint.
///
/// Iterate with:
///     for try await event in client.events(...) { ... }
///
/// The sequence completes when the server closes the stream or the iterating
/// task is cancelled (cooperative cancellation).
final class SSEClient: NSObject {

    /// Stream events from a POST endpoint with a JSON body. The endpoint must
    /// respond with `Content-Type: text/event-stream`.
    func events(
        url: URL,
        body: [String: Any],
        headers: [String: String] = [:],
        timeoutInterval: TimeInterval = 600
    ) -> AsyncThrowingStream<VBBuildEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let session = URLSession(
                    configuration: {
                        let c = URLSessionConfiguration.default
                        c.timeoutIntervalForRequest = timeoutInterval
                        c.timeoutIntervalForResource = timeoutInterval
                        c.waitsForConnectivity = false
                        return c
                    }()
                )
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.timeoutInterval = timeoutInterval
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
                req.httpBody = try? JSONSerialization.data(withJSONObject: body)

                do {
                    let (bytes, response) = try await session.bytes(for: req)
                    if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                        // Best-effort error message: read remaining bytes as JSON error.
                        var collected = Data()
                        for try await b in bytes { collected.append(b) }
                        let msg: String? = {
                            if let obj = try? JSONSerialization.jsonObject(with: collected) as? [String: Any] {
                                return obj["error"] as? String
                            }
                            return String(data: collected, encoding: .utf8)
                        }()
                        switch http.statusCode {
                        case 400 where (msg ?? "").lowercased().contains("plain language"),
                             400 where (msg ?? "").lowercased().contains("urls"):
                            continuation.finish(throwing: VBAPIError.promptBlocked(message: msg ?? "Prompt blocked"))
                        case 429:
                            continuation.finish(throwing: VBAPIError.rateLimited(message: msg ?? "Rate limited"))
                        default:
                            continuation.finish(throwing: VBAPIError.http(status: http.statusCode, message: msg))
                        }
                        return
                    }

                    // Manual line splitting on raw bytes. We can't use
                    // `bytes.lines` because URLSession's AsyncLineSequence
                    // has an undocumented max line length (~8KB observed)
                    // and SSE events with embedded bundles can exceed it.
                    // The result event silently disappeared otherwise.
                    var lineBytes: [UInt8] = []
                    var eventBuffer = ""
                    func processLine(_ line: String) {
                        if line.hasPrefix(":") {
                            continuation.yield(.heartbeat)
                            return
                        }
                        if line.isEmpty {
                            let trimmed = eventBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
                            eventBuffer = ""
                            guard !trimmed.isEmpty else { return }
                            continuation.yield(VBBuildEvent.parse(jsonPayload: trimmed))
                            return
                        }
                        if line.hasPrefix("data:") {
                            let payload = line.dropFirst("data:".count)
                                .trimmingCharacters(in: .whitespaces)
                            if !eventBuffer.isEmpty { eventBuffer += "\n" }
                            eventBuffer += payload
                        }
                        // Lines we don't care about (event:, id:, retry:) are ignored.
                    }

                    for try await byte in bytes {
                        try Task.checkCancellation()
                        if byte == 0x0A {   // '\n'
                            // Drop a trailing '\r' if present (CRLF safety).
                            if lineBytes.last == 0x0D { lineBytes.removeLast() }
                            let line = String(decoding: lineBytes, as: UTF8.self)
                            lineBytes.removeAll(keepingCapacity: true)
                            processLine(line)
                        } else {
                            lineBytes.append(byte)
                        }
                    }
                    // Flush any tail line + tail event without trailing newline.
                    if !lineBytes.isEmpty {
                        let tail = String(decoding: lineBytes, as: UTF8.self)
                        processLine(tail)
                    }
                    let trimmed = eventBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        continuation.yield(VBBuildEvent.parse(jsonPayload: trimmed))
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: VBAPIError.network(error))
                }
            }

            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
