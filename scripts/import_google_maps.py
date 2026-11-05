#!/usr/bin/env python3
"""Import Google Maps Takeout labels into the people graph (PLAN.md §7).

Two passes, resumable at any point:

  stage <files...>   Parse Takeout exports into the import_places staging
                     table. Accepts "Labeled places.json" (GeoJSON) and
                     Saved-list CSVs (Title,Note,URL). Re-running never
                     duplicates a staged row.
  review             Interactive TTY loop over pending rows: [a]ttach the
                     place to an existing person, [c]reate a new person,
                     [s]kip (restaurants etc.), [e]dit the proposed name,
                     [q]uit. Nothing enters `people` without this human pass.
  status             Counts by status, per source file.

People writes go through people_write.py (the script-only discipline);
this tool only writes its own staging table directly.

NOTE: written against the documented Takeout shapes + fabricated samples —
      shake it down against Phat's actual export before trusting it
      (Takeout formats drift; PLAN.md §10).
"""
import argparse
import csv
import json
import os
import re
import sqlite3
import subprocess
import sys

DEFAULT_DB = os.path.expanduser("~/.openclaw/data/people.sqlite")
SKILL_DIR = os.path.expanduser("~/.openclaw/skills/people-graph")

# Label suffixes that mean "this label is <person> + a place word".
NAME_SUFFIXES = [
    "house", "home", "apartment", "apt", "flat", "office", "work", "place",
    "さんの家", "さん家", "さんち", "の家", "自宅", "宅", "家", "さん",
]


def out_line(s=""):
    print(s, flush=True)


def connect(db):
    if not os.path.isfile(db):
        sys.exit(f"database not found at {db} — run people_write.py init first")
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def run_people_script(script, args, db):
    """Run people_write.py / people_query.py, return parsed JSON."""
    cmd = [sys.executable, os.path.join(SKILL_DIR, script), "--db", db, *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "errors": [f"{script} produced no JSON: {proc.stderr.strip()[:200]}"]}


# ---------------------------------------------------------------- staging ---

COORD_PATTERNS = [
    re.compile(r"/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)"),          # /maps/place/…/@lat,lng,17z
    re.compile(r"[?&]query=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)"),  # api=1&query=lat%2Clng
    re.compile(r"[?&]query=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)"),
    re.compile(r"!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)"),       # data blob
]


def coords_from_url(url):
    for pat in COORD_PATTERNS:
        m = pat.search(url or "")
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return lat, lng
    return None, None


