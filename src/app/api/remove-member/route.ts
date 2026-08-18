import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { revokeOrgAccess } from '@/lib/revoke-org-access';

// POST /api/remove-member
// Revokes a client teammate's access to a company workspace.
//
// WHAT MAKES ACCESS REAL: the Firestore rules decide whether someone is a client
// by reading users/{uid}.orgId / .orgIds — nothing else. The organization's
// `orgUsers` array and the `orgMembers` collection are bookkeeping for the UI;
// no rule consults either. So removing someone from those lists takes them off
// the screen in Admin while leaving every door open: they keep reading the
// portal, and signing out and back in works fine, because their own user
// document still says which org they belong to.
//
// This therefore revokes in the only place that counts — the user document —
// and then closes the session:
//   1. org.orgUsers / orgMembers  (what staff see)
//   2. users/{uid} org fields     (what the rules enforce)
//   3. refresh tokens revoked     (kills the session they're in right now)
//   4. Auth account disabled      (stops them signing back in)
//
// Steps 3 and 4 are skipped for anyone who still has a reason to log in — staff,
// candidates, and members of another organization — because disabling those
// accounts would lock a person out of a product they're entitled to use. For a
// pure client contact, being unable to log back in is exactly the ask.
//
// Reversible by design: nothing is deleted. Re-inviting restores the org fields,
// and a disabled account is re-enabled by the same endpoint's counterpart in the
// Firebase console. Deleting the Auth account would also free the email for a
// fresh signup, which is not a decision a "remove teammate" click should make.
//
// Body: { orgId: string, email?: string, uid?: string }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = [
  'https://app.nearwork.co',
  'https://admin.nearwork.co',
];

const CLIENT_ADMIN_ROLES = ['admin_client', 'client_admin', 'admin'];

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

type Caller = { uid: string; email: string; staff: boolean };

// CORS is a browser convention, not an access control — curl ignores it entirely.
// This endpoint can disable an account, so it verifies who is asking.
async function authenticate(req: Request, orgId: string): Promise<Caller | null> {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return null;

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    return null;
  }

  const email = String(decoded.email || '').toLowerCase();
  if (email.endsWith('@nearwork.co')) return { uid: decoded.uid, email, staff: true };

  // A client admin may remove teammates, but only inside their own organization.
  const snap = await adminDb().collection('users').doc(decoded.uid).get().catch(() => null);
  const d = (snap?.exists ? snap.data() : null) as
    { orgId?: string; organizationId?: string; orgIds?: string[]; portalRole?: string; role?: string } | null;
  if (!d) return null;

  const orgs = Array.isArray(d.orgIds) ? d.orgIds : [d.orgId || d.organizationId].filter(Boolean) as string[];
  const isAdminOfOrg = orgs.includes(orgId)
    && (CLIENT_ADMIN_ROLES.includes(String(d.portalRole || '')) || String(d.role || '') === 'client_admin');
  return isAdminOfOrg ? { uid: decoded.uid, email, staff: false } : null;
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  let body: { orgId?: string; email?: string; uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const orgId = body.orgId;
  const email = body.email?.trim().toLowerCase() || undefined;
  const uid = body.uid?.trim() || undefined;

  if (!orgId || (!email && !uid)) {
    return NextResponse.json(
      { ok: false, error: 'orgId and at least one of email/uid are required' },
      { status: 400, headers: cors },
    );
  }

  const caller = await authenticate(req, orgId);
  if (!caller) {
    return NextResponse.json({ ok: false, error: 'Not authorized to remove members from this organization' }, { status: 401, headers: cors });
  }

  try {
    const result = await revokeOrgAccess({ orgId, uid, email, byEmail: caller.email });
    return NextResponse.json({ ok: true, ...result }, { headers: cors });
  } catch (e) {
    console.error('[remove-member] failed:', e);
    return NextResponse.json({ ok: false, error: 'Failed to revoke member access' }, { status: 500, headers: cors });
  }
}
