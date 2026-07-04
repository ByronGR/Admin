import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// ─── POST /api/staff-invite/verify ────────────────────────────────────────────
// Looks up a staff invite by its token and reports whether it can still be used.
// Called (unauthenticated) by the /join page before showing the sign-up form.
// Runs server-side with the Admin SDK so invite tokens/emails are never exposed
// to the client via Firestore rules. Same-origin (admin.nearwork.co) only.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ status: 'invalid' });
  }

  try {
    const db = adminDb();
    const snap = await db
      .collection('staffInvites')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ status: 'invalid' });
    }

    const doc = snap.docs[0];
    const invite = doc.data();

    const expiresMs =
      invite.expiresAt && typeof invite.expiresAt.toMillis === 'function'
        ? invite.expiresAt.toMillis()
        : null;
    if (expiresMs !== null && Date.now() > expiresMs) {
      await doc.ref.update({ status: 'expired' });
      return NextResponse.json({ status: 'expired' });
    }

    return NextResponse.json({
      status: 'valid',
      email: invite.email ?? '',
      role: invite.role ?? 'employee',
    });
  } catch (e) {
    console.error('[staff-invite/verify] failed:', e);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
