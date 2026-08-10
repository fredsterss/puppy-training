#!/usr/bin/env python3
"""Resumable same-site Wayback crawler with SQLite and Markdown output."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as to_markdown


DEFAULT_SEED = (
    "https://www.yourpurebredpuppy.com/training/articles/"
    "23-steps-to-perfect-puppy-manners.html"
)
DEFAULT_TIMESTAMP = "20230506062347"
ALLOWED_HOSTS = {"yourpurebredpuppy.com", "www.yourpurebredpuppy.com"}
TRACKING_PARAMS = {
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
    "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
}
NON_HTML_SUFFIXES = {
    ".7z", ".avi", ".bmp", ".css", ".csv", ".doc", ".docx", ".epub",
    ".gif", ".gz", ".ico", ".jpeg", ".jpg", ".js", ".json", ".m4a",
    ".m4v", ".mkv", ".mov", ".mp3", ".mp4", ".mpeg", ".ogg", ".pdf",
    ".png", ".ppt", ".pptx", ".rar", ".rss", ".svg", ".tar", ".tif",
    ".tiff", ".tsv", ".txt", ".wav", ".webm", ".webp", ".xls", ".xlsx",
    ".xml", ".zip",
}
PROMOTIONAL_BOOK_PATH = re.compile(
    r"^/books/(?:[^/]+-2step[ap]|8pkg-[ap])\.html$", re.I
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_url(raw: str, base: str | None = None) -> str | None:
    raw = raw.strip()
    if not raw or raw.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    absolute = urljoin(base, raw) if base else raw
    parts = urlsplit(absolute)
    host = (parts.hostname or "").lower()
    if parts.scheme not in {"http", "https"} or host not in ALLOWED_HOSTS:
        return None

    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if PROMOTIONAL_BOOK_PATH.match(path):
        return None
    suffix = PurePosixPath(path).suffix.lower()
    if suffix in NON_HTML_SUFFIXES:
        return None
    query = urlencode(
        sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
               if k.lower() not in TRACKING_PARAMS)
    )
    # Canonicalize scheme/host so http/https and www/non-www do not duplicate pages.
    return urlunsplit(("https", "www.yourpurebredpuppy.com", path, query, ""))


def replay_url(url: str, timestamp: str) -> str:
    return f"https://web.archive.org/web/{timestamp}id_/{url}"


def capture_timestamp(resolved_url: str) -> str | None:
    match = re.search(r"/web/(\d{14})(?:id_)?/", resolved_url)
    return match.group(1) if match else None


def replayed_original_url(resolved_url: str) -> str | None:
    """Return the original URL embedded in a Wayback replay URL."""
    match = re.search(r"/web/\d{14}(?:[a-z_]+)?/(https?://.+)$", resolved_url, re.I)
    return unquote(match.group(1)) if match else None


def markdown_path(url: str, root: Path) -> Path:
    parts = urlsplit(url)
    path = parts.path
    if not path or path.endswith("/"):
        path += "index"
    elif path.lower().endswith((".html", ".htm")):
        path = re.sub(r"\.html?$", "", path, flags=re.I)
    elif PurePosixPath(path).suffix:
        path = str(PurePosixPath(path).with_suffix(""))
    if parts.query:
        path += "--q-" + hashlib.sha256(parts.query.encode()).hexdigest()[:10]
    safe_parts = [re.sub(r"[^A-Za-z0-9._-]+", "-", p).strip("-.") or "_"
                  for p in PurePosixPath(path).parts if p not in {"/", "", ".", ".."}]
    return root.joinpath(*safe_parts).with_suffix(".md")


def content_node(soup: BeautifulSoup):
    for selector in ("article", "main", "#article", "#content", ".article", ".content"):
        node = soup.select_one(selector)
        if node and len(node.get_text(" ", strip=True)) >= 120:
            return node
    return soup.body or soup


def extract_page(html: str, original_url: str) -> tuple[str, str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title:
        title = soup.title.get_text(" ", strip=True)
    heading = soup.find("h1")
    if heading and heading.get_text(" ", strip=True):
        title = heading.get_text(" ", strip=True)
    title = re.sub(r"\s+", " ", title).strip() or original_url

    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        target = normalize_url(anchor["href"], original_url)
        if target:
            links.append(target)

    node = content_node(soup)
    for unwanted in node.select("script, style, noscript, iframe, form"):
        unwanted.decompose()
    markdown = to_markdown(str(node), heading_style="ATX", bullets="-")
    markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()
    return title, markdown, sorted(set(links))


def init_db(db: sqlite3.Connection, seed: str, timestamp: str) -> None:
    db.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue (
            url TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            discovered_from TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pages (
            url TEXT PRIMARY KEY,
            replay_url TEXT NOT NULL,
            resolved_url TEXT,
            capture_timestamp TEXT,
            fetched_at TEXT NOT NULL,
            status_code INTEGER,
            content_type TEXT,
            title TEXT,
            markdown_path TEXT,
            sha256 TEXT,
            raw_html BLOB,
            markdown TEXT,
            error TEXT
        );
        CREATE TABLE IF NOT EXISTS links (
            source_url TEXT NOT NULL,
            target_url TEXT NOT NULL,
            PRIMARY KEY (source_url, target_url)
        );
        CREATE TABLE IF NOT EXISTS breed_pages (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            markdown_path TEXT NOT NULL UNIQUE,
            markdown TEXT NOT NULL,
            component_urls TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_queue_state ON queue(state);
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_url);
        """
    )
    now = utc_now()
    db.executemany(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
        [("seed_url", seed), ("requested_timestamp", timestamp), ("updated_at", now)],
    )
    db.execute(
        "INSERT OR IGNORE INTO queue(url, state, discovered_from, updated_at) VALUES (?, 'pending', NULL, ?)",
        (seed, now),
    )
    db.commit()


