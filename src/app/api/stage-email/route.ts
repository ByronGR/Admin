import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { STAGE_TEMPLATES } from './templates';

// POST /api/stage-email
// Debounced stage-change emails for candidates. Called (fire-and-forget) by the
// Admin pipeline board on every stage move:
//
//   { action: 'stage-moved', pipelineCode, candidateId, fromStage, toStage, ... }
//   { action: 'cancel',      pipelineCode, candidateId }
//
// Behaviour (per Byron's spec):
//   • Forward move or move to Not Selected → schedule that stage's email for
//     5 minutes from now using Resend's `scheduled_at`. Any newer move first
//     CANCELS the previously scheduled email, so only the stage the candidate
//     actually settles in emails them.
//   • Backward (corrective) move → cancel any pending email, send nothing.
//   • Same-stage drop → no-op (doesn't disturb a pending email).
//
// KILL SWITCH: emails only go out when Firestore doc appSettings/stageEmails
// has { enabled: true }. Until then every eligible move is recorded in
// stageEmailQueue with mode 'simulated' (no Resend call) so the mechanics can
// be verified with zero risk of a real candidate being emailed.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DELAY_MINUTES = Number(process.env.STAGE_EMAIL_DELAY_MINUTES || 5);

const ALLOWED_ORIGINS = ['https://admin.nearwork.co'];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

// Ordered progress stages — mirrors the pipeline board's PROGRESS_STAGES.
const PROGRESS_ORDER = [
  'applied',
  'background-check',
  'interview',
  'assessment',
  'partner-review',
  'partner-interview',
  'hired',
];
const rank = (s: string) => PROGRESS_ORDER.indexOf(String(s || '').toLowerCase());

async function requireStaff(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

// Cancel a Resend scheduled email. Best-effort — if it already sent or the id
// is gone, we just move on.
async function cancelResendEmail(resendId: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !resendId) return;
  try {
    await fetch(`https://api.resend.com/emails/${resendId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch { /* best-effort */ }
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Staff only' }, { status: 401, headers: cors });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    pipelineCode?: string;
    candidateId?: string;
    fromStage?: string;
    toStage?: string;
    candidateName?: string;
    candidateEmail?: string;
    roleTitle?: string;
    orgName?: string;
  };

  const action = String(body.action || '');
  const pipelineCode = String(body.pipelineCode || '').trim();
  const candidateId = String(body.candidateId || '').trim();
  if (!pipelineCode || !candidateId) {
    return NextResponse.json({ ok: false, error: 'pipelineCode and candidateId are required' }, { status: 400, headers: cors });
  }

  try {
    const db = adminDb();
    const queueRef = db.collection('stageEmailQueue').doc(`${pipelineCode}_${candidateId}`);
    const existingSnap = await queueRef.get();
    const existing = existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : null;
    const existingResendId = existing ? String(existing.resendId || '') : '';
    const now = new Date().toISOString();

    // ── Explicit cancel (candidate removed from pipeline, etc.) ──
    if (action === 'cancel') {
      if (existingResendId && existing?.mode === 'scheduled') await cancelResendEmail(existingResendId);
      if (existingSnap.exists) {
        await queueRef.set({ mode: 'cancelled', cancelledBy: staff, updatedAt: now }, { merge: true });
      }
      return NextResponse.json({ ok: true, cancelled: existingSnap.exists }, { headers: cors });
    }

    if (action !== 'stage-moved') {
      return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400, headers: cors });
    }

    const fromStage = String(body.fromStage || '').toLowerCase();
    const toStage = String(body.toStage || '').toLowerCase();

    // Same-stage drop → leave any pending email untouched.
    if (fromStage === toStage) {
      return NextResponse.json({ ok: true, scheduled: false, reason: 'same-stage' }, { headers: cors });
    }

    // Any real move first cancels whatever was pending — the timer resets.
    if (existingResendId && existing?.mode === 'scheduled') await cancelResendEmail(existingResendId);

    // Eligibility: forward move or rejection. Backward = cancel only.
    const isRejection = toStage === 'not-selected';
    const isForward = rank(toStage) > rank(fromStage);
    if (!isRejection && !isForward) {
      await queueRef.set(
        { pipelineCode, candidateId, mode: 'cancelled', reason: 'backward-move', fromStage, toStage, updatedAt: now, updatedBy: staff },
        { merge: true },
      );
      return NextResponse.json({ ok: true, scheduled: false, reason: 'backward-move' }, { headers: cors });
    }

    const template = STAGE_TEMPLATES[toStage];
    if (!template) {
      return NextResponse.json({ ok: true, scheduled: false, reason: 'no-template' }, { headers: cors });
    }

    // Resolve the candidate's email (board rows don't always carry it).
    let email = String(body.candidateEmail || '').trim().toLowerCase();
    let name = String(body.candidateName || '').trim();
    if (!email || !name) {
      const candSnap = await db.collection('candidates').doc(candidateId).get();
      if (candSnap.exists) {
        const cd = candSnap.data() as Record<string, unknown>;
        email = email || String(cd.email || '').toLowerCase();
        name = name || String(cd.name || '');
      }
    }
    if (!email) {
      await queueRef.set(
        { pipelineCode, candidateId, mode: 'skipped', reason: 'no-email', stage: toStage, fromStage, updatedAt: now, updatedBy: staff },
        { merge: true },
      );
      return NextResponse.json({ ok: true, scheduled: false, reason: 'no-email' }, { headers: cors });
    }

    const sendAt = new Date(Date.now() + DELAY_MINUTES * 60_000).toISOString();
    const data = {
      firstName: name.split(/\s+/)[0] || 'there',
      candidateName: name,
      roleTitle: String(body.roleTitle || 'your application'),
      orgName: String(body.orgName || ''),
    };

    // ── Kill switch: appSettings/stageEmails { enabled: true } required ──
    const settingsSnap = await db.collection('appSettings').doc('stageEmails').get();
    const enabled = settingsSnap.exists && settingsSnap.data()?.enabled === true;

    let resendId: string | null = null;
    let mode: 'scheduled' | 'simulated' = 'simulated';

    if (enabled) {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        return NextResponse.json({ ok: false, error: 'RESEND_API_KEY not configured' }, { status: 500, headers: cors });
      }
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@nearwork.co';
      const from = fromEmail.includes('<') ? fromEmail : `Nearwork <${fromEmail}>`;
      const { subject, html } = template.build(data);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to: [email], subject, html, scheduled_at: sendAt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[stage-email] Resend schedule failed:', err);
        return NextResponse.json({ ok: false, error: 'Failed to schedule email' }, { status: 502, headers: cors });
      }
      const resData = (await res.json().catch(() => ({}))) as { id?: string };
      resendId = resData?.id ?? null;
      mode = 'scheduled';
    }

    await queueRef.set({
      pipelineCode,
      candidateId,
      candidateEmail: email,
      candidateName: name,
      stage: toStage,
      fromStage,
      roleTitle: data.roleTitle,
      orgName: data.orgName,
      mode,               // 'scheduled' (live) | 'simulated' (kill switch off)
      resendId,
      sendAt,
      delayMinutes: DELAY_MINUTES,
      updatedBy: staff,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true, scheduled: enabled, mode, sendAt }, { headers: cors });
  } catch (e) {
    console.error('[stage-email] failed:', e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message || 'stage-email failed' }, { status: 500, headers: cors });
  }
}
