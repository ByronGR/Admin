#!/usr/bin/env python3
"""
Upload the exported Firebase Storage files into Supabase Storage.

Reads from the local export, not from Firebase, so this costs nothing against
the live project and can be repeated. Paths are preserved exactly
(cvs/..., candidate-cvs/..., candidate-photos/...), which means a Firebase URL
and its Supabase object differ only by host — no mapping table is needed to
rewrite links at cutover.

The bucket is private. These are CVs and photographs of real people, and a
public bucket would put every one of them behind a guessable URL.

  python3 scripts/migration/upload-storage.py            # dry run
  python3 scripts/migration/upload-storage.py --apply
"""
import hashlib, json, mimetypes, os, sys, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BUCKET = "nearwork"
APPLY = "--apply" in sys.argv

E = {}
for line in open(os.path.join(ROOT, ".env.migration")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        E[k.strip()] = v.strip()
URL, KEY = E["SUPABASE_URL"], E["SUPABASE_SECRET_KEY"]

root = os.path.join(HERE, "export")
EXPORT = os.path.join(root, sorted(os.listdir(root))[-1])
FILES = os.path.join(EXPORT, "files")
MANIFEST = json.load(open(os.path.join(EXPORT, "_storage.json")))
BY_NAME = {o["name"]: o for o in MANIFEST}


def req(method, path, data=None, headers=None):
    r = urllib.request.Request(f"{URL}/storage/v1/{path}", data=data, method=method)
    r.add_header("Authorization", f"Bearer {KEY}")
    r.add_header("apikey", KEY)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            body = resp.read().decode()
            return json.loads(body) if body.strip() else {}
    except urllib.error.HTTPError as e:
        return {"__error": e.code, "__body": e.read().decode()[:200]}


def already_there(prefix=""):
    """
    Object names already in the bucket, so a re-run skips them.

    Supabase lists one folder level at a time — an entry without an id is a
    folder, not a file — so this has to walk. Listing the root alone returns the
    five top-level folders and makes an uploaded bucket look empty.
    """
    names, offset = set(), 0
    while True:
        r = req("POST", f"object/list/{BUCKET}",
                json.dumps({"prefix": prefix, "limit": 1000, "offset": offset}).encode(),
                {"Content-Type": "application/json"})
        if isinstance(r, dict) and "__error" in r:
            return names
        for e in r:
            name = f"{prefix}{e['name']}"
            if e.get("id"):
                names.add(name)
            else:
                names |= already_there(name + "/")
        if len(r) < 1000:
            return names
        offset += len(r)


local = []
for dirpath, _, filenames in os.walk(FILES):
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        local.append((os.path.relpath(full, FILES), full))
local.sort()

print(f"source : {FILES}")
print(f"bucket : {BUCKET} (private)")
print(f"mode   : {'APPLY — uploading' if APPLY else 'DRY RUN'}")
print(f"files  : {len(local)}\n")

if not APPLY:
    by_prefix = {}
    total = 0
    for name, full in local:
        by_prefix[name.split("/")[0]] = by_prefix.get(name.split("/")[0], 0) + 1
        total += os.path.getsize(full)
    for p, n in sorted(by_prefix.items()):
        print(f"  {p:24} {n:>4}")
    print(f"\n  {total/1048576:.1f} MB total. Nothing uploaded — re-run with --apply.")
    raise SystemExit

existing = already_there()
print(f"already in bucket: {len(existing)}\n")

ok = skipped = failed = 0
bad = []
for i, (name, full) in enumerate(local, 1):
    if name in existing:
        skipped += 1
        continue
    blob = open(full, "rb").read()

    # Verify against the MD5 Google reported before sending it on, so a file
    # corrupted on the way to disk is caught here rather than discovered later
    # by whoever opens the CV.
    want = (BY_NAME.get(name) or {}).get("md5Hash")
    if want:
        import base64
        if base64.b64encode(hashlib.md5(blob).digest()).decode() != want:
            print(f"  ! {name}: local copy does not match Firebase — skipped")
            failed += 1
            bad.append(name)
            continue

    ctype = (BY_NAME.get(name) or {}).get("contentType") \
        or mimetypes.guess_type(name)[0] or "application/octet-stream"
    r = req("POST", f"object/{BUCKET}/{urllib.parse.quote(name)}", blob,
            {"Content-Type": ctype, "x-upsert": "true"})
    if isinstance(r, dict) and "__error" in r:
        print(f"  ! {name}: HTTP {r['__error']} {r['__body'][:120]}")
        failed += 1
        bad.append(name)
        continue
    ok += 1
    if i % 25 == 0 or i == len(local):
        print(f"  {i}/{len(local)}")

print(f"\nuploaded {ok}, already had {skipped}, failed {failed}")
if bad:
    print("FAILED:")
    for b in bad:
        print("  ", b)
    sys.exit(1)
