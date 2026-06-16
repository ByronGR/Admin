import { NextResponse } from 'next/server';
import * as jobApplied from './templates/job_applied';
import * as accountCreated from './templates/account_created';
import * as similarRoleAlert from './templates/similar_role_alert';
import * as candidatePasswordReset from './templates/candidate_password_reset';

// ─── POST /api/send-email ────────────────────────────────────────────────────
// Generic branded email sender used by all Nearwork services.
// Body: { to, templateId, data }
//
// Supported templateIds  (add a new file under templates/ to extend):
//   'job_applied'              — candidate applied for a role
//                                data: { firstName, roleTitle }
//   'account_created'          — candidate created their Talent portal account
//                                data: { firstName }
//   'candidate_password_reset' — candidate requested a password reset
//                                data: { firstName, resetLink }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Template registry ───────────────────────────────────────────────────────
// Each entry must export: build(data): { subject, html }

const TEMPLATES: Record<string, { build(data: Record<string, string>): { subject: string; html: string } }> = {
  job_applied:                jobApplied,
  account_created:            accountCreated,
  similar_role_alert:         similarRoleAlert,
  candidate_password_reset:   candidatePasswordReset,
};

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://talent.nearwork.co',
  'https://jobs.nearwork.co',
  'https://www.nearwork.co',
];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get('origin');
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  let body: { to?: string; templateId?: string; data?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const { to, templateId, data = {} } = body;
  if (!to || !templateId) {
    return NextResponse.json(
      { error: 'Missing required fields: to, templateId' },
      { status: 400, headers: cors },
    );
  }

  const template = TEMPLATES[templateId];
  if (!template) {
    return NextResponse.json(
      { error: `Unknown templateId: ${templateId}` },
      { status: 400, headers: cors },
    );
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY is not configured on the server' },
      { status: 500, headers: cors },
    );
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@nearwork.co';
  const from = fromEmail.includes('<') ? fromEmail : `Nearwork <${fromEmail}>`;

  const { subject, html } = template.build(data);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[send-email] Resend error:', err);
      return NextResponse.json(
        { ok: false, error: 'Resend rejected the request', detail: err },
        { status: 502, headers: cors },
      );
    }

    const resData = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, id: resData?.id ?? null }, { headers: cors });
  } catch (e) {
    console.error('[send-email] fetch failed:', e);
    return NextResponse.json({ ok: false, error: 'Failed to reach Resend' }, { status: 502, headers: cors });
  }
}
