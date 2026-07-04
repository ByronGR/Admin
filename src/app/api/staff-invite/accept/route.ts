import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

// ─── POST /api/staff-invite/accept ────────────────────────────────────────────
// Completes a staff invite: creates the Firebase Auth account and the users/{uid}
// profile, then marks the invite accepted. Runs server-side with the Admin SDK so
// the account's ROLE is set authoritatively from the super-admin-minted invite
// (never from client input) — an invitee cannot self-assign a higher role.
// Called (unauthenticated) by the /join page. Same-origin (admin.nearwork.co) only.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { token?: string; name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = body.token?.trim();
  const name = body.name?.trim();
  const password = body.password ?? '';

  if (!token) {
    return NextResponse.json({ error: 'This invite link is not valid.' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const db = adminDb();

  // 1. Re-validate the invite server-side (never trust the client's word for it).
  let inviteRef;
  let invite;
  try {
    const snap = await db
      .collection('staffInvites')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (snap.empty) {
      return NextResponse.json({ error: 'This invite link is not valid or has already been used.' }, { status: 400 });
    }
    inviteRef = snap.docs[0].ref;
    invite = snap.docs[0].data();

    const expiresMs =
      invite.expiresAt && typeof invite.expiresAt.toMillis === 'function'
        ? invite.expiresAt.toMillis()
        : null;
    if (expiresMs !== null && Date.now() > expiresMs) {
      await inviteRef.update({ status: 'expired' });
      return NextResponse.json({ error: 'This invite link has expired.' }, { status: 410 });
    }
  } catch (e) {
    console.error('[staff-invite/accept] lookup failed:', e);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  const email = String(invite.email ?? '').trim().toLowerCase();
  const role = invite.role ?? 'employee';
  if (!email) {
    return NextResponse.json({ error: 'This invite is missing an email address.' }, { status: 400 });
  }

  // 2. Create the Auth account.
  let uid: string;
  try {
    const record = await adminAuth().createUser({ email, password, displayName: name });
    uid = record.uid;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    if (code === 'auth/email-already-exists') {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please log in instead.' },
        { status: 409 },
      );
    }
    if (code === 'auth/invalid-password') {
      return NextResponse.json({ error: 'That password is not strong enough. Try a longer one.' }, { status: 400 });
    }
    console.error('[staff-invite/accept] createUser failed:', e);
    return NextResponse.json({ error: 'Could not create the account. Please try again.' }, { status: 500 });
  }

  // 3. Write the profile with the role taken from the invite (server-authoritative).
  const parts = name.split(/\s+/);
  try {
    await db.collection('users').doc(uid).set({
      email,
      name,
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      role,
      staffRole: role,
      status: 'active',
      source: 'admin.nearwork.co',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await inviteRef.update({ status: 'accepted', acceptedAt: FieldValue.serverTimestamp() });
  } catch (e) {
    // Auth account exists but the profile write failed — roll back the account so
    // the invite stays usable rather than stranding a half-created user.
    console.error('[staff-invite/accept] profile write failed, rolling back auth user:', e);
    try { await adminAuth().deleteUser(uid); } catch { /* best effort */ }
    return NextResponse.json({ error: 'Could not finish setting up the account. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
