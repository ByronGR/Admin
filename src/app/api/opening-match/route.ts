import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { matchCandidates } from '@/lib/candidate-match';
import type { Candidate, Opening, PipelineCandidate } from '@/lib/types';

// ── /api/opening-match ────────────────────────────────────────────────────────
// GET ?openingId=… → the candidates in our database who fit this opening.
//
// No AI call and no cost: both sides were already classified, so this is a scan
// and a sort. Candidates already in the opening's pipeline are excluded — the
// point is to surface people we have but haven't considered yet.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (!String(decoded.email || '').toLowerCase().endsWith('@nearwork.co')) {
      return NextResponse.json({ error: 'Staff only' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const openingId = url.searchParams.get('openingId');
  if (!openingId) return NextResponse.json({ error: 'openingId required' }, { status: 400 });
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100);

  const db = adminDb();
  const openingSnap = await db.collection('openings').doc(openingId).get();
  if (!openingSnap.exists) return NextResponse.json({ error: 'Opening not found' }, { status: 404 });
  const opening = openingSnap.data() as Opening;

  if (!opening.reqs) {
    return NextResponse.json({
      error: 'This opening has no extracted requirements yet — run "Find requirements" first.',
      needsExtract: true,
    }, { status: 409 });
  }

  // Who's already in this pipeline — they don't need surfacing again.
  const already = new Set<string>();
  const pipes = await db.collection('pipelines').where('openingId', '==', openingId).get();
  pipes.docs.forEach((p) => {
    ((p.data() as { candidates?: PipelineCandidate[] }).candidates ?? [])
      .forEach((e) => e.candidateId && already.add(e.candidateId));
  });

  const snap = await db.collection('candidates').get();
  const pool = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Candidate)
    .filter((c) => !already.has(c.id));

  const matches = matchCandidates(pool, opening, limit);

  return NextResponse.json({
    openingId,
    openingTitle: opening.title || '',
    reqs: opening.reqs,
    scanned: pool.length,
    alreadyInPipeline: already.size,
    matches,
    counts: {
      strong: matches.filter((m) => m.band === 'strong').length,
      possible: matches.filter((m) => m.band === 'possible').length,
      stretch: matches.filter((m) => m.band === 'stretch').length,
    },
  });
}
