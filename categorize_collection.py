#!/usr/bin/env python3
"""Editorially categorize every browsable document in the local archive."""

from __future__ import annotations

import csv
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


TIER_LABELS = {
    "R": "Breed, selection, and acquisition reference",
    "A": "Core practical training",
    "B": "Useful supplemental",
    "C": "Opinion, personal story, review, or polemic",
    "D": "Commercial, navigation, administration, or remnant",
}

BEHAVIOR_SLUGS = {
    "abused-rescue-dogs", "aggression", "calmness-indoors", "cats-and-dogs-together",
    "dog-behavior-problems", "dog-socializing", "dog-socializing-n",
    "excitable-submissive-urination", "family-consistency", "multiple-dogs",
    "stop-demanding-behaviors", "stop-puppy-barking", "stop-puppy-jumping",
    "stop-puppy-nipping-biting",
}

TRAINING_CONTEXT = {
    "all-a-dog-needs-is-love": ("B", "Training philosophy presented as opinionated supporting context."),
    "dog-respect-training": ("B", "Author's overarching training philosophy; useful context but not a neutral protocol."),
    "dog-training-help": ("B", "Advice for selecting training help; partly evaluative and promotional."),
    "dog-training-methods": ("B", "Comparison of training methods from the author's viewpoint."),
}

OPINION_HEALTH = {
    "assisi-loop-review": "Personal account of treating the author's dog and reviewing a device.",
    "feeding-dog-food-package": "Sensationalized critique of pet-food labeling and manufacturers.",
    "feeding-grain-free-dog-food": "Dated and controversial nutrition claims presented prescriptively.",
    "feeding-homemade-dog-food-delivered": "Commercial food-service recommendation/review.",
    "feeding-kibble-canned-dog-food": "Ranked commercial food recommendations.",
    "feeding-my-vet-says-about-dog-food": "Polemic about veterinarians, pet-food education, and profit motives.",
    "pet-insurance": "Consumer product review rather than general veterinary guidance.",
}

MEDICAL_ARTICLES = {
    "dog-health-care-intro", "dog-lifespan", "dog-lifespan-quiz", "finding-the-best-dog-vet",
    "neutering-male-dog", "puppy-shots-and-dog-vaccinations", "spaying-female-dog",
}

SELECTION_TRAIT_PREFIX = "dog-breed-traits"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug(path: str) -> str:
    return Path(path).stem.lower()


def record(path: str, title: str, topic: str, tier: str, form: str,
           rationale: str, caution: str = "") -> dict[str, str]:
    return {
        "path": path,
        "title": title,
        "topic": topic,
        "tier": tier,
        "tier_label": TIER_LABELS[tier],
        "content_form": form,
        "caution": caution,
        "rationale": rationale,
    }


