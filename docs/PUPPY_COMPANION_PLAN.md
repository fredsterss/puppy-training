# Puppy Companion implementation plan

## Goal

Turn the curated puppy reference archive into a phone-first companion that remains useful without a network connection. The app must reopen exactly where the reader stopped, provide fast local search, turn selected guidance into persistent training checklists, and make daily puppy events quick to record.

## Product shape

The first release is an installable progressive web app (PWA). It has four primary destinations:

- **Today**: recent care events, an estimated next potty check, and training progress.
- **Learn**: offline full-text search, persistent view history, viewed/unread/recent filters, and a readable article view.
- **Train**: persistent checklist progress, initially sourced from “Perfect Puppy Manners, Just 23 Steps.”
- **Log**: one-tap recording for pee, poo, food, water, sleep, and wake events.

The app is local-first and has no account or server dependency. A future native wrapper can reuse the web code if reliable offline scheduled notifications become essential.

## Architecture

```text
archive Markdown + content catalog
              |
              v
     build-content script
       |              |
       v              v
 compact article JSON  checklist templates
       |              |
       +-------+------+
               v
        installable PWA shell
          |           |
          v           v
 service-worker cache  IndexedDB
 articles + assets     events, progress,
                       reader state
```

The crawler database remains the archival source of truth. The phone receives only generated reading content and the app assets. Generated content is rebuilt before development and production builds, so archive improvements flow into the app without duplicating editorial data.

## Local data model

```text
preferences
  key: string
  value: JSON-compatible value

events
  id: auto-increment integer
  type: pee | poo | food | water | sleep | wake
  occurredAt: ISO timestamp
  amount?: number
  note?: string

checklistProgress
  id: stable template-item identifier
  completed: boolean
  completedAt?: ISO timestamp

articleViews
  articleId: stable article identifier
  viewCount: integer
  lastViewedAt: ISO timestamp
```

Reader state is stored as preferences: current destination, current article identifier, and article scroll offset. Writes happen during navigation, scrolling, and page hiding. The launch path loads this state before choosing the initial screen.

## Offline and failure behavior

- The service worker precaches the shell and generated article bundle.
- IndexedDB writes are awaited before confirming a log action.
- If browser storage fails, the app keeps running and shows an actionable error.
- Empty search, empty history, and first-run training states have intentional UI.
- Article links that point outside the generated collection open externally.
- Legacy preformatted prose, long links, lists, and tables are constrained to the mobile reader width.
- The installed iPhone reader uses a dedicated header/content grid so article controls and metadata remain below the status-bar-safe header.
- Food entries capture meal type, amount served in cups, and an optional note; existing timestamp-only food history remains valid.
- Tracking guidance is an estimate, not medical advice; the user can always log or correct events manually.

## Testing strategy

```text
content generation
  +-- finds every curated Markdown document
  +-- creates stable article identifiers
  +-- extracts the 23-step checklist

domain tests
  +-- search ranking and empty queries
  +-- recent-event summaries
  +-- next-potty estimate boundaries

browser QA
  +-- mobile navigation and one-tap logging
  +-- checklist persistence after reload
  +-- article reopening and scroll restoration
  +-- offline reload after first visit
```

## Delivery phases

1. Build pipeline, app shell, manifest, and offline caching.
2. Searchable reading library with last-location restoration.
3. Persistent 23-step training checklist.
4. Care-event logging and Today summary.
5. Mobile and offline QA, documentation, and deployment configuration.

## NOT in scope

- Cloud accounts or multi-caregiver synchronization: local use proves the workflow first.
- Push or scheduled local notifications: evaluate after real tracking usage establishes reminder requirements.
- App Store packaging: the web code remains compatible with a later Capacitor wrapper.
- Automated health conclusions: the app records observations and offers transparent time estimates only.
- Editing archived source material inside the app: archive curation remains a repository workflow.

## What already exists

- `archive/pages/` and `archive/breeds/` provide the curated reading edition and are reused directly.
- `archive/CONTENT_CATALOG.json` provides editorial topic and caution metadata.
- The 23-step manners article already contains the ordered list used as the initial checklist template.
- `archive/site.db` remains the complete archival source and is intentionally excluded from the phone bundle.

## Implementation tasks

- [x] Generate compact app content from the curated archive.
- [x] Add the installable, offline-capable application shell.
- [x] Implement search, article reading, and exact location restoration.
- [x] Implement persistent checklist progress.
- [x] Implement persistent care-event logging and derived Today summaries.
- [x] Add automated tests and mobile/offline browser verification.
- [x] Document local development, deployment, and current project status.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | Not run | Product scope was agreed directly with the user |
| Codex Review | `/codex review` | Independent second opinion | 0 | Not run | None |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | Clear | Local-first PWA, generated content, explicit persistence and failure paths |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not run | Mobile browser QA is included in implementation |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | Not run | Standard npm development and build commands planned |

**VERDICT:** ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
