import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { extractInterviewNotes, generateInterviewQuestions } from '@/lib/vetting-extract';
import { scoreCandidate } from '@/lib/candidate-match';
import type { Candidate, Opening, VettingRecord } from '@/lib/types';

// ── /api/vetting ──────────────────────────────────────────────────────────────
// GET  ?openingId&candidateId   → the vetting record
// POST { action: 'questions' }  → generate interview questions
// POST { action: 'notes' }      → turn pasted notes into the record
// POST { action: 'save' }       → a human's edits, which always win
//
// Staff-only. This is the internal record — it holds tenure flags, salary gaps
// and a recruiter's private read on someone. None of it is client-facing, and
// none of it should ever reach the candidate either.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const idOf = (openingId: string, candidateId: string) => `${openingId}_${candidateId}`;

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

/** Everything worth probing, derived rather than stored — so it can't go stale. */
function flagsFor(c: Candidate, op: Opening): string[] {
  const out: string[] = [];
  const work = (c.workHistory || []).filter((w) => w.from);

  // Tenure: an observation to ask about, never a verdict. Short stints usually
  // have an ordinary explanation, and the point is to hear it.
  const spans = work.map((w) => {
    const from = Date.parse(String(w.from || '').slice(0, 7) + '-01');
    const to = w.isCurrent || !w.to ? Date.now() : Date.parse(String(w.to).slice(0, 7) + '-01');
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? (to - from) / 2.628e9 : null;
  }).filter((m): m is number => m != null);

  if (spans.length >= 2) {
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    if (avg < 18) out.push(`${spans.length} roles averaging ${Math.round(avg)} months`);
  }

  // Salary gap — the strongest retention signal available, and it needs no AI.
  const wants = Number(String(c.expectedSalary || '').replace(/[^0-9]/g, ''));
  const band = Number(op.salaryMax || 0);
  if (wants && band && wants > band) {
    out.push(`expects $${wants.toLocaleString()}, role pays to $${band.toLocaleString()}`);
  }

  if (op.reqs?.seniority && c.seniority && c.seniority !== op.reqs.seniority) {
    out.push(`${c.seniority.replace(/_/g, ' ')} candidate for a ${op.reqs.seniority.replace(/_/g, ' ')} role`);
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  const url = new URL(req.url);
  const openingId = url.searchParams.get('openingId') || '';
  const candidateId = url.searchParams.get('candidateId') || '';
  if (!openingId || !candidateId) {
    return NextResponse.json({ error: 'openingId and candidateId required' }, { status: 400 });
  }

  const db = adminDb();
  const [recSnap, opSnap, candSnap] = await Promise.all([
    db.collection('vettingRecords').doc(idOf(openingId, candidateId)).get(),
    db.collection('openings').doc(openingId).get(),
    db.collection('candidates').doc(candidateId).get(),
  ]);

  const op = opSnap.exists ? ({ id: opSnap.id, ...opSnap.data() } as Opening) : null;
  const cand = candSnap.exists ? ({ id: candSnap.id, ...candSnap.data() } as Candidate) : null;
  const match = op?.reqs && cand ? scoreCandidate(cand, op.reqs) : null;

  return NextResponse.json({
    record: recSnap.exists ? recSnap.data() : null,
    opening: op ? { id: op.id, title: op.title, orgName: op.orgName, reqs: op.reqs } : null,
    candidate: cand ? { id: cand.id, name: cand.name, email: cand.email } : null,
    match,
    flags: op && cand ? flagsFor(cand, op) : [],
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: {
    action?: string; openingId?: string; candidateId?: string;
    notes?: string; patch?: Partial<VettingRecord>; force?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }

  const { action, openingId = '', candidateId = '' } = body;
  if (!openingId || !candidateId) {
    return NextResponse.json({ error: 'openingId and candidateId required' }, { status: 400 });
  }

  const db = adminDb();
  const ref = db.collection('vettingRecords').doc(idOf(openingId, candidateId));
  const existing = (await ref.get()).data() as VettingRecord | undefined;

  // ── A human's edits ──
  if (action === 'save') {
    await ref.set({
      ...(body.patch || {}),
      id: idOf(openingId, candidateId), openingId, candidateId,
      editedBy: staff, editedAt: new Date().toISOString(),
      updatedAt: GCFieldValue.serverTimestamp(),
      ...(existing ? {} : { createdAt: GCFieldValue.serverTimestamp() }),
    }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  const [opSnap, candSnap] = await Promise.all([
    db.collection('openings').doc(openingId).get(),
    db.collection('candidates').doc(candidateId).get(),
  ]);
  const op = opSnap.exists ? ({ id: opSnap.id, ...opSnap.data() } as Opening) : null;
  const cand = candSnap.exists ? ({ id: candSnap.id, ...candSnap.data() } as Candidate) : null;
  if (!op || !cand) return NextResponse.json({ error: 'Opening or candidate not found' }, { status: 404 });

  try {
    // ── Questions ──
    if (action === 'questions') {
      const match = op.reqs ? scoreCandidate(cand, op.reqs) : null;
      const r = await generateInterviewQuestions({
        role: op.title || 'the role',
        roleSummary: op.reqs?.summary,
        mustHaves: op.reqs?.mustHaveSkills,
        missingMustHaves: match?.missingMustHave,
        candidateName: cand.name,
        candidateSummary: cand.summary || cand.headline,
        workHistory: (cand.workHistory || []).slice(0, 6),
        flags: flagsFor(cand, op),
      });
      await ref.set({
        id: idOf(openingId, candidateId), openingId, candidateId,
        openingTitle: op.title, candidateName: cand.name,
        questions: r.questions.map((q) => `${q.question}  —  ${q.why}`),
        questionsAt: new Date().toISOString(),
        updatedAt: GCFieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: GCFieldValue.serverTimestamp() }),
      }, { merge: true });
      return NextResponse.json({ ok: true, questions: r.questions, costUsd: r.costUsd });
    }

    // ── Notes ──
    if (action === 'notes') {
      const notes = (body.notes || '').trim();
      if (!notes) return NextResponse.json({ error: 'No notes provided' }, { status: 400 });

      // Someone has already corrected this record by hand. Overwriting their
      // judgement with a re-read is the one thing that would stop them trusting it.
      if (existing?.editedBy && !body.force) {
        return NextResponse.json({
          error: `This record was edited by ${existing.editedBy}. Re-reading would discard those changes.`,
          needsForce: true,
        }, { status: 409 });
      }

      const r = await extractInterviewNotes(notes, {
        role: op.title,
        mustHaves: op.reqs?.mustHaveSkills,
        candidateName: cand.name,
      });
      const d = r.data;

      await ref.set({
        id: idOf(openingId, candidateId), openingId, candidateId,
        openingTitle: op.title, candidateName: cand.name,
        notesRaw: notes,
        summary: d.summary,
        strengths: d.strengths || [],
        concerns: d.concerns || [],
        // Nulls are dropped rather than written as zeros — an absent rating must
        // stay absent, not become the lowest possible score.
        ratings: Object.fromEntries(
          Object.entries(d.ratings || {}).filter(([, v]) => typeof v === 'number'),
        ),
        attendance: d.attendance || 'showed',
        recommendation: d.recommendation,
        recommendationReason: d.recommendationReason,
        ...(typeof d.fitOverride === 'number'
          ? { fitOverride: d.fitOverride, fitOverrideReason: d.fitOverrideReason }
          : {}),
        interviewedAt: existing?.interviewedAt || new Date().toISOString(),
        interviewer: existing?.interviewer || staff,
        extractedAt: new Date().toISOString(),
        extractedModel: r.model,
        updatedAt: GCFieldValue.serverTimestamp(),
        ...(existing ? {} : { createdAt: GCFieldValue.serverTimestamp() }),
      }, { merge: true });

      return NextResponse.json({ ok: true, extracted: d, costUsd: r.costUsd });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[vetting]', action, 'failed:', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