def classify(path: str, title: str) -> dict[str, str]:
    item = slug(path)
    if path.startswith("breeds/"):
        return record(path, title, "Breed guides", "R", "Consolidated reference",
                      "Combined breed overview, acquisition, training, health, and FAQ material.")

    if path.startswith("pages/training/articles/"):
        if item == "dog-training-videos":
            return record(path, title, "Personal stories, reviews, and polemics", "C", "Affiliate-style review",
                          "Personal results story and recommendation for a commercial video service.")
        if item in TRAINING_CONTEXT:
            tier, rationale = TRAINING_CONTEXT[item]
            return record(path, title, "Training philosophy and resources", tier, "Essay or resource guide", rationale)
        if item in BEHAVIOR_SLUGS:
            return record(path, title, "Behavior and socialization", "A", "Practical guidance",
                          "Action-oriented behavior management or socialization material.")
        return record(path, title, "Core practical training", "A", "Step-by-step training guide",
                      "Directly actionable puppy or dog training instruction.")

    if path == "pages/training/index.md":
        return record(path, title, "Navigation and administrative material", "D", "Section landing page",
                      "Primarily routes readers to training articles and products.")

    if path.startswith("pages/buying/articles/"):
        if item.startswith(SELECTION_TRAIT_PREFIX) or item in {
            "do-dogs-need-fenced-yard", "dog-if-you-work-all-day", "male-female-dogs",
            "puppy-or-adult-dog", "should-you-get-a-dog", "what-a-dog-is-like",
        }:
            return record(path, title, "Breed and lifestyle selection", "R", "Decision guide",
                          "Helps match a dog or breed to household, lifestyle, and preferences.")
        if item in {"crossbred-dogs", "mixed-breed-dogs", "purebred-dogs", "petshops-and-pet-stores"}:
            return record(path, title, "Choosing and acquiring a dog", "R", "Opinionated acquisition guide",
                          "Useful acquisition context presented with strong authorial judgments.")
        return record(path, title, "Choosing and acquiring a dog", "R", "Acquisition guide",
                      "Practical guidance on breeders, shelters, rescues, registration, or puppy selection.")

    if path == "pages/buying/index.md":
        return record(path, title, "Navigation and administrative material", "D", "Section landing page",
                      "Primarily an index to acquisition and selection content.")

    if path.startswith("pages/breedconsulting/"):
        return record(path, title, "Commercial books and services", "D", "Consulting sales/support page",
                      "Supports or promotes the author's paid breed-consulting service.")

    if path.startswith("pages/health/articles/"):
        if item in OPINION_HEALTH:
            return record(path, title, "Personal stories, reviews, and polemics", "C", "Review or polemic",
                          OPINION_HEALTH[item], "Archived health-related opinion; verify claims with current veterinary sources.")
        if item in MEDICAL_ARTICLES:
            return record(path, title, "Veterinary and preventive health", "B", "Health guidance",
                          "Potentially useful background, but medical recommendations may be dated.",
                          "Archived medical content; consult a veterinarian and current guidelines.")
        return record(path, title, "Nutrition and feeding", "B", "Feeding guidance",
                      "Substantive feeding advice, but strongly reflects the author's dietary viewpoint.",
                      "Archived nutrition content; verify safety and current evidence with a veterinarian.")

    if path.startswith("pages/health/lifespan/"):
        return record(path, title, "Navigation and administrative material", "D", "Interactive quiz remnant",
                      "Static fragment of an interactive lifespan questionnaire; little standalone value.",
                      "Archived health content; not a lifespan prediction tool.")

    if path == "pages/health/index.md":
        return record(path, title, "Navigation and administrative material", "D", "Section landing page",
                      "Primarily routes readers to health, feeding, and commercial material.")

    if path.startswith("pages/books/"):
        return record(path, title, "Commercial books and services", "D", "Book sales/support page",
                      "Promotes, describes, downloads, or supports the author's commercial books.")

    if path.startswith("pages/dogbreeds/"):
        return record(path, title, "Navigation and administrative material", "D", "Breed index",
                      "Legacy size/category index superseded by the consolidated breed guides.")

    if path in {"pages/about.md"}:
        return record(path, title, "Navigation and administrative material", "D", "Author biography",
                      "Background about the author rather than dog-care guidance.")

    return record(path, title, "Navigation and administrative material", "D", "Site administration or navigation",
                  "Homepage, FAQ, sitemap, legal/privacy text, or technical remnant.")


