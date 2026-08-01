import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { aiProfileToCandidate } from '@/lib/cv-ai-to-candidate';
import { clientCandidateSnapshot } from '@/lib/client-candidate-snapshot';
import type { AIExtractedCV } from '@/lib/cv-ai-extract';
import type { Candidate, PipelineCandidate } from '@/lib/types';

// ── POST /api/cv-parse/save ───────────────────────────────────────────────────
// Writes a parsed profile onto an existing candidate, then pushes the
// client-visible subset into every pipeline that candidate sits in — the client
// portal reads only `pipelines`, so without that second write the change would
// be invisible to them.
//
// The patch is built by aiProfileToCandidate(), which emits only non-empty
// values. Re-running this can therefore never blank a field a human curated by
// hand, which is what makes re-parsing the whole database safe.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  let email = '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    email = String(decoded.email || '').toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }
  if (!email.endsWith('@nearwork.co')) {
    return NextResponse.json({ error: 'Staff only' }, { status: 403 });
  }

  let body: { candidateId?: string; profile?: AIExtractedCV; model?: string; schemaVersion?: number; rawText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 400 });
  }

  const { candidateId, profile } = body;
  if (!candidateId || !profile) {
    return NextResponse.json({ error: 'candidateId and profile are required' }, { status: 400 });
  }

  const db = adminDb();
  const ref = db.collection('candidates').doc(candidateId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const patch = aiProfileToCandidate(profile, {
    model: body.model,
    schemaVersion: body.schemaVersion,
    rawText: body.rawText,
  });

  await ref.set(
    { ...patch, updatedAt: GCFieldValue.serverTimestamp(), cvParsedBy: email },
    { merge: true },
  );

  // Push the client-visible subset into the candidate's pipeline entries.
  const merged = { ...(snap.data() as Candidate), ...patch, id: candidateId } as Candidate;
  const clientSnap = clientCandidateSnapshot(merged);

  const pipes = await db.collection('pipelines').get();
  let updatedPipelines = 0;
  await Promise.all(
    pipes.docs.map(async (p) => {
      const data = p.data() as { candidates?: PipelineCandidate[] };
      const list = data.candidates ?? [];
      if (!list.some((e) => e.candidateId === candidateId)) return;
      const next = list.map((e) => (e.candidateId === candidateId ? { ...e, ...clientSnap } : e));
      try {
        await p.ref.update({ candidates: next, updatedAt: GCFieldValue.serverTimestamp() });
        updatedPipelines += 1;
      } catch {
        /* best-effort — a pipeline write must never fail the profile save */
      }
    }),
  );

  return NextResponse.json({
    success: true,
    fieldsWritten: Object.keys(patch).length,
    updatedPipelines,
  });
}
