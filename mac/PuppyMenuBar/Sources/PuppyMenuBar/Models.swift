import Foundation

struct PuppyEvent: Codable, Identifiable, Sendable, Equatable {
    let id: UUID
    let type: String
    let occurredAt: String
    let consistency: String?
    let isAccident: Bool
    let tags: [String]?

    enum CodingKeys: String, CodingKey {
        case id, type, consistency, tags
        case occurredAt = "occurred_at"
        case isAccident = "is_accident"
    }

    var date: Date {
        EventFormatting.parseDate(occurredAt) ?? .distantPast
    }

    var icon: String {
        if isAccident && (type == "pee" || type == "poo") { return "⚠️" }
        return switch type {
        case "pee": "💧"
        case "poo": "💩"
        case "food": "🍽️"
        case "water": "🥤"
        case "sleep": "🌙"
        case "wake": "☀️"
        default: "🐾"
        }
    }

    var label: String {
        let base = switch type {
        case "pee": "Pee"
        case "poo": consistency == "soft" ? "Poo · Soft" : "Poo · Normal"
        case "food": "Ate"
        case "water": "Water"
        case "sleep": "Sleep"
        case "wake": "Wake"
        default: type.capitalized
        }
        return isAccident && (type == "pee" || type == "poo") ? "\(base) · Accident" : base
    }
}

enum EventFormatting {
    static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }

    static func shortElapsed(since date: Date, now: Date = .now) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h \(minutes % 60)m" }
        return "\(hours / 24)d"
    }

    static func longElapsed(since date: Date, now: Date = .now) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

struct StoredConnection: Codable, Sendable {
    var accessKey: String
    var householdId: UUID
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
}

struct AuthResponse: Decodable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Double

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

struct BootstrapResponse: Decodable, Sendable {
    let householdId: UUID

    enum CodingKeys: String, CodingKey {
        case householdId = "household_id"
    }
}
