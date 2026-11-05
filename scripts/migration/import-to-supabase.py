#!/usr/bin/env python3
"""
Import the Firebase export into Supabase.

Reads the JSON written by export-firebase.py — never Firebase itself — so a run
is reproducible and costs nothing against the live project.

Every row is upserted on `legacy_id`, the original Firestore document id, and
carries the untouched source document in `raw`. Running this twice updates the
same rows instead of creating a second copy, which is what makes it safe to run
once now and again at cutover, while candidates are still arriving in Firebase.

  python3 scripts/migration/import-to-supabase.py            # dry run
  python3 scripts/migration/import-to-supabase.py --apply
  python3 scripts/migration/import-to-supabase.py --apply --only openings
"""
import json, os, re, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
APPLY = "--apply" in sys.argv
ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]


def env():
    path = os.path.join(ROOT, ".env.migration")
    if not os.path.exists(path):
        sys.exit(".env.migration not found")
    out = {}
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


E = env()
URL, KEY = E["SUPABASE_URL"], E["SUPABASE_SECRET_KEY"]


def newest_export():
    root = os.path.join(HERE, "export")
    dirs = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    if not dirs:
        sys.exit("No export found — run export-firebase.py first.")
    return os.path.join(root, dirs[-1])


EXPORT = newest_export()


# ── Firestore's wire format ────────────────────────────────────────────────
# Every value arrives wrapped in its type: {"stringValue": "x"}. Unwrap the
# whole document into ordinary JSON so it can go into `raw` and be read like
# any other dict.
def unwrap(v):
    if not isinstance(v, dict) or not v:
        return v
    k = next(iter(v))
    if k == "nullValue":
        return None
    if k in ("stringValue", "timestampValue", "bytesValue", "referenceValue"):
        return v[k]
    if k == "integerValue":
        return int(v[k])
    if k == "doubleValue":
        return float(v[k])
    if k == "booleanValue":
        return bool(v[k])
    if k == "arrayValue":
        return [unwrap(x) for x in v[k].get("values", [])]
    if k == "mapValue":
        return {a: unwrap(b) for a, b in v[k].get("fields", {}).items()}
    if k == "geoPointValue":
        return v[k]
    return v


def finite(o):
    """
    Replace NaN and Infinity with None, everywhere, recursively.

    Python writes them as bare NaN / Infinity, which is not valid JSON, and
    PostgREST rejects the whole request body one appears in — a single corrupt
    field in one candidate took down the batch of eleven it travelled with. NaN
    is not a value anyone entered, so recording "unknown" is the honest result.
    """
    if isinstance(o, float):
        return None if (o != o or o in (float("inf"), float("-inf"))) else o
    if isinstance(o, dict):
        return {k: finite(v) for k, v in o.items()}
    if isinstance(o, list):
        return [finite(v) for v in o]
    return o


def docs(name):
    path = os.path.join(EXPORT, f"{name}.json")
    if not os.path.exists(path):
        return []
    out = []
    for d in json.load(open(path)):
        row = {a: finite(unwrap(b)) for a, b in (d.get("fields") or {}).items()}
        row["__id"] = d["name"].rsplit("/", 1)[-1]
        out.append(row)
    return out


