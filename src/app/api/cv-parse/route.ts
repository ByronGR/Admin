import { NextResponse } from 'next/server';
// GCFieldValue must come from our own module — the sentinels only work when they
// share the firebase-admin instance the SDK was initialised with.
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';
import { detectKind, extractCVText } from '@/lib/cv-extract-text';
import { parseCV } from '@/lib/cv-parser';
import { extractCVWithAI, cvApiKey, cvDailyCap } from '@/lib/cv-ai-extract';

// ── POST /api/cv-parse ────────────────────────────────────────────────────────
// Staff upload a candidate's CV (PDF or .docx). The file is parsed IN MEMORY
// (never stored) and the structured fields are returned as JSON. This endpoint
// does NOT write to Firestore — the caller reviews the result and decides what
// to save. Replaces the paid Affinda parser.
//
// Two engines:
//   • 'ai'   — one Claude call (~$0.03/CV). Reads visual layout, so two-column
//              CVs and scanned pages work. Pulls accomplishments, tools, and the
//              function/seniority classification that candidate↔opening matching
//              needs. This is the default.
//   • 'code' — the local rules parser. Free, no network. Used as the fallback
//              when the AI path errors or the key is missing, so an upload never
//              hard-fails.
// Guarded by a daily cap in Firestore (cvParseUsage/{day}), mirroring the
// Sourcing X-ray tool, so the ANTHROPIC key can't be run up unexpectedly.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — CVs are small; reject oversized files.

export async function POST(req: Request) {
  // Staff-only, same gate as assessment-upload.
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
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 });

  const kind = detectKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a PDF or Word (.docx).' }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = cvApiKey();
  // ?engine=code forces the free local parser (comparison / fallback testing).
  const forceCode = new URL(req.url).searchParams.get('engine') === 'code';
  let aiError = '';

  // ── AI path (default) ──────────────────────────────────────────────────────
  if (key && !forceCode) {
    // Daily cap (atomic) — same guard as the Sourcing X-ray tool.
    const day = new Date().toISOString().slice(0, 10);
    const usageRef = adminDb().collection('cvParseUsage').doc(day);
    const capped = await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const d = (snap.exists ? snap.data() : {}) as { aiParses?: number };
      if ((d.aiParses || 0) >= cvDailyCap()) return true;
      tx.set(usageRef, { aiParses: (d.aiParses || 0) + 1, updatedAt: GCFieldValue.serverTimestamp() }, { merge: true });
      return false;
    });
    if (capped) {
      return NextResponse.json(
        { error: 'Daily CV parsing limit reached — try again tomorrow.' },
        { status: 429 },
      );
    }

    try {
      const r = await extractCVWithAI(buf, file.name, key, file.type);
      return NextResponse.json({
        success: true,
        engine: 'ai',
        kind,
        profile: r.profile,
        meta: {
          model: r.model,
          schemaVersion: r.schemaVersion,
          costUsd: Number(r.costUsd.toFixed(5)),
          usage: r.usage,
          // Persist alongside the candidate so re-parsing the whole database
          // later costs ~$2 instead of being a migration project.
          rawText: r.rawText,
        },
      });
    } catch (e) {
      // Never hard-fail an upload on the AI path — fall through to the parser,
      // but keep the reason so the response can explain what happened.
      aiError = e instanceof Error ? e.message : String(e);
      console.error('[cv-parse] AI extraction failed, falling back to code parser:', e);
    }
  }

  // ── Code fallback ──────────────────────────────────────────────────────────
  let text: string;
  try {
    text = await extractCVText(buf, kind);
  } catch (e) {
    const textError = e instanceof Error ? e.message : String(e);
    console.error('[cv-parse] text extraction failed:', e);
    return NextResponse.json(
      {
        error: "Couldn't read that file. Make sure it's a valid PDF or .docx.",
        // Both engines failed — report each reason so this is diagnosable
        // instead of surfacing as one generic message.
        aiError: aiError || (key ? undefined : 'No CV parsing key set (ANTHROPIC_CV_API_KEY or ANTHROPIC_API_KEY)'),
        textError,
      },
      { status: 422 },
    );
  }

  if (!text.trim()) {
    return NextResponse.json(
      { error: 'No text found — this looks like a scanned image, and the AI reader is unavailable right now. Try again shortly.' },
      { status: 422 },
    );
  }

  const parsed = parseCV(text);
  return NextResponse.json({ success: true, engine: 'code', kind, parsed });
}
