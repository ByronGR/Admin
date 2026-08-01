import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { extractCVWithAI, cvApiKey } from '@/lib/cv-ai-extract';
import { aiProfileToCandidate } from '@/lib/cv-ai-to-candidate';
import { clientCandidateSnapshot } from '@/lib/client-candidate-snapshot';
import type { Candidate, PipelineCandidate } from '@/lib/types';

// ── /api/cv-parse/bulk ────────────────────────────────────────────────────────
// GET  → which candidates have a CV on file, and which have already been parsed.
// POST → parse + save a SMALL batch of them (ids supplied by the caller).
//
// Deliberately batched rather than "parse everything in one request": a
// serverless function would time out long before 140 CVs were done. The client
// loops over small batches instead, which also gives live progress and lets the
// run be stopped part-way without losing what already saved.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_PER_CALL = 3;      // keeps each request comfortably inside the limit
const CAP_AI_PARSES = 200;   // shared daily ceiling with the single-parse route

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

export async function GET(req: Request) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  }
  const snap = await adminDb().collection('candidates').get();
  const rows = snap.docs
    .map((d) => {
      const c = d.data() as Candidate;
      const cv = c.resumeUrl || c.cvUrl || '';
      return {
        id: d.id,
        name: c.name || '(no name)',
        email: (c.email || '').toLowerCase(),
        cvUrl: cv,
        parsedAt: c.cvParse?.parsedAt ? String(c.cvParse.parsedAt) : '',
        flags: c.cvParse?.lowConfidence?.length || 0,
        // Full text, so the UI can group flags by theme across the whole
        // database instead of making staff open 122 profiles one by one.
        flagList: c.cvParse?.lowConfidence || [],
      };
    })
    .filter((r) => r.cvUrl);
  return NextResponse.json({ total: snap.size, withCv: rows.length, candidates: rows });
}

export async function POST(req: Request) {
  const email = await requireStaff(req);
  if (!email) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  const key = cvApiKey();
  if (!key) return NextResponse.json({ error: 'No CV parsing key configured (ANTHROPIC_CV_API_KEY or ANTHROPIC_API_KEY)' }, { status: 500 });

  let body: { candidateIds?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }
  const ids = (body.candidateIds || []).slice(0, MAX_PER_CALL);
  if (!ids.length) return NextResponse.json({ error: 'candidateIds required' }, { status: 400 });

  const db = adminDb();
  const day = new Date().toISOString().slice(0, 10);
  const usageRef = db.collection('cvParseUsage').doc(day);

  const results: {
    id: string; name: string; ok: boolean; costUsd?: number; flags?: number; error?: string;
  }[] = [];

  for (const id of ids) {
    const ref = db.collection('candidates').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { results.push({ id, name: id, ok: false, error: 'not found' }); continue; }
    const c = snap.data() as Candidate;
    const name = c.name || id;
    const cvUrl = c.resumeUrl || c.cvUrl;
    if (!cvUrl) { results.push({ id, name, ok: false, error: 'no CV on file' }); continue; }

    // Daily cap, counted per CV actually attempted.
    const capped = await db.runTransaction(async (tx) => {
      const s = await tx.get(usageRef);
      const d = (s.exists ? s.data() : {}) as { aiParses?: number };
      if ((d.aiParses || 0) >= CAP_AI_PARSES) return true;
      tx.set(usageRef, { aiParses: (d.aiParses || 0) + 1, updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
      return false;
    });
    if (capped) { results.push({ id, name, ok: false, error: 'daily limit reached' }); break; }

    try {
      const res = await fetch(cvUrl);
      if (!res.ok) throw new Error(`could not download CV (${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());

      // Storage URLs rarely carry a usable filename; fall back to the content
      // type so the extractor still picks the right reader.
      const ct = res.headers.get('content-type') || '';
      const filename = ct.includes('word') || /\.docx(\?|$)/i.test(cvUrl) ? `${id}.docx` : `${id}.pdf`;

      const r = await extractCVWithAI(buf, filename, key, ct);
      const patch = aiProfileToCandidate(r.profile, {
        model: r.model, schemaVersion: r.schemaVersion, rawText: r.rawText,
      });
      await ref.set({ ...patch, updatedAt: GCFieldValue.serverTimestamp(), cvParsedBy: email }, { merge: true });

      // Mirror the client-visible subset into the candidate's pipeline entries.
      const merged = { ...c, ...patch, id } as Candidate;
      const clientSnap = clientCandidateSnapshot(merged);
      const pipes = await db.collection('pipelines').get();
      await Promise.all(pipes.docs.map(async (p) => {
        const list = (p.data() as { candidates?: PipelineCandidate[] }).candidates ?? [];
        if (!list.some((e) => e.candidateId === id)) return;
        const next = list.map((e) => (e.candidateId === id ? { ...e, ...clientSnap } : e));
        try { await p.ref.update({ candidates: next, updatedAt: GCFieldValue.serverTimestamp() }); } catch { /* best-effort */ }
      }));

      results.push({ id, name, ok: true, costUsd: r.costUsd, flags: r.profile.lowConfidence?.length || 0 });
    } catch (e) {
      results.push({ id, name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
}
