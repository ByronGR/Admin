import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { buildResetEmail } from '@/lib/reset-email';

// ─── POST /api/send-reset ─────────────────────────────────────────────────────
// Sends a branded password-reset email via Resend, using a reset link generated
// by the Firebase Admin SDK (generatePasswordResetLink). Public + unauthenticated
// by nature (forgot-password), so it must never reveal whether an account exists.
// Body: { email, continueUrl? }  — continueUrl is the caller's own /reset-password
// page; it is allowlisted to *.nearwork.co.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RESET_PAGE = 'https://app.nearwork.co/reset-password';

const ALLOWED_ORIGINS = [
  'https://app.nearwork.co',
  'https://www.nearwork.co',
  'https://nearwork.co',
];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function isAllowedResetPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'nearwork.co' || u.hostname.endsWith('.nearwork.co'));
  } catch {
    return false;
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));
  let body: { email?: string; continueUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400, headers: cors });
  }

  const resetPage = body.continueUrl && isAllowedResetPage(body.continueUrl) ? body.continueUrl : DEFAULT_RESET_PAGE;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured on the server' }, { status: 500, headers: cors});
  }

  // Generate the reset link + look up the display name. If the user does not exist
  // (or credentials are missing), we still return success below so the endpoint
  // never leaks account existence — but missing credentials are logged server-side.
  let resetLink: string | null = null;
  let firstName = 'there';
  try {
    const auth = adminAuth();
    const fbLink = await auth.generatePasswordResetLink(email);
    const oobCode = new URL(fbLink).searchParams.get('oobCode');
    if (oobCode) {
      resetLink = `${resetPage}?oobCode=${encodeURIComponent(oobCode)}&email=${encodeURIComponent(email)}`;
    }
    try {
      const user = await auth.getUserByEmail(email);
      const display = user.displayName?.trim();
      if (display) firstName = display.split(/\s+/)[0];
    } catch {
      /* no display name — keep fallback */
    }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    if (code === 'auth/user-not-found') {
      // Don't reveal that the account doesn't exist.
      return NextResponse.json({ success: true }, { headers: cors});
    }
    console.error('[send-reset] could not generate reset link:', e);
    return NextResponse.json(
      { error: 'Password reset is not available right now. Please try again later.' },
      { status: 503, headers: cors},
    );
  }

  if (!resetLink) {
    return NextResponse.json({ success: true }, { headers: cors});
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@nearwork.co';
  const from = fromEmail.includes('<') ? fromEmail : `Nearwork <${fromEmail}>`;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;
  const html = buildResetEmail(firstName, resetLink);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [email],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: 'Reset your Nearwork password',
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[send-reset] Resend error:', err);
      return NextResponse.json({ error: 'Could not send the reset email' }, { status: 502, headers: cors});
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, id: data?.id ?? null }, { headers: cors});
  } catch (e) {
    console.error('[send-reset] fetch failed:', e);
    return NextResponse.json({ error: 'Failed to reach the email service' }, { status: 502, headers: cors});
  }
}