def purge_excluded_pages(db: sqlite3.Connection, archive_dir: Path) -> int:
    """Remove known promotional checkout pages from every local representation."""
    rows = db.execute(
        "SELECT url, markdown_path FROM pages "
        "WHERE lower(title) LIKE 'get 8 of michele welton%'"
    ).fetchall()
    for url, relative in rows:
        if relative:
            (archive_dir / relative).unlink(missing_ok=True)
        db.execute("DELETE FROM links WHERE source_url=? OR target_url=?", (url, url))
        db.execute("DELETE FROM pages WHERE url=?", (url,))
        db.execute("DELETE FROM queue WHERE url=?", (url,))
    db.commit()
    return len(rows)


def yaml_string(value: str | None) -> str:
    return json.dumps(value or "", ensure_ascii=False)


def write_markdown(path: Path, *, title: str, url: str, replay: str,
                   resolved: str, captured: str | None, fetched: str, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "---\n"
        f"title: {yaml_string(title)}\n"
        f"source_url: {yaml_string(url)}\n"
        f"wayback_url: {yaml_string(replay)}\n"
        f"resolved_wayback_url: {yaml_string(resolved)}\n"
        f"capture_timestamp: {yaml_string(captured)}\n"
        f"fetched_at: {yaml_string(fetched)}\n"
        "---\n\n"
    )
    path.write_text(header + body + "\n", encoding="utf-8")


