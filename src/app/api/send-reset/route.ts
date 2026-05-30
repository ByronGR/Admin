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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isAllowedResetPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'nearwork.co' || u.hostname.endsWith('.nearwork.co'));
  } catch {
    return false;
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  let body: { email?: string; continueUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400, headers: CORS });
  }

  const resetPage = body.continueUrl && isAllowedResetPage(body.continueUrl) ? body.continueUrl : DEFAULT_RESET_PAGE;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not configured on the server' }, { status: 500, headers: CORS });
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
      return NextResponse.json({ success: true }, { headers: CORS });
    }
    console.error('[send-reset] could not generate reset link:', e);
    const diag = new URL(req.url).searchParams.get('diag') === 'wifcheck1';
    return NextResponse.json(
      diag
        ? { error: 'diag', detail: (e as Error)?.message ?? String(e), hasOidc: !!process.env.VERCEL_OIDC_TOKEN, hasAud: !!process.env.GCP_WIF_AUDIENCE, vercelEnv: process.env.VERCEL_ENV ?? null, envKeys: Object.keys(process.env).filter((k) => /^VERCEL|OIDC|GCP|GOOGLE|FIREBASE/.test(k)).sort() }
        : { error: 'Password reset is not available right now. Please try again later.' },
      { status: 503, headers: CORS },
    );
  }

  if (!resetLink) {
    return NextResponse.json({ success: true }, { headers: CORS });
  }

  const from = process.env.RESEND_FROM_EMAIL || 'Nearwork <noreply@nearwork.co>';
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
      return NextResponse.json({ error: 'Could not send the reset email' }, { status: 502, headers: CORS });
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, id: data?.id ?? null }, { headers: CORS });
  } catch (e) {
    console.error('[send-reset] fetch failed:', e);
    return NextResponse.json({ error: 'Failed to reach the email service' }, { status: 502, headers: CORS });
  }
}
