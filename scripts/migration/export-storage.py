#!/usr/bin/env python3
"""
Download every file from Firebase Storage to disk, read-only.

Verifies each download against the MD5 that Google reports, so a truncated or
corrupted file is reported rather than silently kept. Skips files already on
disk with a matching size, so re-running is cheap.

Usage:
  python3 scripts/migration/export-storage.py [export_dir]
    export_dir defaults to the newest directory under scripts/migration/export
"""
import base64, hashlib, json, os, subprocess, sys, urllib.parse, urllib.request, urllib.error

PROJECT = "nearwork-97e3c"
BUCKET = "nearwork-97e3c.firebasestorage.app"
HERE = os.path.dirname(os.path.abspath(__file__))


def newest_export() -> str:
    root = os.path.join(HERE, "export")
    dirs = [d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))]
    if not dirs:
        sys.exit("No export found. Run export-firebase.py first.")
    return os.path.join(root, sorted(dirs)[-1])


BASE = sys.argv[1] if len(sys.argv) > 1 else newest_export()
MANIFEST = os.path.join(BASE, "_storage.json")
DEST = os.path.join(BASE, "files")

tok = subprocess.run(["gcloud", "auth", "application-default", "print-access-token"],
                     capture_output=True, text=True)
if tok.returncode != 0:
    sys.exit("Could not get a token — see export-firebase.py for the two gcloud commands.")
TOK = tok.stdout.strip()

files = json.load(open(MANIFEST))
print(f"{len(files)} files -> {DEST}\n")

ok = skipped = failed = 0
bad = []
for i, o in enumerate(files, 1):
    name, size = o["name"], int(o.get("size", 0))
    out = os.path.join(DEST, name)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    if os.path.exists(out) and os.path.getsize(out) == size:
        skipped += 1
        continue

    url = (f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/"
           f"{urllib.parse.quote(name, safe='')}?alt=media")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOK}",
                                               "x-goog-user-project": PROJECT})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        print(f"  ! {name}: HTTP {e.code}")
        failed += 1
        bad.append(name)
        continue

    want = o.get("md5Hash")
    if want and base64.b64encode(hashlib.md5(data).digest()).decode() != want:
        print(f"  ! {name}: MD5 mismatch — not kept")
        failed += 1
        bad.append(name)
        continue

    with open(out, "wb") as f:
        f.write(data)
    ok += 1
    if i % 25 == 0 or i == len(files):
        print(f"  {i}/{len(files)}")

on_disk = sum(os.path.getsize(os.path.join(dp, f))
              for dp, _, fs in os.walk(DEST) for f in fs)
print(f"\ndownloaded {ok}, already had {skipped}, failed {failed}")
print(f"on disk: {on_disk/1048576:.1f} MB in {DEST}")
if bad:
    print("FAILED:"); [print("  ", b) for b in bad]
    sys.exit(1)
