import { NextResponse } from 'next/server';
import { senderFields } from '@/lib/email-sender';
import { buildInviteEmail } from '@/components/organizations/invite-email';
import { adminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = [
  'https://app.nearwork.co',
  'https://admin.nearwork.co',
];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Secret',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  let body: { email?: string; firstName?: string; orgName?: string; setupLink?: string; orgId?: string; token?: string; inviteeName?: string; businessRole?: string; portalRole?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const { email, firstName, orgName, setupLink, orgId, token: inviteToken, inviteeName, businessRole, portalRole } = body;
  if (!email || !orgName || !setupLink) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: cors });
  }

  // Store invite in Firestore if token and orgId provided
  if (inviteToken && orgId) {
    try {
      const db = adminDb();
      await db.collection('org_invites').doc(inviteToken).set({
        token: inviteToken,
        email: email.trim().toLowerCase(),
        orgId,
        orgName,
        inviteeName: inviteeName || '',
        businessRole: businessRole || '',
        // What the invited person may DO, as opposed to their job title. The
        // accept endpoint reads it from here rather than from the invite URL,
        // where anyone could have raised it to admin on the way in.
        portalRole: portalRole || 'viewer_client',
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        setupLink,
      });
    } catch (e) {
      console.error('[send-invite] Firestore write failed:', e);
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY is not configured on the server' },
      { status: 500, headers: cors },
    );
  }

  const sender = senderFields('client');
  const html = buildInviteEmail(firstName || 'there', orgName, setupLink);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        ...sender,
        to: [email],
        subject: `Set up your Nearwork account — ${orgName}`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[send-invite] Resend error:', err);
      return NextResponse.json({ error: 'Resend rejected the request', detail: err }, { status: 502, headers: cors });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, id: data?.id ?? null }, { headers: cors });
  } catch (e) {
    console.error('[send-invite] fetch failed:', e);
    return NextResponse.json({ error: 'Failed to reach Resend' }, { status: 502, headers: cors });
  }
}
