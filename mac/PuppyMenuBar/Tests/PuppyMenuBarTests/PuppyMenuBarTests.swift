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
    let normal = PuppyEvent(id: UUID(), type: "poo", occurredAt: "2026-08-26T12:00:00Z", consistency: "normal", tags: nil)
    let soft = PuppyEvent(id: UUID(), type: "poo", occurredAt: "2026-08-26T12:00:00Z", consistency: "soft", tags: nil)
    #expect(normal.label == "Poo · Normal")
    #expect(soft.label == "Poo · Soft")
}
