import AppKit
import SwiftUI

@main
struct PuppyMenuBarApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuPanel(model: model)
        } label: {
            Text(model.menuTitle)
                .monospacedDigit()
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuPanel: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            Divider()
            if model.paired { activity }
            else { pairing }
            if let error = model.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            footer
        }
        .padding(16)
        .frame(width: 340)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSImage(named: "AppIcon") ?? NSApplication.shared.applicationIconImage)
                .resizable()
                .scaledToFill()
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text("Daphne")
                    .font(.headline)
                Text(model.paired ? "Shared activity" : "Mac companion")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.loading { ProgressView().controlSize(.small) }
        }
    }

    @ViewBuilder
    private var activity: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            if let latest = model.latestEvent {
                VStack(alignment: .leading, spacing: 4) {
                    Text("LAST EVENT")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline) {
                        Text("\(latest.icon)  \(latest.label)")
                            .font(.title3.weight(.semibold))
                        Spacer()
                        Text(EventFormatting.shortElapsed(since: latest.date, now: context.date))
                            .font(.title3.monospacedDigit().weight(.semibold))
                    }
                    Text("\(EventFormatting.longElapsed(since: latest.date, now: context.date)) · \(latest.date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No activity has been logged yet.")
                    .foregroundStyle(.secondary)
            }

            if model.events.count > 1 {
                VStack(alignment: .leading, spacing: 8) {
                    Text("RECENT")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                    ForEach(model.events.dropFirst().prefix(5)) { event in
                        HStack {
                            Text("\(event.icon)  \(event.label)")
                                .lineLimit(1)
                            Spacer()
                            Text(EventFormatting.shortElapsed(since: event.date, now: context.date))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private var pairing: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Connect to Daphne’s feed")
                .font(.headline)
            Text("On your phone, tap Add phone and send the private link to this Mac. Copy it, then connect below.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("Private Add phone link", text: $model.inviteLink)
                .textFieldStyle(.roundedBorder)
                .onSubmit { model.connect() }
            HStack {
                Button("Paste and connect") { model.pasteAndConnect() }
                    .buttonStyle(.borderedProminent)
                Button("Connect") { model.connect() }
                    .disabled(model.inviteLink.isEmpty || model.loading)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 8) {
            HStack {
                if model.paired {
                    Button("Refresh") { Task { await model.refresh() } }
                    Button("Open app") {
                        NSWorkspace.shared.open(URL(string: "https://fredsterss.github.io/puppy-training/")!)
                    }
                }
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
            HStack {
                Toggle("Launch at login", isOn: Binding(
                    get: { model.launchAtLogin },
                    set: { model.setLaunchAtLogin($0) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                Spacer()
                if model.paired {
                    Button("Disconnect") { model.disconnect() }
                        .buttonStyle(.plain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
