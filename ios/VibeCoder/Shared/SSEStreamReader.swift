import Foundation

/// Reusable SSE (Server-Sent Events) stream reader that parses event streams byte-by-byte.
/// Handles "data: " prefix, decodes JSON events, and returns structured SSEEvent types.
class SSEStreamReader {

    /// Parse SSE events from raw data stream
    /// - Parameter data: Raw data from the SSE stream
    /// - Returns: Array of parsed SSEEvent objects
    static func parseEvents(from data: Data) -> [SSEEvent] {
        var events: [SSEEvent] = []
        let text = String(data: data, encoding: .utf8) ?? ""
        let lines = text.components(separatedBy: "\n")

        for line in lines {
            if line.hasPrefix("data: ") {
                let eventData = String(line.dropFirst(6))
                if let data = eventData.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = json["type"] as? String {

                    switch type {
                    case "status":
                        if let event = try? JSONDecoder().decode(SSEStatusEvent.self, from: data) {
                            events.append(.status(event))
                        }
                    case "result":
                        if let event = try? JSONDecoder().decode(SSEResultEvent.self, from: data) {
                            events.append(.result(event))
                        }
                    case "error":
                        if let error = json["error"] as? String {
                            events.append(.error(error))
                        }
                    default:
                        break
                    }
                }
            }
        }

        return events
    }
}