def parse_labeled_places(path):
    """Takeout Maps → 'My labeled places/Labeled places.json' (GeoJSON)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    rows = []
    for feat in data.get("features", []):
        props = feat.get("properties", {}) or {}
        label = (props.get("name") or "").strip()
        if not label:
            continue
        lat = lng = None
        geom = feat.get("geometry") or {}
        if geom.get("type") == "Point":
            try:
                lng, lat = float(geom["coordinates"][0]), float(geom["coordinates"][1])
            except (KeyError, IndexError, TypeError, ValueError):
                lat = lng = None
        rows.append({"label": label, "address": (props.get("address") or "").strip() or None,
                     "lat": lat, "lng": lng})
    return rows


def parse_saved_csv(path):
    """Takeout Saved → '<list name>.csv' with Title,Note,URL columns.
    Note is free text, not an address — attaching uses the label instead."""
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for rec in csv.DictReader(f):
            label = (rec.get("Title") or "").strip()
            if not label:
                continue
            lat, lng = coords_from_url(rec.get("URL") or "")
            rows.append({"label": label, "address": None, "lat": lat, "lng": lng})
    return rows


def cmd_stage(args):
    con = connect(args.db)
    staged = skipped = flagged = 0
    try:
        for path in args.files:
            if not os.path.isfile(path):
                out_line(f"!! not a file, skipping: {path}")
                continue
            if path.lower().endswith(".json"):
                rows = parse_labeled_places(path)
            elif path.lower().endswith(".csv"):
                rows = parse_saved_csv(path)
            else:
                out_line(f"!! unknown format (want .json/.csv), skipping: {path}")
                continue
            src = os.path.basename(path)
            with con:
                for r in rows:
                    dup = con.execute(
                        "SELECT 1 FROM import_places WHERE label=? AND src_file=?",
                        (r["label"], src)).fetchone()
                    if dup:
                        skipped += 1
                        continue
                    con.execute(
                        """INSERT INTO import_places (label, address, lat, lng, src_file, status)
                           VALUES (?,?,?,?,?,'pending')""",
                        (r["label"], r["address"], r["lat"], r["lng"], src))
                    staged += 1
                    if r["lat"] is None:
                        flagged += 1
            out_line(f"{src}: {len(rows)} rows parsed")
    finally:
        con.close()
    out_line(f"staged {staged} new (skipped {skipped} already staged; "
             f"{flagged} without coordinates — they can still be attached)")


# ----------------------------------------------------------------- review ---

def propose_name(label):
    name = label.strip()
    lowered = name.lower()
    for suf in NAME_SUFFIXES:
        if lowered.endswith(suf.lower()) and len(name) > len(suf):
            name = name[: len(name) - len(suf)].strip(" 　'’s-—·")
            break
    return name or label


def ask(prompt):
    try:
        return input(prompt).strip()
    except EOFError:
        return "q"


def find_candidates(name, db):
    res = run_people_script("people_query.py", ["find", name], db)
    return res.get("candidates", []) if res.get("ok") else []


def attach(con, row, person_id, db):
    location = row["address"] or row["label"]
    wargs = ["set-location", "--person-id", str(person_id), "--location", location]
    if row["lat"] is not None:
        wargs += ["--lat", str(row["lat"]), "--lng", str(row["lng"])]
    else:
        wargs += ["--no-geocode"]  # a raw label is a poor geocode query; pin later in the web UI
    res = run_people_script("people_write.py", wargs, db)
    if not res.get("ok"):
        out_line("  !! set-location failed: " + "; ".join(res.get("errors", ["?"])))
        return False
    with con:
        con.execute("UPDATE import_places SET status='attached', person_id=? WHERE id=?",
                    (person_id, row["id"]))
    out_line(f"  ✓ attached to person {person_id} ({res.get('display_name')})")
    return True


def create_person(con, row, name, db):
    location = row["address"] or row["label"]
    wargs = ["add-person", "--name", name, "--location", location,
             "--source", "import", "--no-geocode"]
    if row["lat"] is not None:
        wargs += ["--lat", str(row["lat"]), "--lng", str(row["lng"])]
    res = run_people_script("people_write.py", wargs, db)
    if not res.get("ok"):
        out_line("  !! add-person failed: " + "; ".join(res.get("errors", ["?"])))
        return False
    pid = res["person"]["id"]
    for w in res.get("warnings", []):
        out_line(f"  ⚠ {w}")
    with con:
        con.execute("UPDATE import_places SET status='attached', person_id=? WHERE id=?",
                    (pid, row["id"]))
    out_line(f"  ✓ created person {pid} ({name})")
    return True


def cmd_review(args):
    con = connect(args.db)
    try:
        rows = [dict(r) for r in con.execute(
            "SELECT * FROM import_places WHERE status='pending' ORDER BY id")]
        if not rows:
            out_line("nothing pending — run `stage` first, or everything is done.")
            return
        out_line(f"{len(rows)} pending places. For each: [a]ttach to an existing person, "
                 f"[c]reate a new person, [s]kip, [e]dit name, [q]uit (resume later).")
        for i, row in enumerate(rows, 1):
            proposed = propose_name(row["label"])
            out_line("")
            out_line(f"[{i}/{len(rows)}] “{row['label']}”  (from {row['src_file']})")
            if row["address"]:
                out_line(f"     address: {row['address']}")
            out_line(f"     coords:  " + (f"{row['lat']}, {row['lng']}" if row["lat"] is not None
                                          else "none (flagged — pin later in the web UI)"))
            while True:
                out_line(f"     proposed person: “{proposed}”")
                act = ask("     action [a/c/s/e/q]: ").lower()
                if act == "q":
                    out_line("stopped — re-run `review` to resume.")
                    return
                if act == "s":
                    with con:
                        con.execute("UPDATE import_places SET status='skipped' WHERE id=?",
                                    (row["id"],))
                    out_line("  – skipped")
                    break
                if act == "e":
                    new = ask("     new name: ")
                    if new:
                        proposed = new
                    continue
                if act == "c":
                    name = ask(f"     create as (enter = “{proposed}”): ") or proposed
                    if create_person(con, row, name, args.db):
                        break
                    continue
                if act == "a":
                    q = ask(f"     search (enter = “{proposed}”): ") or proposed
                    cands = find_candidates(q, args.db)
                    if not cands:
                        out_line("  no match — try [e] then [a] again, or [c] to create.")
                        continue
                    for n, c in enumerate(cands, 1):
                        extra = " · ".join(x for x in [c.get("location"),
                                                       f"{c.get('fact_count', 0)} facts"] if x)
                        alias = f" ({', '.join(c['aliases'])})" if c.get("aliases") else ""
                        out_line(f"       {n}) {c['display_name']}{alias} — {extra}")
                    pick = ask("     pick # (enter = cancel): ")
                    if pick.isdigit() and 1 <= int(pick) <= len(cands):
                        if attach(con, row, cands[int(pick) - 1]["id"], args.db):
                            break
                    continue
                out_line("     ? a=attach c=create s=skip e=edit-name q=quit")
        out_line("")
        out_line("review complete.")
    finally:
        con.close()


def cmd_status(args):
    con = connect(args.db)
    try:
        rows = con.execute(
            """SELECT src_file, status, count(*) n FROM import_places
               GROUP BY src_file, status ORDER BY src_file, status""").fetchall()
        if not rows:
            out_line("staging table is empty — run `stage <files...>` first.")
            return
        for r in rows:
            out_line(f"{r['src_file']:40s} {r['status']:9s} {r['n']}")
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=DEFAULT_DB)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("stage", help="parse Takeout files into import_places")
    p.add_argument("files", nargs="+")
    sub.add_parser("review", help="interactive attach/create/skip pass")
    sub.add_parser("status", help="staging counts by file and status")
    args = ap.parse_args()
    {"stage": cmd_stage, "review": cmd_review, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
