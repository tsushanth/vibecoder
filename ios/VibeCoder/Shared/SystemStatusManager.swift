import Foundation
import Combine

class SystemStatusManager: ObservableObject {
    static let shared = SystemStatusManager()

    @Published var isSystemDown = false
    @Published var systemMessage: String? = nil

    private var timer: Timer?

    private init() {
        startPolling()
    }

    private func startPolling() {
        Task { await checkStatus() }
        timer = Timer.scheduledTimer(withTimeInterval: 5 * 60, repeats: true) { [weak self] _ in
            Task { await self?.checkStatus() }
        }
    }

    @MainActor
    private func checkStatus() async {
        guard let status = await NetworkManager.shared.getSystemStatus() else { return }
        isSystemDown = !status.operational
        systemMessage = status.message
    }
}