# ── Supabase REST ──────────────────────────────────────────────────────────
def call(method, path, body=None, schema=None, prefer=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Content-Type", "application/json")
    if schema:
        req.add_header("Accept-Profile", schema)
        req.add_header("Content-Profile", schema)
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else []
    except urllib.error.HTTPError as e:
        print(f"    ! HTTP {e.code}: {e.read().decode()[:900]}")
        return None


def upsert(table, rows, schema=None):
    """Insert or update on legacy_id, in batches."""
    if not rows:
        return 0
    if not APPLY:
        return len(rows)
    # PostgREST requires every object in one request to carry the same keys,
    # and clean() removes a different set from each sparse Firestore document.
    # Grouping by key signature keeps each request uniform without putting the
    # nulls back.
    groups = {}
    for r in rows:
        c = clean(r)
        groups.setdefault(frozenset(c), []).append(c)

    done = failed = 0
    for group in groups.values():
        for i in range(0, len(group), 200):
            chunk = group[i:i + 200]
            r = call("POST", f"{table}?on_conflict=legacy_id", chunk, schema,
                     "resolution=merge-duplicates,return=minimal")
            if r is None:
                failed += len(chunk)
                continue
            done += len(chunk)
    if failed:
        print(f"    ! {failed} of {len(rows)} rejected")
    return done


def fetch_map(table, schema=None):
    """legacy_id -> id, for resolving references."""
    r = call("GET", f"{table}?select=id,legacy_id&legacy_id=not.is.null&limit=5000", None, schema)
    return {x["legacy_id"]: x["id"] for x in (r or [])}


def slugify(s, fallback):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or fallback


def ts(v):
    return v if isinstance(v, str) and v else None


# Firestore's free-text `contract` against the closed set n365.openings allows.
# Anything unrecognised becomes NULL rather than guessing: the original string is
# still in `raw`, so a better mapping later is an UPDATE.
EMPLOYMENT = {
    "employment (payroll)": "full_time",
    "full time": "full_time", "full-time": "full_time", "fulltime": "full_time",
    "part time": "part_time", "part-time": "part_time",
    "freelance": "contract", "contractor": "contract", "contract": "contract",
    "temporary": "temporary", "temp": "temporary",
    "internship": "internship", "intern": "internship",
}


def employment_type(v):
    return EMPLOYMENT.get((v or "").strip().lower())


def positive(v):
    """Firestore carries -1 as 'not set' in salary fields."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return v if n > 0 else None


def clean(row):
    """
    Drop keys whose value is None.

    Sending an explicit null into a NOT NULL column fails even when that column
    has a default — Postgres only reaches for the default when the column is
    absent from the INSERT. Firestore documents are sparse (only 3 of 12
    openings carry pipelineType), so most rows have holes, and leaving the key
    out is what lets the default fill them.
    """
    return {k: v for k, v in row.items() if v is not None}


# ── Mappings ───────────────────────────────────────────────────────────────
# Only the columns worth querying on are mapped. Everything else lives in
# `raw`, so nothing is lost and a missed field is a later UPDATE.
def link_existing_orgs():
    """
    Match organizations that already exist in Supabase to their Firebase
    ancestor by name, and stamp the legacy_id on them.

    Without this the import would create a second "Nearwork" alongside the one
    the 365 seed already made — same company, two rows, and a slug collision on
    the way. Matching on name is safe at this size (three organizations, all
    distinct) and the stamp is what lets every later run upsert cleanly instead
    of colliding again.
    """
    existing = call("GET", "organizations?select=id,name,slug,legacy_id&legacy_id=is.null")
    if not existing:
        return
    by_name = {(x["name"] or "").strip().lower(): x for x in existing}
    for d in docs("organizations"):
        m = by_name.get((d.get("name") or "").strip().lower())
        if not m:
            continue
        print(f"  linking existing '{m['name']}' -> Firebase {d['__id']}")
        if APPLY:
            call("PATCH", f"organizations?id=eq.{m['id']}",
                 {"legacy_id": d["__id"]}, None, "return=minimal")


def do_organizations():
    rows = []
    for d in docs("organizations"):
        rows.append({
            "legacy_id": d["__id"],
            "name": d.get("name") or "(unnamed)",
            "slug": slugify(d.get("name"), d["__id"][:8]),
            "website": d.get("website"),
            "status": d.get("status") or "active",
            "account_manager_name": d.get("accountManagerName"),
            "account_manager_email": d.get("accountManagerEmail"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "created_via": "firebase-import",
            "raw": d,
        })
    return "organizations", None, rows


NEARWORK_LEGACY_ORG = "3xys3TelFq1OrdIXyIae"


def org_of(orgs, d):
    """
    Resolve a document's organization, falling back to Nearwork's own.

    One opening (NW-8955, cancelled) carries orgId "" in Firestore. org_id is
    NOT NULL, so the row cannot be stored as-is, and dropping it would lose a
    record. It is ours by default, so it lands under Nearwork with the blank
    original preserved in `raw`.
    """
    return orgs.get(d.get("orgId")) or orgs.get(NEARWORK_LEGACY_ORG)


def do_openings(orgs):
    rows = []
    for d in docs("openings"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": org_of(orgs, d),
            "code": d.get("code"),
            "title": d.get("title") or "(untitled)",
            "status": d.get("status") or "draft",
            "published": bool(d.get("published")),
            "pipeline_type": d.get("pipelineType") or "full",
            "recruiter": d.get("recruiter"),
            "salary_min": positive(d.get("salaryMin")),
            "salary_max": positive(d.get("salaryMax")),
            "currency": d.get("salaryCurrency") or d.get("currency"),
            "skills": d.get("skills") or [],
            "seniority": d.get("seniority"),
            "description": d.get("description") or d.get("publicSummary"),
            "location": d.get("location") or d.get("city"),
            "employment_type": employment_type(d.get("contract")),
            "source": "nearwork",
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,
        })
    return "openings", "n365", rows


def do_pipelines(orgs, openings):
    rows = []
    for d in docs("pipelines"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": org_of(orgs, d),
            "code": d.get("code"),
            "opening_id": openings.get(d.get("openingId")),
            "opening_code": d.get("code"),
            "opening_title": d.get("title"),
            "recruiter": d.get("recruiter"),
            "status": d.get("status") or "active",
            "pipeline_type": d.get("pipelineType") or "full",
            "brief_status": d.get("briefStatus"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,          # the candidates[] array rides along for phase 3
        })
    return "pipelines", "n365", rows


def do_sourced(openings):
    rows = []
    for d in docs("sourcedCandidates"):
        rows.append({
            "legacy_id": d["__id"],
            "opening_id": openings.get(d.get("openingId")),
            "legacy_opening_id": d.get("openingId"),
            "name": d.get("name") or "(unnamed)",
            "headline": d.get("headline"),
            "linkedin": d.get("linkedin") or d.get("li"),
            "location": d.get("location"),
            "country": d.get("country"),
            "salary": d.get("salary"),
            "status": d.get("status"),
            "applied": bool(d.get("applied")),
            "reason": d.get("reason"),
            "notes": d.get("notes"),
            "owner": d.get("owner"),
            "source": d.get("source"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,
        })
    return "sourced_candidates", "n365", rows


def do_kickoff(orgs, openings):
    rows = []
    for d in docs("kickoffBriefs"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(d.get("orgId")),
            "opening_id": openings.get(d.get("openingId")),
            "legacy_opening_id": d.get("openingId"),
            "status": d.get("status") or d.get("briefStatus"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,
        })
    return "kickoff_briefs", "n365", rows


def do_engagements(orgs):
    rows = []
    for d in docs("engagements"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(d.get("orgId") or d.get("organizationId")),
            "name": d.get("name") or d.get("title"),
            "status": d.get("status"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,
        })
    return "engagements", "n365", rows


def do_engagement_documents(orgs, engagements):
    rows = []
    for d in docs("engagementDocuments"):
        rows.append({
            "legacy_id": d["__id"],
            "engagement_id": engagements.get(d.get("engagementId")),
            "legacy_engagement_id": d.get("engagementId"),
            "org_id": orgs.get(d.get("orgId") or d.get("organizationId")) or orgs.get(NEARWORK_LEGACY_ORG),
            "name": d.get("name") or d.get("fileName"),
            "storage_path": d.get("path") or d.get("storagePath") or d.get("url"),
            "created_at": ts(d.get("createdAt")),
            "raw": d,
        })
    return "engagement_documents", "n365", rows


def do_org_documents(orgs):
    rows = []
    for d in docs("organizationDocuments"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(d.get("orgId") or d.get("organizationId")),
            "name": d.get("name") or d.get("fileName"),
            "storage_path": d.get("path") or d.get("storagePath") or d.get("url"),
            "created_at": ts(d.get("createdAt")),
            "raw": d,
        })
    return "organization_documents", "n365", rows


def do_candidates(orgs):
    """
    Nearwork's own candidate pool.

    None of the 192 carry an orgId in Firestore — they are ours, not a client's —
    so they land under Nearwork with source='nearwork'. That one column is the
    whole guest-versus-owned rule: a client's ATS can never surface a name that
    was never offered to them.

    The source documents carry ninety fields with years of duplication
    (linkedin/linkedIn, photoUrl/photoURL, five salary fields). Only what a
    screen filters or sorts on is mapped; the rest stays whole in `raw`.
    """
    rows = []
    for d in docs("candidates"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "code": d.get("code") or d.get("candidateCode") or d["__id"],
            "source": "nearwork",
            "origin_ref": d["__id"],
            "name": d.get("name") or "(unnamed)",
            "email": d.get("email"),
            "phone": d.get("phone"),
            "role": d.get("role") or d.get("currentRole"),
            "headline": d.get("headline"),
            "status": d.get("status"),
            "city": d.get("city") or d.get("locationCity"),
            "location": d.get("location"),
            "photo_url": d.get("photoUrl") or d.get("photoURL"),
            "cv_url": d.get("cvUrl") or d.get("cv"),
            "linkedin": d.get("linkedin") or d.get("linkedIn"),
            "skills": d.get("skills") or [],
            "tools": d.get("tools") or [],
            "english": d.get("english") or d.get("englishLevel"),
            "expected_salary_amount": positive(d.get("expectedSalaryAmount") or d.get("salaryAmount")),
            "expected_salary_currency": d.get("expectedSalaryCurrency") or d.get("salaryCurrency"),
            "work_history": d.get("workHistory") or d.get("work") or [],
            "education": d.get("education") or [],
            "certifications": d.get("certifications") or [],
            "languages": d.get("languages") or [],
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")),
            "raw": d,
        })
    return "candidates", "n365", rows


APPLICATION_STATUS = {
    "applied": "new", "new": "new", "pending": "new",
    "approved": "advanced", "advanced": "advanced", "hired": "advanced",
    "rejected": "not_selected", "declined": "not_selected",
    "not_selected": "not_selected",
}


def do_applications(orgs, openings, candidates):
    """
    Every one of the 231 resolves to a real opening and a real candidate, so
    none is dropped. opening_id and candidate_id are both NOT NULL and the links
    are what make an application mean anything.
    """
    rows, orphans = [], 0
    for d in docs("applications"):
        opening = (openings.get(d.get("openingId"))
                   or openings.get(d.get("openingCode"))
                   or openings.get(d.get("jobId")))
        cand = candidates.get(d.get("candidateDocId")) or candidates.get(d.get("candidateId"))
        if not opening or not cand:
            orphans += 1
            continue
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "opening_id": opening,
            "candidate_id": cand,
            "status": APPLICATION_STATUS.get((d.get("status") or "").lower(), "new"),
            "source": d.get("source"),
            "answers": d.get("questions") or [],
            "applied_at": ts(d.get("submittedAt")) or ts(d.get("createdAt")) or ts(d.get("updatedAt")),
            "raw": d,
        })
    if orphans:
        print(f"    note: {orphans} applications had no matching opening or candidate")

    # n365.applications is unique on (opening_id, candidate_id) — one
    # application per person per role. Seventeen pairs repeat in Firestore.
    # Rather than drop the extras, the most recent becomes the row and the
    # earlier ones are kept inside its raw under "superseded", so the full
    # history survives the move and nothing has to be fetched from Firebase to
    # answer "did they apply twice?".
    best = {}
    for r in rows:
        key = (r["opening_id"], r["candidate_id"])
        prev = best.get(key)
        if prev is None:
            best[key] = r
            continue
        keep, drop = (r, prev) if (r.get("applied_at") or "") >= (prev.get("applied_at") or "") else (prev, r)
        keep["raw"] = {**keep["raw"], "superseded": [*keep["raw"].get("superseded", []), drop["raw"]]}
        best[key] = keep

    merged = len(rows) - len(best)
    if merged:
        print(f"    note: {merged} repeat applications folded into the latest for that role")
    return "applications", "n365", list(best.values())


def do_candidate_activity(orgs, candidates):
    rows = []
    for d in docs("candidateActivity"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "candidate_id": candidates.get(d.get("candidateId") or d.get("candidateDocId")),
            "legacy_candidate_id": d.get("candidateId") or d.get("candidateDocId"),
            "type": d.get("type") or d.get("action"),
            "summary": d.get("summary") or d.get("message") or d.get("note"),
            "actor_name": d.get("actorName") or d.get("by"),
            "actor_email": d.get("actorEmail"),
            "created_at": ts(d.get("createdAt")) or ts(d.get("at")),
            "raw": d,
        })
    return "candidate_activity", "n365", rows


def do_notes(orgs, candidates):
    rows = []
    for d in docs("candidateNotes"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "candidate_id": candidates.get(d.get("candidateId") or d.get("candidateDocId")),
            # Admin wrote these, so they are ours and staff-internal unless the
            # document says otherwise. Guessing "client_visible" would leak.
            "side": d.get("side") or "nearwork",
            "visibility": d.get("scope") or "staff_internal",
            "body": d.get("body") or d.get("text") or "",
            "author_name": d.get("authorName") or d.get("author"),
            "author_email": d.get("authorEmail"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")) or ts(d.get("createdAt")),
            "raw": d,
        })
    return "notes", "n365", rows


def do_messages(orgs, pipelines):
    rows = []
    for d in docs("pipeline_messages"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "pipeline_id": pipelines.get(d.get("pipelineId") or d.get("pipelineCode")),
            "body": d.get("body") or d.get("text") or "",
            "author_name": d.get("authorName") or d.get("author"),
            "author_email": d.get("authorEmail"),
            "author_type": "client" if (d.get("side") or d.get("authorType")) == "client" else "nearwork",
            "created_at": ts(d.get("createdAt")),
            "raw": d,
        })
    return "messages", "n365", rows


def do_requests(orgs, candidates, pipelines):
    rows = []
    for d in docs("pipelineRequests"):
        rows.append({
            "legacy_id": d["__id"],
            "org_id": orgs.get(NEARWORK_LEGACY_ORG),
            "candidate_id": candidates.get(d.get("candidateId")),
            "pipeline_id": pipelines.get(d.get("pipelineId") or d.get("pipelineCode")),
            "type": d.get("type") or "move",
            "from_stage": d.get("fromStage"),
            "to_stage": d.get("toStage"),
            "reason": d.get("reason"),
            "status": d.get("status") or "pending",
            "requested_by_email": d.get("requestedByEmail") or d.get("requestedBy"),
            "created_at": ts(d.get("createdAt")),
            "updated_at": ts(d.get("updatedAt")) or ts(d.get("createdAt")),
            "raw": d,
        })
    return "requests", "n365", rows


def main():
    print(f"source : {EXPORT}")
    print(f"target : {URL}")
    print(f"mode   : {'APPLY — writing' if APPLY else 'DRY RUN — nothing written'}\n")

    steps = []

    link_existing_orgs()

    t, s, rows = do_organizations(); steps.append((t, s, rows))
    if APPLY:
        n = upsert(t, rows, s)
        print(f"  {'organizations':24} {n:>5} / {len(rows)}")
    orgs = fetch_map("organizations") if APPLY else {d["__id"]: None for d in docs("organizations")}

    t, s, rows = do_openings(orgs); steps.append((t, s, rows))
    if APPLY:
        n = upsert(t, rows, s)
        print(f"  {'openings':24} {n:>5} / {len(rows)}")
    openings = fetch_map("openings", "n365") if APPLY else {}

    t, s_, rows = do_pipelines(orgs, openings)
    if APPLY:
        n = upsert(t, rows, s_)
        print(f"  {'pipelines':24} {n:>5} / {len(rows)}")
    pipelines = fetch_map("pipelines", "n365") if APPLY else {}

    t, s_, rows = do_candidates(orgs)
    if APPLY:
        n = upsert(t, rows, s_)
        print(f"  {'candidates':24} {n:>5} / {len(rows)}")
    candidates = fetch_map("candidates", "n365") if APPLY else {}

    for maker in (lambda: do_applications(orgs, openings, candidates),
                  lambda: do_candidate_activity(orgs, candidates),
                  lambda: do_notes(orgs, candidates),
                  lambda: do_messages(orgs, pipelines),
                  lambda: do_requests(orgs, candidates, pipelines),
                  lambda: do_sourced(openings),
                  lambda: do_kickoff(orgs, openings),
                  lambda: do_engagements(orgs),
                  lambda: do_engagement_documents(orgs, fetch_map("engagements", "n365") if APPLY else {}),
                  lambda: do_org_documents(orgs)):
        t, s, rows = maker()
        steps.append((t, s, rows))
        if APPLY and (ONLY is None or ONLY == t):
            n = upsert(t, rows, s)
            print(f"  {t:24} {n:>5} / {len(rows)}")

    if not APPLY:
        print("would import:")
        for t, s, rows in steps:
            missing = sum(1 for r in rows if "org_id" in r and r["org_id"] is None)
            note = f"   ({missing} without an org link — resolved on apply)" if missing else ""
            print(f"  {t:24} {len(rows):>5}{note}")
        print("\nNothing was written. Re-run with --apply.")


if __name__ == "__main__":
    main()
