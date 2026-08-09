import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// ── /api/candidate-provider?email=…&uid=… ─────────────────────────────────────
// How a candidate actually signed up: Google, LinkedIn, or email + password.
//
// This can't be read from the candidate record. `source` is constrained by the
// Firestore rules to 'talent.nearwork.co' | 'jobs.nearwork.co', so it says which
// app created them, not how they got in. The sign-in method lives in Firebase
// Auth, which the browser can't query for another user — hence this route.
//
// LinkedIn is the exception and the reason the stored value wins: those accounts
// are created with a generated password, so Firebase reports them as 'password',
// indistinguishable from an email signup. The signup flow records the truth.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LABELS: Record<string, string> = {
  'google.com': 'Google',
  'password': 'Email & password',
  'linkedin': 'LinkedIn',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  'facebook.com': 'Facebook',
};

export async function GET(req: Request) {
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (!String(decoded.email || '').toLowerCase().endsWith('@nearwork.co')) {
      return NextResponse.json({ error: 'Staff only' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();
  const uid = (url.searchParams.get('uid') || '').trim();
  if (!email && !uid) {
    return NextResponse.json({ error: 'email or uid required' }, { status: 400 });
  }

  try {
    // A recorded provider is authoritative — see the LinkedIn note above.
    if (uid) {
      const snap = await adminDb().collection('users').doc(uid).get().catch(() => null);
      const stored = snap?.exists ? (snap.data() as { signupProvider?: string }).signupProvider : '';
      if (stored) {
        return NextResponse.json({ provider: stored, label: LABELS[stored] || stored, from: 'record' });
      }
    }

    const user = uid
      ? await adminAuth().getUser(uid)
      : await adminAuth().getUserByEmail(email);

    const ids = (user.providerData || []).map((p) => p.providerId).filter(Boolean);
    // Someone can have several. Show the federated one — "Google" is more
    // useful than "password" when they have both.
    const primary = ids.find((i) => i !== 'password') || ids[0] || '';

    return NextResponse.json({
      provider: primary,
      label: primary ? (LABELS[primary] || primary) : '',
      all: ids,
      from: 'auth',
    });
  } catch (e) {
    // No auth account is a real, meaningful answer: this candidate was added by
    // staff or sourced, and never signed up at all.
    const code = (e as { code?: string })?.code || '';
    if (code === 'auth/user-not-found') {
      return NextResponse.json({ provider: '', label: 'No login account', from: 'none' });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
