import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { revokeOrgAccess } from '@/lib/revoke-org-access';

// ── /api/audit/orphaned-access ───────────────────────────────────────────────
// Client access lives on the user document; the organization's member list is
// only what staff see. Removing someone used to edit the list alone, so anyone
// removed that way kept working: still reading the portal, still able to sign
// out and back in, and no longer visible in Admin to remove again.
//
// This finds them — accounts whose user document still grants access to an
// organization that no longer lists them — and revokes them properly.
//
// GET  → who currently has access they should not
// POST → revoke, either all of them or one { uid, orgId }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function requireStaff(req: Request): Promise<string | null> {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = String(decoded.email || '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

type Orphan = {
  uid: string; email: string; name: string;
  orgId: string; orgName: string;
  disabled: boolean; lastSignIn: string;
};

async function findOrphans(): Promise<Orphan[]> {
  const db = adminDb();
  const orgsSnap = await db.collection('organizations').get();

  const orgName = new Map<string, string>();
  const listed = new Map<string, Set<string>>();   // orgId → emails still on the list
  const listedUids = new Map<string, Set<string>>();
  for (const o of orgsSnap.docs) {
    const d = o.data() || {};
    orgName.set(o.id, String(d.name || o.id));
    const emails = new Set<string>();
    const uids = new Set<string>();
    for (const u of (Array.isArray(d.orgUsers) ? d.orgUsers : [])) {
      if (typeof u?.email === 'string') emails.add(u.email.trim().toLowerCase());
      if (typeof u?.uid === 'string' && u.uid) uids.add(u.uid);
    }
    listed.set(o.id, emails);
    listedUids.set(o.id, uids);
  }

  const usersSnap = await db.collection('users').get();
  const out: Orphan[] = [];

  for (const doc of usersSnap.docs) {
    const d = doc.data() || {};
    const orgs: string[] = Array.isArray(d.orgIds)
      ? d.orgIds.filter(Boolean)
      : [d.orgId || d.organizationId].filter(Boolean);
    if (!orgs.length) continue;

    // Staff aren't client members and are never listed in orgUsers — treating
    // them as orphans would propose disabling the whole Nearwork team.
    const email = String(d.email || '').toLowerCase();
    if (email.endsWith('@nearwork.co')) continue;

    for (const orgId of orgs) {
      // An org that no longer exists is a dangling reference, not a membership.
      const emails = listed.get(orgId);
      const uids = listedUids.get(orgId);
      const stillListed = (emails?.has(email) ?? false) || (uids?.has(doc.id) ?? false);
      if (stillListed) continue;

      let disabled = false;
      let lastSignIn = '';
      try {
        const u = await adminAuth().getUser(doc.id);
        disabled = !!u.disabled;
        lastSignIn = u.metadata.lastSignInTime || '';
      } catch {
        // No login account — the stale document can't be used to sign in, so it
        // isn't the exposure this is looking for.
        continue;
      }

      out.push({
        uid: doc.id,
        email: email || '(no email)',
        name: String(d.name || d.displayName || ''),
        orgId,
        orgName: orgName.get(orgId) || `${orgId} (deleted)`,
        disabled,
        lastSignIn,
      });
    }
  }

  // Accounts that can still sign in first — those are the live exposure.
  out.sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.email.localeCompare(b.email));
  return out;
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  const orphans = await findOrphans();
  return NextResponse.json({ orphans, active: orphans.filter((o) => !o.disabled).length });
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: { uid?: string; orgId?: string } = {};
  try { body = await req.json(); } catch { /* no body → revoke everything found */ }

  const targets = body.uid && body.orgId
    ? [{ uid: body.uid, orgId: body.orgId, email: '' }]
    : (await findOrphans()).filter((o) => !o.disabled);

  const results: { uid: string; orgId: string; disabled: boolean; reason?: string }[] = [];
  for (const t of targets) {
    try {
      const r = await revokeOrgAccess({ orgId: t.orgId, uid: t.uid, byEmail: staff });
      results.push({ uid: t.uid, orgId: t.orgId, disabled: r.disabled, reason: r.reason });
    } catch (e) {
      console.error('[orphaned-access] revoke failed', t.uid, e);
      results.push({ uid: t.uid, orgId: t.orgId, disabled: false, reason: 'failed' });
    }
  }

  return NextResponse.json({ revoked: results.length, results });
}
