import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// ── POST /api/org-invites/accept ─────────────────────────────────────────────
// Turns an invited person into a client user of one organization.
//
// This used to happen in the browser: the sign-up page read orgId straight out
// of the invite URL's query string and wrote it onto the user's own document.
// Nothing checked that the orgId in the link matched the invite it came from —
// so editing one parameter attached your account to any organization you named,
// and org membership is what sameOrg() uses to grant read access to that
// company's pipelines, applications, notes, placements, payroll, reviews,
// billing and time off.
//
// The invite record is the only thing that can say which organization a person
// was invited to, and it lives where the invited person cannot edit it. So the
// server reads it, checks the signed-in email against it, and writes the
// membership itself. The browser now sends a token and nothing else that
// matters.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://app.nearwork.co', 'https://admin.nearwork.co'];
const PORTAL_ROLES = ['admin_client', 'viewer_client', 'client_admin', 'client_user', 'viewer'];

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

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  let body: { token?: string; firstName?: string; lastName?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const token = (body.token || '').trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: 'This invite link is missing its token. Ask for a fresh invite.' }, { status: 400, headers: cors });
  }

  const authz = req.headers.get('authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!idToken) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401, headers: cors });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401, headers: cors });
  }

  const uid = decoded.uid;
  const signedInEmail = String(decoded.email || '').trim().toLowerCase();
  if (!signedInEmail) {
    return NextResponse.json({ ok: false, error: 'This account has no email address' }, { status: 400, headers: cors });
  }

  try {
    const db = adminDb();
    const ref = db.collection('org_invites').doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: 'This invite link is not valid. Ask for a fresh invite.' }, { status: 404, headers: cors });
    }

    const inv = snap.data() as {
      email?: string; orgId?: string; orgName?: string; status?: string;
      expiresAt?: string; portalRole?: string; businessRole?: string; inviteeName?: string;
    };

    // The invite names one person. Signing in as somebody else and presenting
    // their token must not attach your account to their company.
    if (String(inv.email || '').trim().toLowerCase() !== signedInEmail) {
      return NextResponse.json(
        { ok: false, error: 'This invite was sent to a different email address.' },
        { status: 403, headers: cors },
      );
    }
    if (inv.status === 'revoked') {
      return NextResponse.json({ ok: false, error: 'This invite has been revoked.' }, { status: 403, headers: cors });
    }
    if (inv.expiresAt && Date.now() > new Date(inv.expiresAt).getTime()) {
      return NextResponse.json({ ok: false, error: 'This invite has expired. Ask for a fresh one.' }, { status: 403, headers: cors });
    }
    if (!inv.orgId) {
      return NextResponse.json({ ok: false, error: 'This invite is not attached to a company.' }, { status: 400, headers: cors });
    }

    // Accepted invites still work. The same link is used to repair a profile
    // that failed to write the first time, and refusing the second attempt is
    // what used to strand people with a login and no workspace.
    const portalRole = PORTAL_ROLES.includes(String(inv.portalRole || ''))
      ? String(inv.portalRole)
      : 'viewer_client';

    const nameParts = String(inv.inviteeName || '').trim().split(/\s+/).filter(Boolean);
    const firstName = (body.firstName || nameParts[0] || '').trim();
    const lastName = (body.lastName || nameParts.slice(1).join(' ') || '').trim();
    const name = [firstName, lastName].filter(Boolean).join(' ') || signedInEmail;

    await db.collection('users').doc(uid).set({
      uid,
      email: signedInEmail,
      name,
      firstName,
      lastName,
      role: 'client',
      portalRole,
      // The whole point of this endpoint: these three come from the invite
      // record, never from anything the browser supplied.
      orgId: inv.orgId,
      organizationId: inv.orgId,
      orgIds: [inv.orgId],
      orgName: inv.orgName || '',
      businessRole: inv.businessRole || '',
      title: inv.businessRole || '',
      jobTitle: inv.businessRole || '',
      displayRole: inv.businessRole || '',
      source: 'app.nearwork.co',
      invitePending: false,
      onboarded: true,
      acceptedInviteId: token,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await ref.set({
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      acceptedByUid: uid,
    }, { merge: true }).catch(() => null);

    return NextResponse.json({
      ok: true,
      orgId: inv.orgId,
      orgName: inv.orgName || '',
      portalRole,
      name,
    }, { headers: cors });
  } catch (e) {
    console.error('[org-invites/accept] failed:', e);
    return NextResponse.json({ ok: false, error: 'Could not complete the invite' }, { status: 500, headers: cors });
  }
}
