#!/usr/bin/env python3
"""
Full read-only export of the nearwork-97e3c Firebase project.

Writes one JSON file per Firestore collection, plus a manifest of every file in
Storage. Nothing is written to or deleted from Firebase — this only reads.

Run it as often as you like; it overwrites its output directory. The point is
that a complete, dated copy of the original always exists on disk before and
during the migration, so a bad mapping is never a data loss.

Needs:
  gcloud auth application-default login
  gcloud auth application-default set-quota-project nearwork-97e3c

Usage:
  python3 scripts/migration/export-firebase.py [outdir]
"""
import json, os, subprocess, sys, urllib.request, urllib.error, datetime

PROJECT = "nearwork-97e3c"
BUCKET = "nearwork-97e3c.firebasestorage.app"
FS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "export",
    datetime.date.today().isoformat())


def token() -> str:
    t = subprocess.run(["gcloud", "auth", "application-default", "print-access-token"],
                       capture_output=True, text=True)
    if t.returncode != 0:
        sys.exit("Could not get a token. Run:\n"
                 "  gcloud auth application-default login\n"
                 "  gcloud auth application-default set-quota-project " + PROJECT)
    return t.stdout.strip()


TOK = token()


def get(url: str, body=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOK}",
                 "x-goog-user-project": PROJECT,
                 "Content-Type": "application/json"},
        method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"__error": e.code, "__body": e.read().decode()[:400]}


def collections() -> list:
    d = get(f"{FS}:listCollectionIds", {"pageSize": 300})
    return sorted(d.get("collectionIds", []))


def dump_collection(name: str) -> list:
    """Page through a whole collection, following nextPageToken."""
    docs, token_, page = [], None, 0
    while True:
        url = f"{FS}/{name}?pageSize=300"
        if token_:
            url += f"&pageToken={token_}"
        d = get(url)
        if "__error" in d:
            print(f"    ! HTTP {d['__error']}: {d['__body'][:120]}")
            break
        docs.extend(d.get("documents", []))
        token_ = d.get("nextPageToken")
        page += 1
        if not token_:
            break
        if page > 200:                      # safety valve, not an expected path
            print("    ! stopped after 200 pages")
            break
    return docs


def dump_storage() -> list:
    items, token_ = [], None
    while True:
        url = (f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o"
               f"?maxResults=1000&fields=items(name,size,contentType,updated,md5Hash),nextPageToken")
        if token_:
            url += f"&pageToken={token_}"
        d = get(url)
        if "__error" in d:
            print(f"  ! storage HTTP {d['__error']}")
            break
        items.extend(d.get("items", []))
        token_ = d.get("nextPageToken")
        if not token_:
            break
    return items


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f"exporting {PROJECT} -> {OUT}\n")

    summary, total = {}, 0
    for c in collections():
        docs = dump_collection(c)
        with open(os.path.join(OUT, f"{c}.json"), "w") as f:
            json.dump(docs, f, indent=1)
        summary[c] = len(docs)
        total += len(docs)
        print(f"  {c:26} {len(docs):>5} docs")

    files = dump_storage()
    with open(os.path.join(OUT, "_storage.json"), "w") as f:
        json.dump(files, f, indent=1)
    size = sum(int(o.get("size", 0)) for o in files)
    print(f"\n  {'storage (manifest)':26} {len(files):>5} files  {size/1048576:.1f} MB")

    with open(os.path.join(OUT, "_manifest.json"), "w") as f:
        json.dump({"project": PROJECT,
                   "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "collections": summary,
                   "documents_total": total,
                   "storage_files": len(files),
                   "storage_bytes": size}, f, indent=1)

    print(f"\ndone: {total} documents across {len(summary)} collections")
    print(f"manifest: {os.path.join(OUT, '_manifest.json')}")


if __name__ == "__main__":
    main()