def write_audit(entries: list[dict[str, str]], output: Path) -> None:
    tier_counts = Counter(entry["tier"] for entry in entries)
    topic_counts = Counter(entry["topic"] for entry in entries)
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for entry in entries:
        grouped[entry["topic"]].append(entry)

    topic_order = [
        "Breed guides", "Core practical training", "Behavior and socialization",
        "Training philosophy and resources", "Choosing and acquiring a dog",
        "Breed and lifestyle selection", "Nutrition and feeding",
        "Veterinary and preventive health", "Personal stories, reviews, and polemics",
        "Commercial books and services", "Navigation and administrative material",
    ]
    lines = [
        "# Editorial category audit", "",
        f"Documents audited: {len(entries)}", "",
        "This is an editorial utility audit of the archived collection, not a factual endorsement. "
        "Health and nutrition pages are historical material from the source site and may conflict "
        "with current veterinary evidence or guidance.", "",
        "Class **R** contains breed guides plus breed-selection and dog-acquisition references. "
        "Tier **A** is reserved exclusively for practical training and behavior protocols.", "",
        "## Utility tiers", "",
        "| Tier | Meaning | Documents |", "|---|---|---:|",
    ]
    for tier in ("R", "A", "B", "C", "D"):
        lines.append(f"| {tier} | {TIER_LABELS[tier]} | {tier_counts[tier]} |")

    lines.extend(["", "## Topic summary", "", "| Category | Documents |", "|---|---:|"])
    for topic in topic_order:
        lines.append(f"| {topic} | {topic_counts[topic]} |")

    lines.extend([
        "", "## Recommended starting points", "",
        "- [Perfect Puppy Manners, Just 23 Steps](pages/training/articles/23-steps-to-perfect-puppy-manners.md)",
        "- [Puppy Training Schedule](pages/training/articles/puppy-training-schedule.md)",
        "- [Crate Training](pages/training/articles/crate-training.md)",
        "- [Housebreaking](pages/training/articles/dog-housebreaking.md)",
        "- [Socializing Your Puppy or Adult Dog](pages/training/articles/dog-socializing.md)",
        "- [Leash Training](pages/training/articles/leash-training.md)",
        "- [Come When Called](pages/training/articles/come-when-called.md)",
        "- [Stop Puppy Nipping and Biting](pages/training/articles/stop-puppy-nipping-biting.md)",
        "- [Consolidated breed guides](INDEX.md#r-breed-and-acquisition-reference)", "",
    ])

    for topic in topic_order:
        topic_entries = sorted(grouped[topic], key=lambda item: (item["tier"], item["title"].lower()))
        lines.extend([f"## {topic} ({len(topic_entries)})", ""])
        for entry in topic_entries:
            detail = entry["rationale"]
            if entry["caution"]:
                detail += f" **Caution:** {entry['caution']}"
            lines.append(
                f"- **{entry['tier']}** [{entry['title']}]({entry['path']}) — {detail}"
            )
        lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")