def export_index(db: sqlite3.Connection, archive_dir: Path) -> None:
    rows = db.execute(
        "SELECT title, url, markdown_path, capture_timestamp FROM pages "
        "WHERE status_code = 200 AND markdown IS NOT NULL AND markdown_path IS NOT NULL "
        "ORDER BY lower(title), url"
    ).fetchall()
    breed_rows = db.execute(
        "SELECT title, slug, markdown_path FROM breed_pages ORDER BY lower(title), slug"
    ).fetchall()

    sections: dict[str, dict[str, list[tuple[str, str, str, str]]]] = {
        "Dog Training": {
            "Training overview": [],
            "General training articles": [],
        },
        "Choosing and Finding a Dog": {
            "Choosing overview and consultation": [],
            "General buying and adoption articles": [],
        },
        "Health and Feeding": {
            "Health overview": [],
            "General health and feeding articles": [],
            "Lifespan articles": [],
        },
        "Dog Breed Information": {
            "Complete breed guides": [],
            "Breed indexes": [],
        },
        "Books": {"Books and book information": []},
        "About and Site Information": {"Site pages": []},
    }

    for row in rows:
        title, url, relative, captured = row
        path = urlsplit(url).path
        if path == "/training/":
            target = sections["Dog Training"]["Training overview"]
        elif path.startswith("/training/articles/"):
            target = sections["Dog Training"]["General training articles"]
        elif path.startswith("/breedconsulting/") or path == "/buying/":
            target = sections["Choosing and Finding a Dog"]["Choosing overview and consultation"]
        elif path.startswith("/buying/articles/"):
            target = sections["Choosing and Finding a Dog"]["General buying and adoption articles"]
        elif path == "/health/":
            target = sections["Health and Feeding"]["Health overview"]
        elif path.startswith("/health/articles/"):
            target = sections["Health and Feeding"]["General health and feeding articles"]
        elif path.startswith("/health/lifespan/"):
            target = sections["Health and Feeding"]["Lifespan articles"]
        elif path.startswith(("/dogbreeds/", "/dog-breeds/")):
            target = sections["Dog Breed Information"]["Breed indexes"]
        elif path.startswith("/books/"):
            target = sections["Books"]["Books and book information"]
        else:
            target = sections["About and Site Information"]["Site pages"]
        target.append((title, url, relative, captured or "unknown"))

    for title, slug, relative in breed_rows:
        synthetic_url = f"https://www.yourpurebredpuppy.com/breeds/{slug}.html"
        sections["Dog Breed Information"]["Complete breed guides"].append(
            (title, synthetic_url, relative, "combined")
        )

    def row_key(row: tuple[str, str, str, str]) -> tuple[str, str]:
        slug = PurePosixPath(urlsplit(row[1]).path.rstrip("/") or "/index").stem
        return (slug.lower(), row[0].lower())

    def anchor(text: str) -> str:
        return re.sub(r"[^a-z0-9 -]", "", text.lower()).strip().replace(" ", "-")

    def append_group(lines: list[str], name: str, group: list[tuple[str, str, str, str]]) -> None:
        if not group:
            return
        lines.extend([f"### {name} ({len(group)})", ""])
        ordered = sorted(group, key=row_key)
        if len(group) >= 80:
            by_letter: dict[str, list[tuple[str, str, str, str]]] = {}
            for row in ordered:
                slug = PurePosixPath(urlsplit(row[1]).path.rstrip("/") or "/index").stem
                letter = next((char.upper() for char in slug if char.isalpha()), "#")
                by_letter.setdefault(letter, []).append(row)
            letters = " · ".join(f"[{letter}](#{anchor(name)}-{letter.lower()})" for letter in by_letter)
            lines.extend([letters, ""])
            for letter, letter_rows in by_letter.items():
                lines.extend([f"#### {name}: {letter}", ""])
                lines.extend(f"- [{title}]({relative})" for title, _, relative, _ in letter_rows)
                lines.append("")
        else:
            lines.extend(f"- [{title}]({relative})" for title, _, relative, _ in ordered)
            lines.append("")

    section_counts = {
        section: sum(len(group) for group in groups.values())
        for section, groups in sections.items()
    }
    all_rows = list(rows) + [
        (title, f"https://www.yourpurebredpuppy.com/breeds/{slug}.html", relative, "combined")
        for title, slug, relative in breed_rows
    ]
    all_rows.sort(key=lambda row: (row[0].lower(), row[1]))
    source_count = db.execute(
        "SELECT count(*) FROM pages WHERE status_code=200 AND markdown IS NOT NULL"
    ).fetchone()[0]
    lines = [
        "# Your Purebred Puppy archive", "",
        f"{source_count} archived source pages consolidated into {len(all_rows)} browsable documents.", "",
        "## Browse by topic", "",
    ]
    for section, count in section_counts.items():
        heading_anchor = anchor(f"{section} {count}")
        lines.append(f"- [{section}](#{heading_anchor}) ({count})")
    lines.extend([
        "- [All pages alphabetically](ALPHABETICAL.md)", "",
    ])
    for section, groups in sections.items():
        lines.extend([f"## {section} ({section_counts[section]})", ""])
        for group_name, group in groups.items():
            append_group(lines, group_name, group)

    alphabetical = [
        "# All archived pages — alphabetical", "",
        f"Documents: {len(all_rows)}", "",
        "[Return to the topic index](INDEX.md)", "",
    ]
    alphabetical.extend(f"- [{title}]({relative})" for title, _, relative, _ in all_rows)
    alphabetical.append("")

    (archive_dir / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")
    (archive_dir / "ALPHABETICAL.md").write_text("\n".join(alphabetical), encoding="utf-8")


def export_report(db: sqlite3.Connection, archive_dir: Path) -> None:
    states = dict(db.execute("SELECT state, count(*) FROM queue GROUP BY state"))
    lines = [
        "# Crawl report", "",
        f"Updated: {utc_now()}", "",
        "## Queue summary", "",
    ]
    for state in ("done", "failed", "skipped", "pending", "processing"):
        if state in states:
            lines.append(f"- {state}: {states[state]}")
    lines.extend(["", "## Unavailable or skipped URLs", ""])
    rows = db.execute(
        "SELECT state, url, last_error FROM queue WHERE state IN ('failed','skipped') ORDER BY state,url"
    ).fetchall()
    for state, url, error in rows:
        lines.append(f"- **{state}** [{url}]({url}) — {error or 'no detail'}")
    (archive_dir / "CRAWL_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def breed_slug(url: str) -> str:
    return PurePosixPath(urlsplit(url).path).stem.lower()


def strip_leading_heading(markdown: str) -> str:
    return re.sub(r"\A\s*# [^\n]+\n+", "", markdown, count=1).strip()


def export_breed_pages(db: sqlite3.Connection, archive_dir: Path) -> tuple[set[str], int]:
    """Combine all breed-specific source pages into one Markdown file per breed."""
    reviews = db.execute(
        "SELECT title,url,replay_url,resolved_url,capture_timestamp,fetched_at,markdown "
        "FROM pages WHERE markdown IS NOT NULL AND url LIKE '%/reviews/%' ORDER BY url"
    ).fetchall()
    review_slugs = {breed_slug(row[1]) for row in reviews}
    groups: dict[str, list[tuple[str, str, str, str, str, str, str]]] = {
        breed_slug(row[1]): [row] for row in reviews
    }
    component_urls = {row[1] for row in reviews}

    for row in db.execute(
        "SELECT title,url,replay_url,resolved_url,capture_timestamp,fetched_at,markdown "
        "FROM pages WHERE markdown IS NOT NULL AND url NOT LIKE '%/reviews/%' ORDER BY url"
    ):
        path = urlsplit(row[1]).path
        section = next((name for name in ("buying", "training", "health", "faq", "dogbreeds")
                        if path.startswith(f"/{name}/")), None)
        slug = breed_slug(row[1])
        if section and slug in review_slugs and "/articles/" not in path and "/lifespan/" not in path:
            groups[slug].append(row)
            component_urls.add(row[1])
        elif path == "/dog-breeds/yorkshire-terrier.html" and "yorkshireterriers" in groups:
            groups["yorkshireterriers"].append(row)
            component_urls.add(row[1])

    breeds_dir = archive_dir / "breeds"
    breeds_dir.mkdir(parents=True, exist_ok=True)
    for candidate in breeds_dir.glob("*.md"):
        conflict_copy = re.fullmatch(r"(.+) \d+", candidate.stem)
        if conflict_copy and conflict_copy.group(1) in review_slugs:
            candidate.unlink()

    old_paths = [row[0] for row in db.execute("SELECT markdown_path FROM breed_pages")]
    for relative in old_paths:
        (archive_dir / relative).unlink(missing_ok=True)
    db.execute("DELETE FROM breed_pages")

    for url in component_urls:
        old = db.execute("SELECT markdown_path FROM pages WHERE url=?", (url,)).fetchone()
        if old and old[0]:
            (archive_dir / old[0]).unlink(missing_ok=True)
        db.execute("UPDATE pages SET markdown_path=NULL WHERE url=?", (url,))

    label_order = {
        "reviews": (0, "Breed overview and temperament"),
        "dogbreeds": (1, "Additional archived breed information"),
        "dog-breeds": (1, "Additional archived breed information"),
        "buying": (2, "Buying or adopting"),
        "training": (3, "Training"),
        "health": (4, "Health and feeding"),
        "faq": (5, "Frequently asked questions"),
    }
    generated_at = utc_now()

    for slug, components in groups.items():
        review = components[0]
        name = re.split(r":\s*What(?:'|’)s Good About", review[0], maxsplit=1, flags=re.I)[0].strip()
        ordered = sorted(
            components,
            key=lambda row: (label_order.get(urlsplit(row[1]).path.strip("/").split("/", 1)[0], (99, "Other"))[0], row[1]),
        )
        seen_bodies: set[str] = set()
        duplicate_urls: set[str] = set()
        body_lines = [f"# {name}", "", "This guide combines every archived page for this breed into one document.", ""]
        retained = []
        for title, url, replay, resolved, captured, fetched, body in ordered:
            if body in seen_bodies:
                duplicate_urls.add(url)
                continue
            seen_bodies.add(body)
            retained.append((title, url, replay, resolved, captured, fetched, body))
            section = urlsplit(url).path.strip("/").split("/", 1)[0]
            label = label_order.get(section, (99, "Additional information"))[1]
            body_lines.extend([f"## {label}", "", strip_leading_heading(body), ""])

        body_lines.extend(["## Archived source pages", ""])
        for title, url, _, _, captured, _, _ in ordered:
            duplicate_note = " — duplicate content consolidated above" if url in duplicate_urls else ""
            body_lines.append(f"- [{title}]({url}) — capture `{captured or 'unknown'}`{duplicate_note}")
        body_lines.append("")
        source_urls = [row[1] for row in ordered]
        header = [
            "---",
            f"title: {yaml_string(name)}",
            f"breed_slug: {yaml_string(slug)}",
            f"component_count: {len(ordered)}",
            f"unique_content_sections: {len(retained)}",
            f"generated_at: {yaml_string(generated_at)}",
            "source_urls:",
            *(f"  - {yaml_string(url)}" for url in source_urls),
            "---",
            "",
        ]
        combined = "\n".join(header + body_lines)
        path = breeds_dir / f"{slug}.md"
        path.write_text(combined, encoding="utf-8")
        relative = path.relative_to(archive_dir).as_posix()
        db.execute(
            "INSERT INTO breed_pages(slug,title,markdown_path,markdown,component_urls,updated_at) "
            "VALUES (?,?,?,?,?,?)",
            (slug, name, relative, combined, json.dumps(source_urls, ensure_ascii=False), generated_at),
        )
    db.commit()
    return component_urls, len(groups)


def export_all(db: sqlite3.Connection, archive_dir: Path) -> int:
    pages_dir = archive_dir / "pages"
    component_urls, breed_count = export_breed_pages(db, archive_dir)
    count = 0
    rows = db.execute(
        "SELECT title, url, replay_url, resolved_url, capture_timestamp, fetched_at, markdown "
        "FROM pages WHERE status_code = 200 AND markdown IS NOT NULL ORDER BY url"
    )
    for title, url, replay, resolved, captured, fetched, body in rows:
        if url in component_urls:
            continue
        path = markdown_path(url, pages_dir)
        write_markdown(path, title=title, url=url, replay=replay, resolved=resolved or replay,
                       captured=captured, fetched=fetched, body=body)
        db.execute("UPDATE pages SET markdown_path=? WHERE url=?", (path.relative_to(archive_dir).as_posix(), url))
        count += 1
    db.commit()
    export_index(db, archive_dir)
    export_report(db, archive_dir)
    return count + breed_count


def next_pending(db: sqlite3.Connection) -> str | None:
    row = db.execute(
        "SELECT url FROM queue WHERE state='pending' ORDER BY CASE WHEN discovered_from IS NULL THEN 0 ELSE 1 END, url LIMIT 1"
    ).fetchone()
    return row[0] if row else None


def crawl(args: argparse.Namespace) -> int:
    archive_dir = Path(args.output).resolve()
    archive_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(archive_dir / "site.db")
    db.execute("PRAGMA busy_timeout=5000")
    seed = normalize_url(args.seed)
    if not seed:
        raise SystemExit("Seed must be an http(s) URL on yourpurebredpuppy.com")
    init_db(db, seed, args.timestamp)
    purged = purge_excluded_pages(db, archive_dir)
    if purged:
        print(f"Removed {purged} excluded promotional book pages.")

    if args.export_only:
        count = export_all(db, archive_dir)
        print(f"Exported {count} pages to {archive_dir}")
        return 0

    if args.retry_failed:
        db.execute("UPDATE queue SET state='pending', last_error=NULL WHERE state='failed'")
    db.execute("UPDATE queue SET state='pending' WHERE state='processing'")
    db.commit()

    session = requests.Session()
    session.headers["User-Agent"] = args.user_agent
    processed = 0
    while args.max_pages <= 0 or processed < args.max_pages:
        url = next_pending(db)
        if not url:
            break
        now = utc_now()
        db.execute(
            "UPDATE queue SET state='processing', attempts=attempts+1, updated_at=? WHERE url=?",
            (now, url),
        )
        db.commit()
        replay = replay_url(url, args.timestamp)

        response = None
        error = None
        for attempt in range(args.retries + 1):
            try:
                response = session.get(replay, timeout=args.timeout, allow_redirects=True)
                if response.status_code not in {429, 500, 502, 503, 504}:
                    break
                error = f"HTTP {response.status_code}"
            except requests.RequestException as exc:
                error = str(exc)
            if attempt < args.retries:
                time.sleep(min(30, 2 ** attempt * 2))

        fetched = utc_now()
        if response is None or response.status_code != 200:
            status = response.status_code if response is not None else None
            error = error or f"HTTP {status}"
            db.execute(
                "INSERT OR REPLACE INTO pages(url,replay_url,resolved_url,capture_timestamp,fetched_at,status_code,content_type,error) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (url, replay, response.url if response is not None else None,
                 capture_timestamp(response.url) if response is not None else None,
                 fetched, status, response.headers.get("content-type") if response is not None else None, error),
            )
            db.execute("UPDATE queue SET state='failed', last_error=?, updated_at=? WHERE url=?", (error, fetched, url))
            db.commit()
            processed += 1
            print(f"[{processed}] FAIL {status or '-'} {url}: {error}", flush=True)
            continue

        content_type = response.headers.get("content-type", "")
        resolved_original = replayed_original_url(response.url)
        if resolved_original and (urlsplit(resolved_original).hostname or "").lower() not in ALLOWED_HOSTS:
            error = f"external redirect to {resolved_original}"
            db.execute(
                "INSERT OR REPLACE INTO pages(url,replay_url,resolved_url,capture_timestamp,fetched_at,status_code,content_type,error) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (url, replay, response.url, capture_timestamp(response.url), fetched,
                 response.status_code, content_type, error),
            )
            db.execute("UPDATE queue SET state='skipped', last_error=?, updated_at=? WHERE url=?", (error, fetched, url))
            db.commit()
            processed += 1
            print(f"[{processed}] SKIP {error}", flush=True)
            continue
        if "html" not in content_type.lower():
            db.execute(
                "INSERT OR REPLACE INTO pages(url,replay_url,resolved_url,capture_timestamp,fetched_at,status_code,content_type,error) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (url, replay, response.url, capture_timestamp(response.url), fetched,
                 response.status_code, content_type, "non-HTML response"),
            )
            db.execute("UPDATE queue SET state='skipped', last_error='non-HTML response', updated_at=? WHERE url=?", (fetched, url))
            db.commit()
            processed += 1
            print(f"[{processed}] SKIP non-HTML {url}", flush=True)
            continue

        response.encoding = response.encoding or "utf-8"
        html = response.text
        title, body, links = extract_page(html, url)
        digest = hashlib.sha256(response.content).hexdigest()
        relative_path = markdown_path(url, archive_dir / "pages").relative_to(archive_dir).as_posix()
        db.execute(
            "INSERT OR REPLACE INTO pages(url,replay_url,resolved_url,capture_timestamp,fetched_at,status_code,content_type,title,markdown_path,sha256,raw_html,markdown,error) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)",
            (url, replay, response.url, capture_timestamp(response.url), fetched, response.status_code,
             content_type, title, relative_path, digest, response.content, body),
        )
        for target in links:
            db.execute("INSERT OR IGNORE INTO links(source_url,target_url) VALUES (?,?)", (url, target))
            db.execute(
                "INSERT OR IGNORE INTO queue(url,state,discovered_from,updated_at) VALUES (?,'pending',?,?)",
                (target, url, fetched),
            )
        db.execute("UPDATE queue SET state='done', last_error=NULL, updated_at=? WHERE url=?", (fetched, url))
        db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES ('updated_at',?)", (fetched,))
        db.commit()
        processed += 1
        totals = db.execute("SELECT state, count(*) FROM queue GROUP BY state").fetchall()
        summary = " ".join(f"{state}={count}" for state, count in totals)
        print(f"[{processed}] OK {title} | links={len(links)} | {summary}", flush=True)
        if args.delay:
            time.sleep(args.delay)

    count = export_all(db, archive_dir)
    totals = dict(db.execute("SELECT state, count(*) FROM queue GROUP BY state"))
    print(f"Exported {count} Markdown pages. Queue: {json.dumps(totals, sort_keys=True)}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--timestamp", default=DEFAULT_TIMESTAMP)
    parser.add_argument("--output", default="archive")
    parser.add_argument("--delay", type=float, default=0.25, help="delay between successful requests")
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--max-pages", type=int, default=0, help="0 means unlimited")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    parser.add_argument(
        "--user-agent",
        default="Mozilla/5.0 (compatible; YourPurebredPuppyResearchArchive/1.0; local preservation)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    try:
        raise SystemExit(crawl(parse_args()))
    except KeyboardInterrupt:
        print("Interrupted; progress is saved and the next run will resume.", file=sys.stderr)
        raise SystemExit(130)
