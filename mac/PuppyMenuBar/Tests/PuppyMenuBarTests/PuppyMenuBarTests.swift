import Foundation
import Testing
@testable import PuppyMenuBar

@Test func extractsPairingKeyFromQueryOrFragment() {
    let key = String(repeating: "a", count: 64)
    #expect(SupabaseService.accessKey(from: "https://example.com/puppy?sync=\(key)") == key)
    #expect(SupabaseService.accessKey(from: "https://example.com/puppy#sync=\(key)") == key)
    #expect(SupabaseService.accessKey(from: "https://example.com/puppy") == nil)
}

@Test func formatsElapsedTimeForTheMenuBar() {
    let now = Date(timeIntervalSince1970: 10_000)
    #expect(EventFormatting.shortElapsed(since: now.addingTimeInterval(-30), now: now) == "now")
    #expect(EventFormatting.shortElapsed(since: now.addingTimeInterval(-25 * 60), now: now) == "25m")
    #expect(EventFormatting.shortElapsed(since: now.addingTimeInterval(-125 * 60), now: now) == "2h 5m")
}

@Test func labelsPooConsistency() {
    let normal = PuppyEvent(id: UUID(), type: "poo", occurredAt: "2026-08-26T12:00:00Z", consistency: "normal", isAccident: false, tags: nil)
    let soft = PuppyEvent(id: UUID(), type: "poo", occurredAt: "2026-08-26T12:00:00Z", consistency: "soft", isAccident: true, tags: ["rug"])
    #expect(normal.label == "Poo · Normal")
    #expect(soft.label == "Poo · Soft · Accident")
    #expect(soft.icon == "⚠️")
}

@Test func decodesAndPresentsAPeeAccident() throws {
    let json = Data(#"{"id":"11111111-1111-4111-8111-111111111111","type":"pee","occurred_at":"2026-08-26T12:00:00Z","consistency":null,"is_accident":true,"tags":["rug"]}"#.utf8)
    let event = try JSONDecoder().decode(PuppyEvent.self, from: json)

    #expect(event.isAccident)
    #expect(event.tags == ["rug"])
    #expect(event.label == "Pee · Accident")
    #expect(event.icon == "⚠️")
}
