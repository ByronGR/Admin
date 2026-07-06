import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';
import { parseAssessment, parseDisc } from '@/lib/assessment-parser';
import { broadcastToFollowers } from '@/lib/notify-broadcast';

// ── POST /api/assessment-upload ───────────────────────────────────────────────
// Staff upload a candidate's assessment/English PDF or DISC PDF. The file is
// parsed IN MEMORY (never stored) and the structured result is written to the
// candidate's assessments doc, then the file buffer is discarded. Recomputes the
// Nearwork Score (50 assessment / 30 English / 20 DISC) from whatever's present.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
// Import the lib entry directly — the package index runs a debug block that
// reads a bundled test PDF and crashes in a serverless context.
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string; numpages: number }>;

function discAverage(disc: unknown): number | null {
  const nat = (disc as { profiles?: { natural?: Record<string, number> } })?.profiles?.natural;
  if (!nat) return null;
  const vals = ['D', 'I', 'S', 'C'].map((k) => nat[k]).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// Weighted composite over whatever components exist; renormalizes if one is missing.
function nearworkScore(doc: Record<string, unknown>): number | null {
  const parts: Array<[number, number]> = [];
  if (typeof doc.overallScore === 'number') parts.push([0.5, doc.overallScore]);
  const eng = (doc.english as { score?: number } | undefined)?.score;
  if (typeof eng === 'number') parts.push([0.3, eng]);
  const disc = discAverage(doc.disc);
  if (disc != null) parts.push([0.2, disc]);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, p) => s + p[0], 0);
  return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum);
}

export async function POST(req: Request) {
  // Staff-only.
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a file upload' }, { status: 400 });
  }
  const file = form.get('file');
  const kind = String(form.get('kind') || '');
  const candidateId = String(form.get('candidateId') || '').trim();
  const pipelineCode = String(form.get('pipelineCode') || '').trim();
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (kind !== 'assessment' && kind !== 'disc') return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  if (!candidateId) return NextResponse.json({ error: 'Missing candidateId' }, { status: 400 });
  if (!pipelineCode) return NextResponse.json({ error: 'Missing pipelineCode — pick which role this is for' }, { status: 400 });

  // Parse the PDF in memory. The buffer is never persisted.
  let text: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buf);
    text = parsed.text || '';
  } catch (e) {
    console.error('[assessment-upload] PDF read failed:', e);
    return NextResponse.json({ error: "Couldn't read that PDF. Make sure it's the report file." }, { status: 422 });
  }

  const db = adminDb();

  // Resolve the org + role from the pipeline this assessment is for, so the client
  // portal (scoped by org + pipeline) reads only their own role's result.
  let orgId = String(form.get('orgId') || '').trim() || null;
  let pipelineTitle: string | null = null;
  try {
    const pipe = await db.collection('pipelines').doc(pipelineCode).get();
    if (!orgId) orgId = (pipe.get('orgId') as string) || (pipe.get('organizationId') as string) || null;
    pipelineTitle = (pipe.get('openingTitle') as string) || (pipe.get('title') as string) || null;
  } catch { /* best effort */ }

  // One assessment per (candidate, role/pipeline) — a candidate can be assessed
  // for several roles and carry a different score in each.
  const ref = db.collection('assessments').doc(`${candidateId}__${pipelineCode}`);
  const base: Record<string, unknown> = {
    candidateId, pipelineCode, pipelineTitle, orgId,
    gradedBy: 'Nearwork talent team', updatedAt: FieldValue.serverTimestamp(),
  };

  if (kind === 'assessment') {
    const p = parseAssessment(text);
    Object.assign(base, {
      role: p.role || pipelineTitle,
      result: p.result,
      overallScore: p.overallScore,
      passingScore: p.passingScore,
      summary: p.summary,
      integrity: p.integrity,
      english: p.english,
      questions: p.questions,
      assessmentUploadedAt: FieldValue.serverTimestamp(),
    });
    // Also record the candidate's English on their profile (Languages tab).
    if (p.english?.level) {
      try {
        await db.collection('candidates').doc(candidateId).set({
          englishScore: {
            level: p.english.level,
            feedback: p.english.summary || '',
            assessedBy: 'Assessment import',
            assessedAt: new Date().toISOString(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) { console.error('[assessment-upload] english update failed:', e); }
    }
  } else {
    const p = parseDisc(text);
    Object.assign(base, { disc: p, discUploadedAt: FieldValue.serverTimestamp() });
  }

  await ref.set(base, { merge: true });

  // Recompute the Nearwork Score + completion from the merged doc.
  const merged = (await ref.get()).data() || {};
  const nw = nearworkScore(merged);
  const completed = typeof merged.overallScore === 'number';
  await ref.set(
    { nearworkScore: nw, status: completed ? 'completed' : 'partial', completedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Notify the role's followers that an assessment is ready (best-effort — a
  // failure here must never fail the upload). Only when the assessment is
  // complete (a score exists), not on a partial DISC-only upload.
  if (completed) {
    try {
      let candidateName = '';
      try {
        const candSnap = await db.collection('candidates').doc(candidateId).get();
        if (candSnap.exists) candidateName = String(candSnap.data()?.name ?? '').trim();
      } catch { /* best effort */ }
      await broadcastToFollowers({
        broadcastType: 'assessment_ready',
        entityType: 'opening',
        entityId: pipelineCode,
        orgId: orgId ?? undefined,
        candidateName: candidateName || undefined,
        candidateCode: candidateId,
      });
    } catch (e) {
      console.error('[assessment-upload] assessment_ready broadcast failed:', e);
    }
  }

  return NextResponse.json({ success: true, kind, nearworkScore: nw, status: completed ? 'completed' : 'partial' });
}
