#!/usr/bin/env python3
"""Flag filler words and formatting habits in the Markdown docs.

The checks follow Wikipedia's "Signs of AI writing" field guide: words and
patterns that make text vaguer, puffier or harder to scan. A hit is a
prompt to reread the sentence, not an automatic error; rewrite it plainly
or leave it if the word is used literally.

Usage: scripts/lint-docs.py [files...]   (default: every tracked *.md except docs/archive/)
Exit code 1 when anything is flagged.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

WORDS = [
    # puffery and "significance" language
    r"pivotal", r"crucial", r"vital", r"testament", r"tapestry", r"landscape",
    r"vibrant", r"profound", r"groundbreaking", r"renowned", r"nestled",
    r"in the heart of", r"rich (history|heritage)", r"enduring", r"indelible",
    r"plays? an? (key|vital|crucial|pivotal|significant) role",
    r"(serves|stands|functions|acts) as", r"boasts?", r"showcas\w*",
    r"underscor\w*", r"highlight(s|ing|ed)?", r"emphasiz\w*",
    r"delve\w*", r"intricat\w*", r"meticulous\w*", r"robust", r"seamless\w*",
    r"comprehensive", r"leverag\w*", r"foster\w*", r"garner\w*", r"enhanc\w*",
    r"valuable", r"diverse", r"align(s|ed)? with", r"resonat\w*",
    r"ensur\w*", r"additionally", r"moreover", r"furthermore", r"notably",
    # canned openers, closers and hedges
    r"it'?s (important|worth|crucial) (to note|noting|to remember)",
    r"worth noting", r"in (summary|conclusion)", r"overall,",
    r"not (only|just) .{1,40}? but", r"it'?s not just",
    r"despite (its|these|the) challenges", r"future outlook",
    r"let me know", r"i hope this helps", r"as of my",
]
WORD_RE = re.compile(r"\b(" + "|".join(WORDS) + r")\b", re.IGNORECASE)

CHAR_CHECKS = [
    (re.compile("—"), "em dash: use a period, comma, colon or parentheses"),
    (re.compile(" – "), "spaced en dash used as a dash"),
    (re.compile("[“”‘’]"), "curly quote: use straight quotes"),
]

BOLD_LEAD = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+\*\*(?:[^*]*:\*\*|[^*]+\*\*\s*[:\-])")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")

# Words that are legitimately capitalized inside sentence-case headings
PROPER = {
    "MakerVault", "Bambu", "Lab", "Suite", "Synology", "Web", "Station", "Amazon",
    "CyberBrick", "Makerworld", "GitHub", "Claude", "Code", "Hyper", "Backup",
    "ZXing", "SheetJS", "Node", "PHP", "API", "BOM", "AMS", "PWA", "SQLite",
    "JSON", "QR", "CSV", "PDF", "URL", "SKU", "UI", "iOS", "iPhone", "iPhones",
    "Mac", "NAS", "LAN", "HTTPS", "DSM", "Finder", "Mermaid", "Playwright",
    "Topps", "Binder", "SwiftUI", "FastAPI", "Xcode", "Chrome", "Safari",
    "Android", "WebKit", "OPC", "PNG", "DPI", "CI", "Escape", "Tab", "Duplicate",
    "Finder", "Select", "Settings", "Inventory", "Locations", "Dashboard",
    "Scan", "Labels", "Printers", "Import", "Reports", "Activity", "Categories",
    "Unreleased", "Added", "Fixed", "Changed", "Removed", "Now", "Next", "Later",
}


def strip_code(text):
    text = re.sub(r"```.*?```", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "``", text)


def title_case_words(heading):
    words = re.findall(r"[A-Za-z][\w'.-]*", heading)
    return [w for w in words[1:] if w[0].isupper() and w not in PROPER and not w.isupper()]


def check(path):
    problems = []
    raw = path.read_text(encoding="utf-8")
    text = strip_code(raw)
    prev_level = 0
    in_front_matter = raw.startswith("---\n")
    for n, line in enumerate(text.splitlines(), 1):
        if in_front_matter:
            if n > 1 and line.strip() == "---":
                in_front_matter = False
            continue
        if re.fullmatch(r"\s*(-{3,}|\*{3,}|_{3,})\s*", line):
            problems.append((n, "thematic break (---): headings are enough"))
        for rx, msg in CHAR_CHECKS:
            if rx.search(line):
                problems.append((n, msg))
        for m in WORD_RE.finditer(line):
            problems.append((n, f'"{m.group(0)}": say it plainly or cut it'))
        if BOLD_LEAD.search(line):
            problems.append((n, "list item starting with a bold label: use plain text or a table"))
        h = HEADING.match(line)
        if h:
            level = len(h.group(1))
            if prev_level and level > prev_level + 1:
                problems.append((n, f"heading skips from h{prev_level} to h{level}"))
            prev_level = level
            if EMOJI.search(h.group(2)):
                problems.append((n, "emoji in a heading"))
            caps = title_case_words(h.group(2))
            if len(caps) >= 2:
                problems.append((n, f"title case heading ({', '.join(caps)}): use sentence case"))
    return problems


def main():
    if len(sys.argv) > 1:
        files = [Path(f) for f in sys.argv[1:]]
    else:
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "*.md"],
                             cwd=ROOT, capture_output=True, text=True).stdout.split()
        files = [ROOT / f for f in out if not f.startswith("docs/archive/")]
    total = 0
    for f in files:
        for n, msg in check(f):
            total += 1
            shown = f.relative_to(ROOT) if f.resolve().is_relative_to(ROOT) else f
            print(f"{shown}:{n}: {msg}")
    print(f"{total} item(s) flagged" if total else "docs look clean")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
