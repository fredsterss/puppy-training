# ADR-001: Shared household event synchronization

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Fred and Puppy Companion maintainers

## Context

Puppy Companion stores care events in IndexedDB. That makes the installed PWA fast and offline-capable, but each phone has an isolated history. Two household members need to log and edit events in one feed without losing existing phone data or making connectivity a requirement for logging.

## Decision

Use Supabase Auth, Postgres, Row Level Security, and Realtime as the shared service. Each browser installation signs in anonymously and joins one household from the same high-entropy capability link. The access key is carried in the URL fragment, stored locally on first launch, and immediately removed from the address bar. There are no account, household, invitation, or sync-status screens. IndexedDB remains the immediate write store and offline queue. Every event receives a device-generated UUID, update timestamp, soft-deletion timestamp, and pending/synced state.

On connection, the app uploads pending changes, downloads the household dataset, merges by UUID with newest-update-wins semantics, and subscribes to household event changes. Deletes are tombstones so they propagate to the other phone.

## Options considered

### Supabase

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free-tier suitable for one household |
| Offline support | Provided by the existing IndexedDB layer |
| Authentication | Anonymous device identity now; recoverable identity can be linked later |
| Realtime | Native Postgres change subscriptions |

### Custom Cloudflare Worker and D1

| Dimension | Assessment |
|---|---|
| Complexity | High because authentication, invitations, and realtime delivery are custom |
| Cost | Low |
| Offline support | Same client work required |
| Authentication | Must be designed and maintained |
| Realtime | Requires polling, Durable Objects, or another channel |

### Keep device-only storage

Lowest complexity, but cannot satisfy shared household access or protect history from browser-storage loss.

## Consequences

- Logging remains instant and works offline.
- Existing phone events migrate and upload after the first household is created or joined.
- Both phones see changes shortly after sync or realtime delivery.
- The private capability link grants household access and must only be sent to intended caregivers. Its 128+ bits of entropy make guessing impractical, while keeping authorization out of the public JavaScript bundle.
- Anonymous device accounts are intentionally lightweight. Clearing all site data requires opening the private capability link again.
- Cloud configuration and anonymous authentication must be enabled in the Supabase project before shared sync appears.

## Action items

1. Apply `supabase/schema.sql` to the production project.
2. Configure the public URL and publishable key in GitHub Actions.
3. Generate one private capability link and open that same link once on each phone.
4. Add optional email identity recovery only if real usage shows it is needed.
