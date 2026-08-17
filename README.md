# Your Purebred Puppy archive

This workspace contains a resumable Wayback Machine crawler and its local export.
It starts from the May 6, 2023 snapshot of “Perfect Puppy Manners, Just 23 Steps,”
follows same-site HTML links, and saves every successfully replayed page in both
SQLite and Markdown.

## Project status

- Crawler: implemented and full crawl completed
- Archive timestamp: `20230506062347`
- Scope: HTML pages reachable on `yourpurebredpuppy.com` from the seed page
- Result: 1,023 archived source pages consolidated into 303
  browsable documents, with one complete Markdown guide per breed; 11 unavailable
  archive URLs and 4 external redirects are recorded separately
- Outputs: `archive/site.db`, `archive/pages/**/*.md`, the curated
  `archive/INDEX.md`, `archive/APPENDIX.md`, `archive/SOURCE_INDEX.md`,
  `archive/ALPHABETICAL.md`, `archive/CATEGORY_AUDIT.md`,
  `archive/CONTENT_CATALOG.csv`, `archive/CONTENT_CATALOG.json`, and
  `archive/CRAWL_REPORT.md`
- Resume behavior: completed and failed URLs remain indexed; rerunning retries
  retryable failures and continues queued links

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python crawl_wayback.py
```

Useful options:

```bash
# Stop after 25 pages (handy for testing)
.venv/bin/python crawl_wayback.py --max-pages 25

# Retry every failed page
.venv/bin/python crawl_wayback.py --retry-failed

# Rebuild Markdown and INDEX.md from the database without fetching
.venv/bin/python crawl_wayback.py --export-only

# Replace any replay that drifted past the snapshot day with the latest
# archived HTML capture on or before that day
.venv/bin/python repair_cutoff.py
```

## Data layout

`archive/site.db` is the source of truth:

- `pages`: original URL, replay URL, resolved capture URL/timestamp, title,
  HTTP status, raw HTML, Markdown, hashes, and error details
- `links`: directed links discovered between in-scope pages
- `queue`: crawl state (`pending`, `processing`, `done`, `failed`, `skipped`)
- `meta`: crawl configuration and timestamps
- `breed_pages`: 177 generated breed guides and their component source URLs
- `content_catalog`: editorial topic, utility tier, format, caution, and rationale
  for every browsable document

Markdown files include YAML front matter with source and replay metadata. Their
paths mirror the original site. Directory URLs become `index.md`; query strings
receive a short hash suffix so filenames remain collision-free.

Generated Markdown is a reading edition: inflated byline credentials, repeated
author bios, site-wide book promotions, training-video links, and other footer
navigation are removed when they match the site's known templates. The unedited
HTML and Markdown remain in `archive/site.db`, so the archival source is
preserved and exports can be regenerated without data loss.

Image files are not part of this text archive. Unresolvable Markdown image embeds
are rendered as visible `Image hint — …` placeholders using their original alt
text, making them readable now and straightforward to replace later.
Legacy `1)` list markers and duplicated converter output such as `1. 1)` are
normalized into standard Markdown ordered lists in the reading edition.

Breed-specific review, buying, training, health, FAQ, and legacy pages are kept
as source records in SQLite but exported as one combined file per breed under
`archive/breeds/`. Each guide lists every retained source URL and capture time.

Run `.venv/bin/python categorize_collection.py` to regenerate the editorial
audit and the CSV/JSON content catalogs after changing the exported collection.

## Scope and caveats

This is a link crawl, not a CDX inventory dump. It captures the site as navigable
from the seed snapshot and does not download images, stylesheets, scripts, PDFs,
email links, or external sites. Wayback may resolve individual URLs to captures
from nearby dates when no capture exists at the requested timestamp. The completed
corpus was repaired to keep captures on or before the end of May 6, 2023. The
actual resolved replay URL and timestamp are recorded per page.

Promotional “Get 8 books for $24” checkout pages are excluded during link
normalization and purged from existing exports.

## Puppy Companion app

The Today screen calculates the next potty trip from the latest logged pee using
the puppy's completed age in months plus one hour (birth date: June 8, 2026), and
keeps a live remaining/overdue countdown on screen.
