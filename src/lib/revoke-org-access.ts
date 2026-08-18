import { adminAuth, adminDb } from './firebase-admin';

// ── Revoking a client's access to a workspace ────────────────────────────────
// The Firestore rules decide who is a client by reading users/{uid}.orgId /
// .orgIds and nothing else. The organization's `orgUsers` array and the
// `orgMembers` collection are bookkeeping for the staff UI — no rule consults
// either — so editing those alone removes someone from the screen while leaving
// every door open behind them.
//
// Shared by the remove-member endpoint and the orphaned-access sweep, so the
// two can never drift into revoking different amounts.

export type RevokeResult = {
  revoked: boolean;
  disabled: boolean;
  reason?: string;
};

export async function revokeOrgAccess(opts: {
  orgId: string;
  uid?: string;
  email?: string;
  byEmail: string;
}): Promise<RevokeResult> {
  const db = adminDb();
  const orgId = opts.orgId;
  let uid = opts.uid;
  const email = opts.email?.trim().toLowerCase();

  // 1) The staff-facing lists.
  const orgRef = db.collection('organizations').doc(orgId);
  const orgSnap = await orgRef.get();
  if (orgSnap.exists) {
    const orgUsers = Array.isArray(orgSnap.data()?.orgUsers) ? orgSnap.data()!.orgUsers : [];
    const filtered = orgUsers.filter((u: { uid?: string; email?: string }) => {
      const byUid = uid && u?.uid === uid;
      const byEmail = email && typeof u?.email === 'string' && u.email.trim().toLowerCase() === email;
      if ((byUid || byEmail) && !uid && u?.uid) uid = u.uid;
      return !(byUid || byEmail);
    });
    if (filtered.length !== orgUsers.length) await orgRef.update({ orgUsers: filtered });
  }

  try {
    const byOrg = await db.collection('orgMembers').where('orgId', '==', orgId).get();
    const removedAt = new Date().toISOString();
    await Promise.all(byOrg.docs
      .filter((d) => {
        const m = d.data() || {};
        if (!uid && m.uid && email && String(m.email || '').toLowerCase() === email) uid = m.uid;
        return (uid && m.uid === uid) || (email && String(m.email || '').trim().toLowerCase() === email);
      })
      .map((d) => d.ref.update({ status: 'removed', removedAt })));
  } catch {
    // The collection may not exist. Not a reason to leave access in place.
  }

  // Resolve the login account. Without it, tidying lists is genuinely all there
  // is to do — which is exactly the half-measure this function exists to avoid
  // being mistaken for.
  let authUser;
  try {
    authUser = uid ? await adminAuth().getUser(uid) : await adminAuth().getUserByEmail(email!);
    uid = authUser.uid;
  } catch {
    return { revoked: false, disabled: false, reason: 'no login account' };
  }

  const targetEmail = String(authUser.email || email || '').toLowerCase();

  // 2) The user document — the only thing the rules actually enforce.
  const userRef = db.collection('users').doc(uid!);
  const userSnap = await userRef.get();
  const u = (userSnap.exists ? userSnap.data() : null) as
    { orgId?: string; organizationId?: string; orgIds?: string[] } | null;

  let remainingOrgs: string[] = [];
  if (u) {
    const current = Array.isArray(u.orgIds)
      ? u.orgIds
      : ([u.orgId || u.organizationId].filter(Boolean) as string[]);
    remainingOrgs = current.filter((o) => o !== orgId);

    const patch: Record<string, unknown> = {
      orgIds: remainingOrgs,
      removedFromOrgAt: new Date().toISOString(),
      removedFromOrgBy: opts.byEmail,
    };
    // Both spellings exist in the data and the rules fall back from one to the
    // other, so clearing only one would leave the door open.
    if (remainingOrgs.length) {
      patch.orgId = remainingOrgs[0];
      patch.organizationId = remainingOrgs[0];
    } else {
      patch.orgId = null;
      patch.organizationId = null;
      patch.portalRole = '';
      patch.status = 'removed';
    }
    await userRef.set(patch, { merge: true });
  }

  if (remainingOrgs.length) {
    return { revoked: true, disabled: false, reason: 'member of another organization' };
  }

  // 3) End the session they are in right now, or they keep working until their
  // token happens to refresh.
  await adminAuth().revokeRefreshTokens(uid!);

  // 4) Stop them signing back in — but only where the account has no other
  // reason to exist. Disabling a staffer or a candidate would lock them out of
  // a product they are entitled to use.
  const isStaff = targetEmail.endsWith('@nearwork.co');
  let isCandidate = false;
  if (!isStaff && targetEmail) {
    const cand = await db.collection('candidates').where('email', '==', targetEmail).limit(1).get().catch(() => null);
    isCandidate = !!cand && !cand.empty;
  }
  if (isStaff || isCandidate) {
    return { revoked: true, disabled: false, reason: isStaff ? 'Nearwork staff account' : 'also a candidate account' };
  }

  await adminAuth().updateUser(uid!, { disabled: true });
  return { revoked: true, disabled: true };
}
