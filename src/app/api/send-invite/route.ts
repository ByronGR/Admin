import { NextResponse } from 'next/server';
import { buildInviteEmail } from '@/components/organizations/invite-email';

// ─── POST /api/send-invite ──────────────────────────────────────────────────
// Sends the client invite email server-side via Resend.
// Uses RESEND_API_KEY (server-only — never exposed to the browser).
// Body: { email, firstName, orgName, setupLink }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { email?: string; firstName?: string; orgName?: string; setupLink?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, firstName, orgName, setupLink } = body;
  if (!email || !orgName || !setupLink) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@nearwork.co';
  const from = fromEmail.includes('<') ? fromEmail : `Nearwork <${fromEmail}>`;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;
  const html = buildInviteEmail(firstName || 'there', orgName, setupLink);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `Set up your Nearwork account — ${orgName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[send-invite] Resend error:', err);
      return NextResponse.json({ error: 'Resend rejected the request', detail: err }, { status: 502 });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, id: data?.id ?? null });
  } catch (e) {
    console.error('[send-invite] fetch failed:', e);
    return NextResponse.json({ error: 'Failed to reach Resend' }, { status: 502 });
  }
}
