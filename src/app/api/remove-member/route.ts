import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// POST /api/remove-member
// Revokes a client teammate's access to a company workspace. This is a
// REVERSIBLE access revoke, not an account deletion: we remove the person from
// the organization's `orgUsers` array (and mark any `orgMembers` doc as
// 'removed'), but we deliberately leave their Firebase Auth account and
// users/{uid} profile doc intact so access can be restored later.
//
// Body: { orgId: string, email?: string, uid?: string } — at least one of
// email / uid must be present. Mirrors send-invite's conventions: nodejs
// runtime, force-dynamic, CORS-limited (no staff-token check).

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

  let body: { orgId?: string; email?: string; uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: cors });
  }

  const { orgId } = body;
  const email = body.email?.trim().toLowerCase() || undefined;
  const uid = body.uid?.trim() || undefined;

  if (!orgId || (!email && !uid)) {
    return NextResponse.json(
      { ok: false, error: 'orgId and at least one of email/uid are required' },
      { status: 400, headers: cors },
    );
  }

  try {
    const db = adminDb();

    // 1) Remove the person from organizations/{orgId}.orgUsers. Match by uid
    // (if given) OR by email (case-insensitive, if given). Missing doc or
    // missing array is treated as success — nothing to remove.
    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await orgRef.get();
    if (orgSnap.exists) {
      const data = orgSnap.data() || {};
      const orgUsers = Array.isArray(data.orgUsers) ? data.orgUsers : [];
      if (orgUsers.length > 0) {
        const filtered = orgUsers.filter((u: { uid?: string; email?: string }) => {
          const matchesUid = uid && u?.uid === uid;
          const matchesEmail = email && typeof u?.email === 'string' && u.email.trim().toLowerCase() === email;
          // keep the entry only if it does NOT match the target
          return !(matchesUid || matchesEmail);
        });
        if (filtered.length !== orgUsers.length) {
          await orgRef.update({ orgUsers: filtered });
        }
      }
    }

    // 2) If a separate `orgMembers` collection exists, soft-revoke matching
    // docs (status: 'removed' + removedAt) rather than hard-deleting, so the
    // revoke stays reversible. Query by orgId, then by uid and/or email
    // (case-insensitive on email). Firestore has no case-insensitive query, so
    // we filter emails in-memory after the orgId scope.
    try {
      const membersCol = db.collection('orgMembers');
      const byOrg = await membersCol.where('orgId', '==', orgId).get();
      if (!byOrg.empty) {
        const removedAt = new Date().toISOString();
        const updates = byOrg.docs
          .filter((d) => {
            const m = d.data() || {};
            const matchesUid = uid && m.uid === uid;
            const matchesEmail =
              email && typeof m.email === 'string' && m.email.trim().toLowerCase() === email;
            return matchesUid || matchesEmail;
          })
          .map((d) => d.ref.update({ status: 'removed', removedAt }));
        await Promise.all(updates);
      }
    } catch (e) {
      // The collection may not exist / be empty — that's fine, skip silently.
      console.warn('[remove-member] orgMembers soft-revoke skipped:', e);
    }

    // NOTE: intentionally NOT deleting the Firebase Auth account or the
    // users/{uid} doc — this is a reversible access revoke.

    return NextResponse.json({ ok: true }, { headers: cors });
  } catch (e) {
    console.error('[remove-member] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Failed to revoke member access' },
      { status: 500, headers: cors },
    );
  }
}
