import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { extractOpeningRequirements } from '@/lib/opening-ai-extract';
import { cvApiKey, cvDailyCap } from '@/lib/cv-ai-extract';
import type { Opening, OpeningReqs } from '@/lib/types';

// ── /api/opening-parse ────────────────────────────────────────────────────────
// POST { openingId } → extract structured requirements from the opening's text
// and save them to opening.reqs, so candidates can be matched against it.
//
// One Claude call, ~$0.01 per opening — openings are text-only (no PDF), so this
// is a third of a CV parse. Shares the CV daily cap: same key, same budget.
//
// A recruiter's edits always win. Once reqs.editedBy is set, re-extracting
// requires ?force=1, so an accidental re-run can't quietly discard a human's
// must-have/nice-to-have split.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  const key = cvApiKey();
  if (!key) return NextResponse.json({ error: 'No API key configured' }, { status: 500 });

  let body: { openingId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }
  const openingId = body.openingId;
  if (!openingId) return NextResponse.json({ error: 'openingId required' }, { status: 400 });

  const db = adminDb();
  const ref = db.collection('openings').doc(openingId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Opening not found' }, { status: 404 });
  const opening = snap.data() as Opening;

  const force = new URL(req.url).searchParams.get('force') === '1';
  if (opening.reqs?.editedBy && !force) {
    return NextResponse.json({
      error: `These requirements were edited by ${opening.reqs.editedBy}. Re-extracting would discard those changes.`,
      needsForce: true,
    }, { status: 409 });
  }

  // Same daily cap as CV parsing — one shared budget for one shared key.
  const day = new Date().toISOString().slice(0, 10);
  const usageRef = db.collection('cvParseUsage').doc(day);
  const capped = await db.runTransaction(async (tx) => {
    const s = await tx.get(usageRef);
    const d = (s.exists ? s.data() : {}) as { aiParses?: number };
    if ((d.aiParses || 0) >= cvDailyCap()) return true;
    tx.set(usageRef, { aiParses: (d.aiParses || 0) + 1, updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
    return false;
  });
  if (capped) {
    return NextResponse.json({ error: 'Daily parsing limit reached — try again tomorrow.' }, { status: 429 });
  }

  try {
    const r = await extractOpeningRequirements(opening, key);
    const reqs: OpeningReqs = {
      ...r.requirements,
      extractedAt: new Date().toISOString(),
      model: r.model,
      schemaVersion: r.schemaVersion,
    };
    await ref.set({ reqs, updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ success: true, reqs, costUsd: Number(r.costUsd.toFixed(5)) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[opening-parse] failed:', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
