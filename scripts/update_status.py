"""Sync castaway statuses in data/castaways.json from the Survivor 51 Wikipedia page.

Reads the "Contestants" table (tribe + finish for each castaway) and the episode
list (to map elimination days to episodes). Bios and photos are never touched.
Castaways with "manualOverride": true are skipped so hand edits always win.

Standard library only. Usage: python scripts/update_status.py [--dry-run]
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WIKI_URL = "https://en.wikipedia.org/w/index.php?title=Survivor_51&action=raw"
USER_AGENT = "ProbstsPosseDraftTracker/1.0 (https://github.com/dylanl280/probstsposse)"
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "castaways.json"
SYNCED_FIELDS = ("tribe", "originalTribe", "status", "finish", "day", "episodeOut", "bootOrder")
MIN_MATCHED_ROWS = 18


def fetch_wikitext():
    req = urllib.request.Request(WIKI_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def split_outside_templates(text, sep):
    """Split on sep, ignoring occurrences inside {{...}} or [[...]]."""
    parts, depth, buf, i = [], 0, "", 0
    while i < len(text):
        two = text[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            buf += two
            i += 2
        elif two in ("}}", "]]"):
            depth = max(0, depth - 1)
            buf += two
            i += 2
        elif depth == 0 and text.startswith(sep, i):
            parts.append(buf)
            buf = ""
            i += len(sep)
        else:
            buf += text[i]
            i += 1
    parts.append(buf)
    return parts


def strip_cell_attributes(cell):
    """'rowspan="2" bgcolor="x" | content' -> (attrs, content)."""
    parts = split_outside_templates(cell, "|")
    if len(parts) > 1 and re.fullmatch(r'\s*(?:[\w-]+\s*=\s*("[^"]*"|\S+)\s*)+', parts[0]):
        return parts[0], "|".join(parts[1:])
    # Attributes may also precede a template without a pipe, e.g. 'rowspan="2" {{stribe|x}}'
    m = re.match(r'\s*((?:[\w-]+\s*=\s*"[^"]*"\s*)+)(.*)$', cell, re.S)
    if m:
        return m.group(1), m.group(2)
    return "", cell


def plain_text(wikitext):
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", wikitext, flags=re.S)
    text = re.sub(r"\{\{efn[^{}]*\}\}", "", text)
    text = re.sub(r"\{\{nowrap\|([^{}]*)\}\}", r"\1", text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"'{2,}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def tribes_in(cell):
    return [t.strip().lower() for t in re.findall(r"\{\{stribe\|([^|}]+)", cell, re.I)
            if t.strip().lower() not in ("none", "")]


def parse_contestants(wikitext):
    section = wikitext.split("==Contestants==", 1)[1]
    table = section[section.index("{|"):section.index("\n|}")]
    rows = re.split(r"\n\|-[^\n]*", table)
    carried = []  # [remaining_rows, cell_text] for rowspan cells
    contestants = []
    for row in rows:
        name = re.search(r"\{\{sortname\|([^|}]*)\|([^|}]*)", row)
        if not name:
            continue
        cells = []
        for line in row.split("\n"):
            if line.startswith("|") and not line.startswith(("|+", "|}")):
                cells.extend(split_outside_templates(line[1:], "||"))
        # Cells spanning down from earlier rows still apply to this one
        inherited = [content for _, content in carried]
        carried = [[left - 1, content] for left, content in carried if left > 1]
        parsed = []
        for cell in cells:
            attrs, content = strip_cell_attributes(cell)
            span = re.search(r'rowspan\s*=\s*"?(\d+)', attrs)
            if span and int(span.group(1)) > 1:
                carried.append([int(span.group(1)) - 1, content])
            parsed.append(content)

        all_cells = parsed + inherited
        tribe_list = [t for cell in all_cells for t in tribes_in(cell)]
        finish, day = "", None
        for cell in all_cells:
            text = plain_text(cell)
            d = re.fullmatch(r"Day (\d+)", text)
            if d:
                day = int(d.group(1))
            elif re.search(r"voted out|evacuated|quit|runner|sole survivor|eliminated|lost|removed|jury",
                           text, re.I):
                finish = text
        contestants.append({
            "first": name.group(1).strip(),
            "last": name.group(2).strip(),
            "originalTribe": tribe_list[0] if tribe_list else None,
            "tribe": tribe_list[-1] if tribe_list else None,
            "finish": finish or None,
            "day": day,
        })
    return contestants


def status_from_finish(finish):
    if not finish:
        return "active"
    f = finish.lower()
    if "sole survivor" in f:
        return "winner"
    if "runner" in f:
        return "finalist"
    if "evacuated" in f:
        return "medevac"
    if re.search(r"\bquit\b", f):
        return "quit"
    if "jury" in f:
        return "jury"
    return "voted_out"


def parse_episodes(wikitext):
    """Return [(episode_number, first_day, last_day)] for aired episodes."""
    episodes = []
    for block in re.findall(r"\{\{#invoke:Episode list\|sublist(.*?)\n\}\}", wikitext, re.S):
        num = re.search(r"EpisodeNumber2\s*=\s*(\d+)", block)
        days = re.search(r"Aux1\s*=\s*Days?\s*(\d+)(?:\s*[–-]\s*(\d+))?", block)
        if num and days:
            first = int(days.group(1))
            episodes.append((int(num.group(1)), first, int(days.group(2) or first)))
    return episodes


def episode_for_day(day, episodes):
    if day is None:
        return None
    for num, _, last in episodes:
        if last == day:
            return num
    for num, first, last in episodes:
        if first <= day <= last:
            return num
    return None


def main():
    dry_run = "--dry-run" in sys.argv
    wikitext = fetch_wikitext()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    rows = parse_contestants(wikitext)
    episodes = parse_episodes(wikitext)

    by_last = {c["wikiLastName"].lower(): c for c in data["castaways"]}
    by_first = {c["shortName"].lower(): c for c in data["castaways"]}
    matched, boot_order, changes = 0, 0, []

    for row in rows:
        castaway = by_last.get(row["last"].lower()) or by_first.get(row["first"].lower())
        if not castaway:
            print(f"WARN: no castaway matches Wikipedia row {row['first']} {row['last']}")
            continue
        matched += 1
        status = status_from_finish(row["finish"])
        # Wikipedia lists contestants in finish order, earliest out first
        if status != "active":
            boot_order += 1
        update = {
            "originalTribe": row["originalTribe"] or castaway["originalTribe"],
            "tribe": row["tribe"] or castaway["tribe"],
            "status": status,
            "finish": row["finish"],
            "day": row["day"],
            "episodeOut": episode_for_day(row["day"], episodes) if status != "active" else None,
            "bootOrder": boot_order if status != "active" else None,
        }
        for tribe in (update["originalTribe"], update["tribe"]):
            if tribe and tribe not in data["tribes"]:
                data["tribes"][tribe] = {"name": tribe.title(), "color": None, "meaning": None}
                changes.append(f"new tribe: {tribe}")
        if castaway.get("manualOverride"):
            continue
        for field in SYNCED_FIELDS:
            if castaway.get(field) != update[field]:
                changes.append(f"{castaway['shortName']}.{field}: {castaway.get(field)!r} -> {update[field]!r}")
                castaway[field] = update[field]

    if matched < MIN_MATCHED_ROWS:
        sys.exit(f"ERROR: only matched {matched} contestant rows; Wikipedia layout may have changed")

    aired = re.search(r"num_episodes\s*=\s*(\d+)", wikitext)
    if aired and int(aired.group(1)) != data.get("episodesAired"):
        changes.append(f"episodesAired: {data.get('episodesAired')} -> {aired.group(1)}")
        data["episodesAired"] = int(aired.group(1))

    if not changes:
        print("No changes.")
        return
    print("\n".join(changes))
    if dry_run:
        return
    data["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
