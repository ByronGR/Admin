import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { serperSearch, googleSearch, writePlan, buildQueriesFromPhrases, filterResults, normSlug } from '@/lib/xray';
import { ensureOpeningReqs, reqsAsPlanBrief } from '@/lib/opening-reqs';
import type { Opening } from '@/lib/types';

// ─── POST /api/sourcing/find ──────────────────────────────────────────────────
// Runs an X-ray sourcing pass for one opening and appends net-new candidates to
// Firestore. Two modes:
//   'ai'   → Claude Haiku (re)writes the search plan, fresh batch (AI cost)
//   'more' → reuse the cached plan, page deeper, no AI cost
//
// Guards:
//   • staff-only — a valid Firebase ID token from a @nearwork.co account
//   • daily caps in Firestore (sourcingUsage/{day}) so the ANTHROPIC/Serper keys
//     can't be exploited: AI Search runs and total search runs are both capped.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CAP_AI_RUNS = 30;      // Claude Haiku plan writes per day (the paid AI path)
const CAP_FIND_RUNS = 150;   // total search runs per day (Serper/Google quota guard)

async function requireStaffEmail(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : '';
    return email.endsWith('@nearwork.co') ? email : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  const email = await requireStaffEmail(req);
  if (!email) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: { openingId?: string; countries?: string[]; english?: boolean; excludeOwners?: boolean; mode?: 'ai' | 'more' } = {};
  try { body = await req.json(); } catch { /* noop */ }
  const openingId = (body.openingId || '').trim();
  const mode = body.mode === 'ai' ? 'ai' : 'more';
  const english = body.english !== false;
  const excludeOwners = body.excludeOwners !== false;
  const codes = (Array.isArray(body.countries) ? body.countries : []).filter(Boolean);
  if (!openingId) return NextResponse.json({ ok: false, reason: 'missing_opening' }, { status: 400 });
  if (!codes.length) return NextResponse.json({ ok: false, reason: 'no_countries', message: 'Pick at least one country.' }, { status: 400 });

  const db = adminDb();
  const notes: string[] = [];

  // ── Daily cap (atomic) — blocks abuse of the AI + search keys ──
  const day = new Date().toISOString().slice(0, 10);
  const usageRef = db.collection('sourcingUsage').doc(day);
  const capMsg = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const d = (snap.exists ? snap.data() : {}) as { findRuns?: number; aiRuns?: number };
    if ((d.findRuns || 0) >= CAP_FIND_RUNS) return 'Daily sourcing limit reached — try again tomorrow.';
    if (mode === 'ai' && (d.aiRuns || 0) >= CAP_AI_RUNS) return 'Daily AI Search limit reached — use “Find more” (no AI cost) or try again tomorrow.';
    tx.set(usageRef, { findRuns: (d.findRuns || 0) + 1, aiRuns: (d.aiRuns || 0) + (mode === 'ai' ? 1 : 0), updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
    return null;
  });
  if (capMsg) return NextResponse.json({ ok: false, reason: 'rate_limited', message: capMsg }, { status: 429 });

  // ── Opening → job description for the AI plan ──
  const opSnap = await db.collection('openings').doc(openingId).get();
  if (!opSnap.exists) return NextResponse.json({ ok: false, reason: 'opening_not_found' }, { status: 404 });
  const op = opSnap.data() as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.join('; ') : '');

  // Structured requirements, extracted once and shared with candidate matching.
  // Sourcing and matching used to interpret the job post separately, which meant
  // people found outside were judged by different keywords than people already
  // in the database. Best-effort: if this fails, the plan writer still gets the
  // raw post and behaves exactly as it did before.
  const ensured = await ensureOpeningReqs(openingId, op as unknown as Opening);
  const brief = reqsAsPlanBrief(ensured.reqs);

  const jd = brief + [
    op.title, op.content_about || op.description || op.publicSummary || '',
    arr(op.content_qualifications), arr(op.requirements),
    Array.isArray(op.skills) ? 'Skills: ' + (op.skills as string[]).join(', ') : '',
  ].filter(Boolean).join('\n');

  // ── Plan (cached per opening; AI writes it only on mode 'ai' or first run) ──
  const planRef = db.collection('searchPlans').doc(openingId);
  const planSnap = await planRef.get();
  const plan = (planSnap.exists ? planSnap.data() : {}) as { phrases?: string[]; page?: number; pulled?: string[]; aliases?: string[]; domain?: string };
  let phrases = plan.phrases || [];
  let planAliases = plan.aliases || [];
  let planDomain = plan.domain || '';
  let aiCost = false;
  if (mode === 'ai' || !phrases.length) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return NextResponse.json({ ok: false, reason: 'not_configured', message: 'ANTHROPIC_API_KEY missing.' }, { status: 500 });
    const written = await writePlan(key, jd || String(op.title || ''));
    if (!written.phrases) return NextResponse.json({ ok: false, reason: 'ai_failed', message: written.error || 'AI plan failed' }, { status: 502 });
    phrases = written.phrases;
    planAliases = written.aliases || [];
    planDomain = written.domain || '';
    aiCost = true;
  }

  // ── Pagination + dedup set (fresh batch for 'ai', page deeper for 'more') ──
  const page = mode === 'more' ? (plan.page || 1) + 1 : 1;
  const pulled = new Set<string>(mode === 'more' ? (plan.pulled || []) : []);
  // Also dedup against everyone already in this opening's table (incl. manual adds).
  const existingSnap = await db.collection('sourcedCandidates').where('openingId', '==', openingId).get();
  existingSnap.docs.forEach(d => { const li = (d.data().li as string) || ''; if (li) pulled.add(normSlug(li.replace('/in/', ''))); });

  // ── Run the searches ──
  const queries = buildQueriesFromPhrases(phrases, codes);
  const serperKey = process.env.SERPER_API_KEY;
  const gKey = process.env.GOOGLE_API_KEY, gCx = process.env.GOOGLE_CX;
  const rawItems: { title?: string; link?: string; snippet?: string }[] = [];
  if (serperKey) {
    for (const q of queries) {
      const r = await serperSearch(serperKey, q, { english, page });
      if (r.error) { notes.push('Serper: ' + r.error); break; }
      rawItems.push(...r.items);
    }
  } else if (gKey && gCx) {
    for (const q of queries) {
      const r = await googleSearch(gKey, gCx, q, { english });
      if (r.error) { notes.push('Google: ' + r.error); break; }
      rawItems.push(...r.items);
    }
  } else {
    return NextResponse.json({ ok: false, reason: 'not_configured', message: 'No SERPER_API_KEY or Google key configured.' }, { status: 500 });
  }

  const { candidates, stats } = filterResults(rawItems, { codes, pulled, excludeOwners });

  // ── Append net-new candidates ──
  if (candidates.length) {
    const batch = db.batch();
    const col = db.collection('sourcedCandidates');
    for (const c of candidates) {
      batch.set(col.doc(), {
        openingId, name: c.name, li: c.li, linkedin: c.linkedin, location: c.location, country: c.country,
        source: 'X-ray', owner: '', status: 'New', reason: '', salary: '', applied: false,
        last: 'just sourced', notes: '', createdAt: GCFieldValue.serverTimestamp(), updatedAt: GCFieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // ── Save the plan + pagination state ──
  await planRef.set({
    openingId, phrases, aliases: planAliases, domain: planDomain, page, pulled: [...pulled],
    runs: GCFieldValue.increment(1), kept: GCFieldValue.increment(candidates.length),
    lastRun: GCFieldValue.serverTimestamp(), ...(planSnap.exists ? {} : { createdAt: GCFieldValue.serverTimestamp() }),
  }, { merge: true });

  return NextResponse.json({ ok: true, added: candidates.length, phrases, aliases: planAliases, domain: planDomain, aiCost, stats, notes, page });
}
