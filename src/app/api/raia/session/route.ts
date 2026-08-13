import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { ensureOpeningReqs } from '@/lib/opening-reqs';
import { createRaiaSession, toRaiaRoleContext } from '@/lib/raia-client';
import type { Candidate, Opening, Pipeline, PipelineCandidate } from '@/lib/types';

// ── /api/raia/session ─────────────────────────────────────────────────────────
// POST { candidateId, openingId, pipelineId?, meetingUrl?, scheduledAt? }
//   → an interview brief from RAIA.
//
// Everything RAIA needs is already in Admin; this route's whole job is to gather
// it and hand it over. It calls the same public endpoint any paying customer
// would — Nearwork gets no private door in, which is the only way the
// integration stays honest as RAIA is sold to other companies.
//
// The one piece of real work here is requirements. Extraction is lazy by
// design, so plenty of openings have never had it run — and a gap map built
// against an opening with no requirements is an empty brief that looks like
// good news. So we extract first, and let that cost land on the vetting budget
// where the rest of the opening reading already lives.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
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

  let body: {
    candidateId?: string;
    openingId?: string;
    pipelineId?: string;
    /** The board only knows the pipeline code, so accept that and resolve it. */
    pipelineCode?: string;
    meetingUrl?: string;
    scheduledAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const { candidateId } = body;
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  }

  const db = adminDb();

  // A pipeline code is enough to find both the pipeline and its opening, which
  // keeps the caller down to two ids it already has. The alternative was
  // threading an openingId through every level of the board.
  let openingId = body.openingId;
  let pipelineId = body.pipelineId;
  if (!openingId && body.pipelineCode) {
    const pipeSnap = await db
      .collection('pipelines')
      .where('code', '==', body.pipelineCode)
      .limit(1)
      .get();
    if (!pipeSnap.empty) {
      pipelineId = pipeSnap.docs[0].id;
      openingId = (pipeSnap.docs[0].data() as Pipeline).openingId;
    }
  }
  if (!openingId) {
    return NextResponse.json(
      { error: 'This pipeline has no opening linked, so there is nothing to compare the CV against.' },
      { status: 400 },
    );
  }
  const [candSnap, openSnap] = await Promise.all([
    db.collection('candidates').doc(candidateId).get(),
    db.collection('openings').doc(openingId).get(),
  ]);

  if (!candSnap.exists) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  if (!openSnap.exists) return NextResponse.json({ error: 'Opening not found' }, { status: 404 });

  const candidate = { id: candSnap.id, ...candSnap.data() } as Candidate;
  const opening = { id: openSnap.id, ...openSnap.data() } as Opening;

  // Extract the opening's requirements if nobody has yet. Without them RAIA has
  // nothing to compare the CV against and returns a brief with no gaps, which
  // reads as "this candidate is clean" rather than "we never checked".
  const reqs = await ensureOpeningReqs(openingId, opening);
  if (!reqs.reqs) {
    return NextResponse.json(
      {
        error: reqs.error || 'Could not read this opening’s requirements.',
        needsExtract: true,
      },
      { status: 409 },
    );
  }
  opening.reqs = reqs.reqs;

  // The kickoff brief, when the opening has one. This is the highest-value
  // thing we can hand RAIA and we have been collecting it all along: a job post
  // is written to attract people, a kickoff brief is written to filter them,
  // and a stated deal-breaker almost never survives into the JD.
  let roleContext: ReturnType<typeof toRaiaRoleContext> | undefined;
  if (opening.code) {
    try {
      const briefSnap = await db.collection('kickoffBriefs').doc(opening.code).get();
      if (briefSnap.exists) roleContext = toRaiaRoleContext(briefSnap.data() ?? {});
    } catch {
      // A missing kickoff brief is normal, not an error — RAIA falls back to
      // reading the job post alone.
    }
  }

  // Pipeline context is optional — a brief is useful before anyone has been put
  // on a board — but when it exists it tells the recruiter whose process this
  // is, which changes what the next step means.
  let pipelineCtx: { pipeline: Pipeline; pipelineCandidate: PipelineCandidate } | undefined;
  if (pipelineId) {
    const pipeSnap = await db.collection('pipelines').doc(pipelineId).get();
    if (pipeSnap.exists) {
      const pipeline = { id: pipeSnap.id, ...pipeSnap.data() } as Pipeline;
      const pc = (pipeline.candidates || []).find((c) => c.candidateId === candidateId);
      if (pc) pipelineCtx = { pipeline, pipelineCandidate: pc };
    }
  }

  const result = await createRaiaSession({
    candidate,
    opening,
    roleContext,
    pipeline: pipelineCtx,
    meetingUrl: body.meetingUrl,
    scheduledAt: body.scheduledAt,
  });

  if (result.error || !result.session) {
    // A brief is an aid, not a gate. RAIA being unreachable degrades the page
    // rather than blocking the interview.
    return NextResponse.json({ error: result.error || 'RAIA returned nothing' }, { status: 502 });
  }

  return NextResponse.json({
    ...result.session,
    // Where to send the recruiter. Admin triggers the brief; RAIA shows it.
    url: `${(process.env.RAIA_API_URL || '').replace(/\/$/, '')}/raia/interviews/${result.session.sessionId}`,
    // Surfaced so the caller can tell a thin brief from a broken one.
    reqsExtractedNow: reqs.extracted,
    mustHaveCount: opening.reqs.mustHaveSkills?.length ?? 0,
    hasCvText: !!candidate.cvParse?.rawText,
  });
}
