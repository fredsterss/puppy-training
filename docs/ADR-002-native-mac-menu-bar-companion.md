# ADR-002: Native macOS menu-bar companion

**Status:** Accepted
**Date:** 2026-08-26
**Deciders:** Fred and Puppy Companion maintainers

## Context

The shared event feed is useful on a Mac, but keeping the full phone-first PWA
open is unnecessary when the immediate question is what Daphne last did and how
long ago it happened. The companion must reuse the existing private household,
avoid a separate account system, and expose no write controls.

## Decision

Build a dependency-free SwiftUI `MenuBarExtra` application for macOS 13 and
later. It signs into Supabase as an anonymous device, joins the household once
from the existing private **Add phone** link, and reads recent non-deleted events
through the PostgREST API. Supabase Row Level Security remains the authorization
boundary.

The private capability, household identifier, anonymous access token, and
refresh token are stored in macOS Keychain. The app refreshes at launch, every
60 seconds, and on demand. It displays the latest event and compact elapsed time
in the system menu bar, with a short recent-event list in its panel. Version one
is intentionally read-only.

## Options considered

### Native SwiftUI menu-bar app

- Small memory and UI footprint.
- Native launch-at-login support and Keychain storage.
- No browser tab or embedded web runtime.
- Requires a small REST/auth client because the Supabase Swift SDK is not added.

### Electron or web-wrapper app

- Could reuse TypeScript, but adds a large runtime for one glanceable status.
- Keychain integration and menu-bar behavior require additional packaging work.

### Keep using the PWA

- No new code, but does not provide persistent glanceable status in the Mac menu
  bar and requires opening the full app.

## Consequences

- The Mac becomes another anonymous household member after one explicit pairing.
- Credentials are not stored in preferences or plaintext files.
- The publishable Supabase key remains non-secret; the private household link is
  the capability and must be handled as sensitive.
- Polling adds at most one small read per minute while running.
- Event logging and editing remain in the phone PWA for the first version.
