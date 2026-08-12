import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { serperSearch, cleanName } from '@/lib/xray';
import type { SourcedCandidate } from '@/lib/types';

// ── /api/sourcing/backfill-headlines ──────────────────────────────────────────
// GET  ?openingId=… → how many sourced candidates still have no headline
// POST { openingId, limit } → fill in a batch of them
//
// Candidates sourced before headlines existed have none, and the original search
// result was never stored — so there is nothing in the database to recover it
// from. What we do have is each candidate's LinkedIn URL, and searching for that
// URL returns the same title the headline is derived from. One cheap search per
// candidate rather than a re-run of the whole sourcing pass.
//
// Batched deliberately: 500 searches would time out a serverless function long
// before finishing, and a half-finished run with no record of where it stopped
// is worse than one that has to be clicked twice.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_PER_CALL = 25;

async function requireStaff(req: Request): Promise<string | null> {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = String(decoded.email || '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

/** Same derivation the live search uses, so a backfilled row is indistinguishable. */
function headlineFrom(title: string, snippet: string): string {
  const nm = cleanName(title || '');
  let h = (title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const dash = h.indexOf(' - ');
  if (dash !== -1 && h.slice(0, dash).trim() === nm) h = h.slice(dash + 3).trim();
  if (!h || h === nm) h = (snippet || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return h;
}

async function missing(openingId: string) {
  let q = adminDb().collection('sourcedCandidates') as FirebaseFirestore.Query;
  if (openingId) q = q.where('openingId', '==', openingId);
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ ...(d.data() as SourcedCandidate), id: d.id }))
    .filter((c) => !c.headline && c.linkedin);
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  const openingId = new URL(req.url).searchParams.get('openingId') || '';
  const rows = await missing(openingId);
  return NextResponse.json({ missing: rows.length });
}

export async function POST(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  const key = process.env.SERPER_API_KEY;
  if (!key) return NextResponse.json({ error: 'SERPER_API_KEY not configured' }, { status: 500 });

  let body: { openingId?: string; limit?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }

  const rows = (await missing(body.openingId || '')).slice(0, Math.min(body.limit || MAX_PER_CALL, MAX_PER_CALL));
  if (!rows.length) return NextResponse.json({ filled: 0, notFound: 0, remaining: 0, done: true });

  const db = adminDb();
  const batch = db.batch();
  let filled = 0;
  let notFound = 0;

  for (const c of rows) {
    try {
      // Search the profile URL itself. It is how they were found originally, so
      // the page is indexed and the title comes back the same way.
      const r = await serperSearch(key, `"${c.linkedin.replace(/^https?:\/\/(www\.)?/, '')}"`, { page: 1 });
      const hit = (r.items || []).find((i) => (i.link || '').includes(c.li.replace('/in/', ''))) || (r.items || [])[0];
      const h = hit ? headlineFrom(hit.title || '', hit.snippet || '') : '';
      if (h) {
        batch.set(db.collection('sourcedCandidates').doc(c.id), {
          headline: h,
          headlineBackfilledAt: new Date().toISOString(),
          updatedAt: GCFieldValue.serverTimestamp(),
        }, { merge: true });
        filled++;
      } else {
        notFound++;
      }
    } catch {
      // A single lookup failing shouldn't abandon the batch — the row simply
      // stays without a headline and is picked up on the next pass.
      notFound++;
    }
  }

  if (filled) await batch.commit();

  const left = await missing(body.openingId || '');
  return NextResponse.json({ filled, notFound, remaining: left.length, done: left.length === 0 });
}
