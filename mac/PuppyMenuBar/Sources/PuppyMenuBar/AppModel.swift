import AppKit
import Combine
import Foundation
import ServiceManagement

@MainActor
final class AppModel: ObservableObject {
    @Published var events: [PuppyEvent] = []
    @Published var paired = false
    @Published var loading = false
    @Published var errorMessage: String?
    @Published var lastUpdated: Date?
    @Published var inviteLink = ""
    @Published var launchAtLogin = SMAppService.mainApp.status == .enabled

    private let service = SupabaseService()
    private var refreshTask: Task<Void, Never>?

    var latestEvent: PuppyEvent? { events.first }

    var menuTitle: String {
        guard let event = latestEvent else { return paired ? "🐾 —" : "🐾" }
        return "\(event.icon) \(EventFormatting.shortElapsed(since: event.date))"
    }

    init() {
        refreshTask = Task { [weak self] in
            guard let self else { return }
            paired = await service.isPaired()
            if paired { await refresh() }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if paired { await refresh(silently: true) }
            }
        }
    }

    deinit { refreshTask?.cancel() }

    func connect() {
        let link = inviteLink
        guard !link.isEmpty else {
            errorMessage = "Paste the private Add phone link first."
            return
        }
        loading = true
        errorMessage = nil
        Task {
            do {
                events = try await service.connect(inviteLink: link)
                paired = true
                inviteLink = ""
                lastUpdated = .now
            } catch {
                errorMessage = error.localizedDescription
            }
            loading = false
        }
    }

    func pasteAndConnect() {
        guard let value = NSPasteboard.general.string(forType: .string) else {
            errorMessage = "The clipboard does not contain a link."
            return
        }
        inviteLink = value
        connect()
    }

    func refresh(silently: Bool = false) async {
        if !silently { loading = true }
        do {
            events = try await service.fetchEvents()
            paired = true
            errorMessage = nil
            lastUpdated = .now
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    func disconnect() {
        Task {
            do {
                try await service.disconnect()
                events = []
                paired = false
                lastUpdated = nil
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            launchAtLogin = SMAppService.mainApp.status == .enabled
        } catch {
            launchAtLogin = SMAppService.mainApp.status == .enabled
            errorMessage = error.localizedDescription
        }
    }
}
