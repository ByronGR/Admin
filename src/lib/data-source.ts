// ═══════════════════════════════════════════════════════════════════════════
//  Where Admin reads its data from.
//
//  During the migration Admin can read from either Firebase or Supabase. The
//  switch is an environment variable, so production keeps reading Firebase
//  untouched while a preview deployment reads the migrated copy — the same code,
//  the same screens, the same design, a different source.
//
//  Reads only. Every write still goes to Firebase until cutover, so the two
//  databases cannot drift apart while we are still looking at them. There is
//  exactly one owner of every record at every moment, which is the rule the
//  whole migration rests on.
//
//  The trick that makes this cheap: every migrated row carries `raw`, the
//  untouched Firestore document, and `legacy_id`, its original id. Returning
//  `{ id: legacy_id, ...raw }` produces something indistinguishable from what
//  getDocs() gave the page before, so the screens need no rewriting and the
//  design cannot shift. Proper relational queries replace this per screen,
//  later, once the data is proven to be here.
// ═══════════════════════════════════════════════════════════════════════════
import { auth, onAuthStateChanged } from '@/lib/firebase';

export type Row = Record<string, unknown> & { id: string };

export function readsFromSupabase(): boolean {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === 'supabase';
}

// ── Timestamps ─────────────────────────────────────────────────────────────
// Postgres hands back an ISO string; thirty-three places in Admin call
// .seconds, .toDate() or .toMillis() on what Firestore gave them. Rather than
// chase every one, hand back something that answers all three — and still reads
// as the ISO string anywhere it is used directly.
class CompatTimestamp {
  readonly seconds: number;
  readonly nanoseconds = 0;
  private readonly iso: string;

  constructor(iso: string) {
    this.iso = iso;
    this.seconds = Math.floor(new Date(iso).getTime() / 1000);
  }
  toMillis() { return new Date(this.iso).getTime(); }
  toDate() { return new Date(this.iso); }
  toString() { return this.iso; }
  toJSON() { return this.iso; }
  valueOf() { return this.iso; }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function revive(value: unknown): unknown {
  if (typeof value === 'string' && ISO.test(value)) return new CompatTimestamp(value);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = revive(v);
    return out;
  }
  return value;
}

// ── Collections ────────────────────────────────────────────────────────────
// Firestore collection name -> where it now lives.
const TABLES: Record<string, { table: string; schema?: string }> = {
  organizations:         { table: 'organizations' },
  openings:              { table: 'openings',               schema: 'n365' },
  pipelines:             { table: 'pipelines',              schema: 'n365' },
  sourcedCandidates:     { table: 'sourced_candidates',     schema: 'n365' },
  kickoffBriefs:         { table: 'kickoff_briefs',         schema: 'n365' },
  engagements:           { table: 'engagements',            schema: 'n365' },
  organizationDocuments: { table: 'organization_documents', schema: 'n365' },
  candidates:            { table: 'candidates',             schema: 'n365' },
  applications:          { table: 'applications',           schema: 'n365' },
  candidateActivity:     { table: 'candidate_activity',     schema: 'n365' },
  candidateNotes:        { table: 'notes',                  schema: 'n365' },
  pipeline_messages:     { table: 'messages',               schema: 'n365' },
  pipelineRequests:      { table: 'requests',               schema: 'n365' },
  notifications:         { table: 'notifications',          schema: 'n365' },
};

export function isMigrated(collection: string): boolean {
  return collection in TABLES;
}

/**
 * The signed-in user, once Firebase has actually decided who that is.
 *
 * Firebase restores a session asynchronously, so auth.currentUser is null for
 * the first moments after a page loads — including inside the effect that
 * fetches data. Reading it directly made every load fail with "Not signed in"
 * before a request was even sent, which looked exactly like an empty database.
 */
function currentUser(): Promise<import('firebase/auth').User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (u) => {
      stop();
      resolve(u);
    });
  });
}


/**
 * Read a whole collection in the shape the screens already use.
 *
 * Goes through Admin's own server rather than straight to Supabase: staff are
 * signed in to Firebase, and Supabase would see the browser as an anonymous
 * caller with no privilege on the n365 schema. The route verifies the Firebase
 * token and reads with the service key.
 */
export async function fetchCollection(collection: string): Promise<Row[]> {
  if (!TABLES[collection]) throw new Error(`No Supabase table mapped for "${collection}"`);

  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken();

  const res = await fetch(`/api/ds/${encodeURIComponent(collection)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to load ${collection}`);
  }

  const { rows } = (await res.json()) as { rows: Record<string, unknown>[] };
  return rows.map((r) => revive(r) as Row);
}

/**
 * Read a collection from whichever database is currently in charge.
 *
 * This is what screens call. It returns the same `{ id, ...fields }[]` either
 * way, so a screen cannot tell the two apart and no layout or markup changes
 * when the source does.
 */
export async function loadCollection(name: string): Promise<Row[]> {
  if (readsFromSupabase() && isMigrated(name)) return fetchCollection(name);

  const { db, collection, getDocs } = await import('@/lib/firebase');
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Row);
}
