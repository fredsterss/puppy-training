#!/usr/bin/env python3
"""Replace post-cutoff Wayback resolutions with the latest earlier capture."""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
import time
from pathlib import Path

import requests

from crawl_wayback import (
    ALLOWED_HOSTS,
    capture_timestamp,
    export_all,
    extract_page,
    markdown_path,
    replayed_original_url,
    utc_now,
)


def latest_capture(session: requests.Session, url: str, cutoff: str) -> tuple[str, str] | None:
    params = {
        "url": url,
        "to": cutoff,
        "output": "json",
        "filter": ["statuscode:200", "mimetype:text/html"],
        "fl": "timestamp,original",
        "limit": "10000",
    }
    response = None
    for attempt in range(6):
        try:
            response = session.get("https://web.archive.org/cdx/search/cdx", params=params, timeout=60)
            if response.status_code not in {429, 500, 502, 503, 504}:
                response.raise_for_status()
                break
        except requests.RequestException:
            if attempt == 5:
                raise
        if attempt == 5:
            response.raise_for_status()
        time.sleep(min(30, 2 ** (attempt + 1)))
    assert response is not None
    rows = response.json()
    candidates = [(row[0], row[1]) for row in rows[1:] if row and row[0] <= cutoff]
    return max(candidates, default=None)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="archive")
    parser.add_argument("--cutoff", default="20230506235959")
    parser.add_argument("--delay", type=float, default=0.25)
    args = parser.parse_args()

    archive_dir = Path(args.output).resolve()
    db = sqlite3.connect(archive_dir / "site.db")
    rows = db.execute(
        "SELECT url, markdown_path FROM pages WHERE markdown IS NOT NULL AND capture_timestamp > ? ORDER BY url",
        (args.cutoff,),
    ).fetchall()
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0 (compatible; YourPurebredPuppyResearchArchive/1.0; local preservation)"

    repaired = unavailable = failed = 0
    for index, (url, old_path) in enumerate(rows, 1):
        try:
            capture = latest_capture(session, url, args.cutoff)
            if not capture:
                unavailable += 1
                error = f"no HTML capture at or before cutoff {args.cutoff}"
                db.execute("UPDATE queue SET state='failed',last_error=?,updated_at=? WHERE url=?", (error, utc_now(), url))
                db.execute("UPDATE pages SET markdown=NULL,markdown_path=NULL,raw_html=NULL,error=? WHERE url=?", (error, url))
                if old_path:
                    (archive_dir / old_path).unlink(missing_ok=True)
                db.commit()
                print(f"[{index}/{len(rows)}] UNAVAILABLE {url}", flush=True)
                continue

            timestamp, captured_original = capture
            replay = f"https://web.archive.org/web/{timestamp}id_/{captured_original}"
            response = session.get(replay, timeout=60, allow_redirects=True)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            resolved_original = replayed_original_url(response.url)
            resolved_host = (requests.utils.urlparse(resolved_original).hostname or "").lower() if resolved_original else ""
            if "html" not in content_type.lower() or (resolved_original and resolved_host not in ALLOWED_HOSTS):
                raise RuntimeError(f"capture resolved outside HTML site scope: {response.url}")

            response.encoding = response.encoding or "utf-8"
            title, body, links = extract_page(response.text, url)
            fetched = utc_now()
            relative = markdown_path(url, archive_dir / "pages").relative_to(archive_dir).as_posix()
            db.execute("DELETE FROM links WHERE source_url=?", (url,))
            for target in links:
                db.execute("INSERT OR IGNORE INTO links(source_url,target_url) VALUES (?,?)", (url, target))
                db.execute(
                    "INSERT OR IGNORE INTO queue(url,state,discovered_from,updated_at) VALUES (?,'pending',?,?)",
                    (target, url, fetched),
                )
            db.execute(
                "UPDATE pages SET replay_url=?,resolved_url=?,capture_timestamp=?,fetched_at=?,status_code=?,content_type=?,"
                "title=?,markdown_path=?,sha256=?,raw_html=?,markdown=?,error=NULL WHERE url=?",
                (replay, response.url, capture_timestamp(response.url) or timestamp, fetched, response.status_code,
                 content_type, title, relative, hashlib.sha256(response.content).hexdigest(), response.content, body, url),
            )
            db.execute("UPDATE queue SET state='done',last_error=NULL,updated_at=? WHERE url=?", (fetched, url))
            db.commit()
            repaired += 1
            print(f"[{index}/{len(rows)}] OK {timestamp} {url}", flush=True)
        except Exception as exc:
            failed += 1
            print(f"[{index}/{len(rows)}] ERROR {url}: {exc}", flush=True)
        time.sleep(args.delay)

    exported = export_all(db, archive_dir)
    print(f"Repaired={repaired} unavailable={unavailable} errors={failed} exported={exported}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
