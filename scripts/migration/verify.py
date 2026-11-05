#!/usr/bin/env python3
"""
Compare what is in the Firebase export against what is in Supabase.

This is the check that matters: not "did the import report success" but "is
every record actually there". Counts come from the database itself, and the
imported rows are counted by legacy_id so demo-seed rows are never mistaken for
migrated ones.
"""
import json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

E = {}
for line in open(os.path.join(ROOT, ".env.migration")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        E[k.strip()] = v.strip()
URL, KEY = E["SUPABASE_URL"], E["SUPABASE_SECRET_KEY"]

root = os.path.join(HERE, "export")
EXPORT = os.path.join(root, sorted(os.listdir(root))[-1])


def fb(name):
    p = os.path.join(EXPORT, f"{name}.json")
    return len(json.load(open(p))) if os.path.exists(p) else 0


def superseded_count(table="applications", schema="n365"):
    """
    Repeat applications folded into the row that superseded them.

    n365.applications allows one application per person per role, so seventeen
    Firestore rows live inside another row's raw rather than beside it. They are
    still here, so they still count — a verification that ignored them would
    report a loss that did not happen.
    """
    req = urllib.request.Request(
        f"{URL}/rest/v1/{table}?select=raw&raw->superseded=not.is.null")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    if schema:
        req.add_header("Accept-Profile", schema)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.load(r)
        return sum(len((x.get("raw") or {}).get("superseded") or []) for x in rows)
    except urllib.error.HTTPError:
        return 0


def sb(table, schema=None):
    """Count rows that came from Firebase, i.e. that carry a legacy_id."""
    req = urllib.request.Request(
        f"{URL}/rest/v1/{table}?select=id&legacy_id=not.is.null")
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Prefer", "count=exact")
    req.add_header("Range", "0-0")
    if schema:
        req.add_header("Accept-Profile", schema)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get("content-range", "0-0/0").split("/")[-1])
    except urllib.error.HTTPError as e:
        return f"ERR {e.code}"


PAIRS = [
    ("organizations",        "organizations",          None),
    ("openings",             "openings",               "n365"),
    ("pipelines",            "pipelines",              "n365"),
    ("sourcedCandidates",    "sourced_candidates",     "n365"),
    ("kickoffBriefs",        "kickoff_briefs",         "n365"),
    ("engagements",          "engagements",            "n365"),
    ("organizationDocuments","organization_documents", "n365"),
    ("engagementDocuments",  "engagement_documents",   "n365"),
    # Phase 3 — still live in Firebase, copied at cutover.
    ("candidates",           "candidates",             "n365"),
    ("applications",         "applications",           "n365"),
    ("candidateActivity",    "candidate_activity",     "n365"),
    ("candidateNotes",       "notes",                  "n365"),
    ("pipeline_messages",    "messages",               "n365"),
    ("pipelineRequests",     "requests",               "n365"),
    ("notifications",        "notifications",          "n365"),
]

print(f"export : {EXPORT}\n")
print(f"  {'collection':24} {'Firebase':>9} {'Supabase':>9}   status")
print(f"  {'-'*24} {'-'*9} {'-'*9}   {'-'*18}")
bad = 0
for src, dst, schema in PAIRS:
    a, b = fb(src), sb(dst, schema)
    folded = superseded_count() if src == "applications" else 0
    if folded and isinstance(b, int):
        b += folded
    if isinstance(b, str):
        status = b
    elif a == b:
        status = "match" + (f" ({folded} folded in)" if folded else "")
    elif b == 0:
        status = "not yet imported"
    else:
        status = f"MISSING {a - b}"
        bad += 1
    print(f"  {src:24} {a:>9} {b:>9}   {status}")

print()
sys.exit(1 if bad else 0)
