import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';
import { parseAssessment, parseDisc } from '@/lib/assessment-parser';

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
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (kind !== 'assessment' && kind !== 'disc') return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  if (!candidateId) return NextResponse.json({ error: 'Missing candidateId' }, { status: 400 });

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

  // Resolve the candidate's org so the client portal (scoped by org) can read it.
  let orgId = String(form.get('orgId') || '').trim() || null;
  if (!orgId) {
    try {
      const cand = await db.collection('candidates').doc(candidateId).get();
      const code = cand.get('activePipelineCode');
      if (code) {
        const pipe = await db.collection('pipelines').doc(String(code)).get();
        orgId = (pipe.get('orgId') as string) || (pipe.get('organizationId') as string) || null;
      }
    } catch { /* best effort — org can be backfilled */ }
  }

  const ref = db.collection('assessments').doc(candidateId);
  const base: Record<string, unknown> = { candidateId, orgId, gradedBy: 'Nearwork talent team', updatedAt: FieldValue.serverTimestamp() };

  if (kind === 'assessment') {
    const p = parseAssessment(text);
    Object.assign(base, {
      role: p.role,
      result: p.result,
      overallScore: p.overallScore,
      passingScore: p.passingScore,
      summary: p.summary,
      integrity: p.integrity,
      english: p.english,
      questions: p.questions,
      assessmentUploadedAt: FieldValue.serverTimestamp(),
    });
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

  return NextResponse.json({ success: true, kind, nearworkScore: nw, status: completed ? 'completed' : 'partial' });
}