def write_curated_index(entries: list[dict[str, str]], archive: Path) -> None:
    tier_names = {
        "A": "A: Core practical training",
        "B": "B: Useful supplemental",
        "R": "R: Breed and acquisition reference",
    }
    topic_order = [
        "Core practical training", "Behavior and socialization",
        "Choosing and acquiring a dog", "Breed and lifestyle selection",
        "Training philosophy and resources", "Nutrition and feeding",
        "Veterinary and preventive health", "Breed guides",
    ]
    selected = {tier: [item for item in entries if item["tier"] == tier] for tier in ("A", "B", "R")}
    lines = [
        "# Your Purebred Puppy archive", "",
        "A curated index of the useful material in the archive.", "",
        "## Browse by utility", "",
        f"- [A: Core practical training](#a-core-practical-training) ({len(selected['A'])})",
        f"- [B: Useful supplemental](#b-useful-supplemental) ({len(selected['B'])})",
        f"- [R: Breed and acquisition reference](#r-breed-and-acquisition-reference) ({len(selected['R'])})", "",
    ]

    for tier in ("A", "B", "R"):
        lines.extend([f"## {tier_names[tier]}", "", f"Documents: {len(selected[tier])}", ""])
        if tier == "R":
            for topic in ("Choosing and acquiring a dog", "Breed and lifestyle selection"):
                topic_items = sorted(
                    (item for item in selected[tier] if item["topic"] == topic),
                    key=lambda row: row["title"].lower(),
                )
                lines.extend([f"### {topic} ({len(topic_items)})", ""])
                lines.extend(f"- [{item['title']}]({item['path']})" for item in topic_items)
                lines.append("")

            by_letter: dict[str, list[dict[str, str]]] = defaultdict(list)
            breed_items = [item for item in selected[tier] if item["topic"] == "Breed guides"]
            for item in sorted(breed_items, key=lambda row: row["title"].lower()):
                letter = next((char.upper() for char in item["title"] if char.isalpha()), "#")
                by_letter[letter].append(item)
            lines.extend([
                " · ".join(f"[{letter}](#breed-reference-{letter.lower()})" for letter in by_letter), "",
            ])
            for letter, items in by_letter.items():
                lines.extend([f"### Breed reference: {letter}", ""])
                lines.extend(f"- [{item['title']}]({item['path']})" for item in items)
                lines.append("")
            continue

        for topic in topic_order:
            items = sorted(
                (item for item in selected[tier] if item["topic"] == topic),
                key=lambda row: row["title"].lower(),
            )
            if not items:
                continue
            lines.extend([f"### {topic} ({len(items)})", ""])
            for item in items:
                caution = " — ⚠ archived medical/nutrition guidance" if item["caution"] else ""
                lines.append(f"- [{item['title']}]({item['path']}){caution}")
            lines.append("")

    hidden = [item for item in entries if item["tier"] in {"C", "D"}]
    lines.extend([
        "## Appendix", "",
        f"{len(hidden)} opinion/review, commercial, navigation, and administrative documents are "
        "kept out of the main index.", "",
        "[View the appendix](APPENDIX.md)", "",
    ])
    (archive / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")


def write_appendix(entries: list[dict[str, str]], archive: Path) -> None:
    lines = [
        "# Appendix", "",
        "Tier C and D documents are preserved here but intentionally omitted from the main curated index.", "",
        "- [Return to the curated index](INDEX.md)",
        "- [Full editorial audit](CATEGORY_AUDIT.md)",
        "- [Structural source index](SOURCE_INDEX.md)",
        "- [All documents alphabetically](ALPHABETICAL.md)", "",
    ]
    for tier in ("C", "D"):
        items = sorted((item for item in entries if item["tier"] == tier), key=lambda row: row["title"].lower())
        lines.extend([f"## {tier}: {TIER_LABELS[tier]} ({len(items)})", ""])
        for item in items:
            detail = item["rationale"]
            if item["caution"]:
                detail += f" **Caution:** {item['caution']}"
            lines.append(f"- [{item['title']}]({item['path']}) — {detail}")
        lines.append("")
    (archive / "APPENDIX.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parent
    archive = root / "archive"
    db = sqlite3.connect(archive / "site.db")
    rows = db.execute(
        "SELECT markdown_path,title FROM pages WHERE markdown_path IS NOT NULL "
        "UNION ALL SELECT markdown_path,title FROM breed_pages ORDER BY markdown_path"
    ).fetchall()
    entries = [classify(path, title) for path, title in rows]
    generated = now()

    db.execute(
        "CREATE TABLE IF NOT EXISTS content_catalog ("
        "path TEXT PRIMARY KEY,title TEXT NOT NULL,topic TEXT NOT NULL,tier TEXT NOT NULL,"
        "tier_label TEXT NOT NULL,content_form TEXT NOT NULL,caution TEXT NOT NULL,"
        "rationale TEXT NOT NULL,updated_at TEXT NOT NULL)"
    )
    db.execute("DELETE FROM content_catalog")
    db.executemany(
        "INSERT INTO content_catalog(path,title,topic,tier,tier_label,content_form,caution,rationale,updated_at) "
        "VALUES (:path,:title,:topic,:tier,:tier_label,:content_form,:caution,:rationale,:updated_at)",
        [{**entry, "updated_at": generated} for entry in entries],
    )
    db.commit()

    fields = ["path", "title", "topic", "tier", "tier_label", "content_form", "caution", "rationale"]
    with (archive / "CONTENT_CATALOG.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(entries)
    (archive / "CONTENT_CATALOG.json").write_text(
        json.dumps({"generated_at": generated, "documents": entries}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_audit(entries, archive / "CATEGORY_AUDIT.md")
    write_curated_index(entries, archive)
    write_appendix(entries, archive)

    print(f"Categorized {len(entries)} documents")
    for tier in ("R", "A", "B", "C", "D"):
        print(f"  {tier}: {sum(entry['tier'] == tier for entry in entries)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
