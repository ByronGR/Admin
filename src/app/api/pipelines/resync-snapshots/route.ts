import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { clientCandidateSnapshot } from '@/lib/client-candidate-snapshot';
import type { Candidate, PipelineCandidate } from '@/lib/types';

// ── /api/pipelines/resync-snapshots ──────────────────────────────────────────
// The client portal can't read the candidates collection, so everything it shows
// about a candidate is copied onto the pipeline entry at the moment they're added
// or edited. That copy is a point-in-time snapshot: add a new field to it and
// existing entries keep the older shape indefinitely, because nothing rewrites
// them until a staffer happens to edit that person.
//
// From the client's side this is invisible and looks like the feature is broken
// for most candidates and works for a few. This rewrites every entry from the
// current candidate record, so a newly added field reaches people already in
// flight rather than only the next intake.
//
// GET  → how many entries are out of date, without writing anything
// POST → rewrite them

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function requireStaff(req: Request): Promise<boolean> {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return String(decoded.email || '').toLowerCase().endsWith('@nearwork.co');
  } catch {
    return false;
  }
}

/** Only the keys the snapshot owns, so unrelated per-entry state is never touched. */
function differs(entry: PipelineCandidate, fresh: Record<string, unknown>): boolean {
  return Object.entries(fresh).some(([k, v]) => {
    const cur = (entry as unknown as Record<string, unknown>)[k];
    return JSON.stringify(cur) !== JSON.stringify(v);
  });
}

async function plan() {
  const db = adminDb();
  const [pipes, cands] = await Promise.all([
    db.collection('pipelines').get(),
    db.collection('candidates').get(),
  ]);
  const byId = new Map<string, Candidate>();
  cands.docs.forEach((d) => byId.set(d.id, { ...(d.data() as Candidate), id: d.id }));

  const updates: { id: string; candidates: PipelineCandidate[] }[] = [];
  let stale = 0;
  let missing = 0;

  for (const p of pipes.docs) {
    const list = ((p.data().candidates || []) as PipelineCandidate[]);
    if (!list.length) continue;
    let touched = false;
    const next = list.map((e) => {
      const c = e.candidateId ? byId.get(e.candidateId) : undefined;
      // No candidate record — a manually added entry. Leave it exactly as it is;
      // overwriting with an empty snapshot would erase what the client can see.
      if (!c) { missing++; return e; }
      const fresh = clientCandidateSnapshot(c) as Record<string, unknown>;
      if (!differs(e, fresh)) return e;
      stale++; touched = true;
      return { ...e, ...fresh };
    });
    if (touched) updates.push({ id: p.id, candidates: next });
  }
  return { updates, stale, missing, pipelines: pipes.size };
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  const { updates, stale, missing, pipelines } = await plan();
  return NextResponse.json({ stale, missing, pipelines, affectedPipelines: updates.length });
}

export async function POST(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  const { updates, stale, missing } = await plan();

  const db = adminDb();
  // Chunked: Firestore caps a batch at 500 writes, and a pipeline document can be
  // large enough that fewer, bigger commits are the safer shape anyway.
  for (let i = 0; i < updates.length; i += 200) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 200)) {
      batch.update(db.collection('pipelines').doc(u.id), {
        candidates: u.candidates,
        // Deliberately no updatedAt: this refreshes a copy, it is not activity on
        // the pipeline, and bumping it would reorder every client's board today.
      });
    }
    await batch.commit();
  }

  return NextResponse.json({ updated: stale, pipelines: updates.length, missing });
}
