import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';

// ── /api/audit/access ─────────────────────────────────────────────────────────
// GET  ?email=… → why a staff member can or can't see internal data.
// POST           → repair the field that's blocking them.
//
// A staffer whose account fails the Firestore isStaff() gate can still log in
// and use the app — every internal collection simply reads back empty. Candidates
// show 0, pipelines look unstarted, nothing errors. It's indistinguishable from
// "the data isn't there", which is why it gets reported as a broken app and
// costs days.
//
// isStaff() denies when ANY of these hold, so this reports all of them rather
// than the first one found — fixing one and still being locked out is exactly
// how this turns into a week of back-and-forth:
//   • no users/{uid} document at all      → role() is '', which is in no list
//   • employmentType == 'placed'          → the trap the type comments warn about
//   • status is suspended or inactive
//   • role isn't one of the staff roles

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES = [
  'super_admin', 'admin', 'sr_recruiter', 'recruiter',
  'account_manager', 'sales', 'hr', 'employee', 'user',
];
const BREAK_GLASS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];

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

interface Gate { name: string; ok: boolean; detail: string; fix?: string }

export async function GET(req: Request) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  }

  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();

  // No email → every Nearwork account and whether it passes. A single account
  // reading "fine" proves nothing if the person is actually signing into a
  // different one — a second account from a typo or an old address looks
  // identical from their side, and only a full list shows it.
  if (!email) {
    const rows: {
      email: string; uid: string; name: string; role: string;
      employmentType: string; status: string; providers: string[]; passes: boolean; why: string;
    }[] = [];
    let pageToken: string | undefined;
    do {
      const page = await adminAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        const addr = (u.email || '').toLowerCase();
        if (!addr.endsWith('@nearwork.co')) continue;
        const snap = await adminDb().collection('users').doc(u.uid).get().catch(() => null);
        const d = (snap?.exists ? snap.data() : null) as {
          role?: string; employmentType?: string; status?: string; name?: string;
        } | null;
        const r = String(d?.role || '');
        const fails: string[] = [];
        if (!d) fails.push('no profile document');
        if (d?.employmentType === 'placed') fails.push('marked as placed');
        if (d?.status && ['suspended', 'inactive'].includes(String(d.status))) fails.push(`status ${d.status}`);
        if (!STAFF_ROLES.includes(r)) fails.push(r ? `role "${r}"` : 'no role');
        const passes = BREAK_GLASS.includes(addr) || fails.length === 0;
        rows.push({
          email: addr, uid: u.uid,
          name: d?.name || u.displayName || '',
          role: r || '—',
          employmentType: d?.employmentType || '—',
          status: d?.status || '—',
          providers: (u.providerData || []).map((p) => p.providerId),
          passes,
          why: passes ? '' : fails.join(', '),
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);
    rows.sort((a, b) => Number(a.passes) - Number(b.passes) || a.email.localeCompare(b.email));
    return NextResponse.json({ list: rows });
  }

  let user;
  try {
    user = await adminAuth().getUserByEmail(email);
  } catch {
    return NextResponse.json({
      email, found: false,
      summary: 'No login account with that email. Check the spelling, or they signed up with a different address.',
      gates: [],
    });
  }

  const snap = await adminDb().collection('users').doc(user.uid).get().catch(() => null);
  const d = (snap?.exists ? snap.data() : null) as {
    role?: string; staffRole?: string; employmentType?: string; status?: string; orgId?: string; name?: string;
  } | null;

  const role = String(d?.role || '');
  const gates: Gate[] = [
    {
      name: 'Has a profile document',
      ok: !!d,
      detail: d ? `users/${user.uid}` : 'No users document — every rule that reads their role sees an empty value',
      fix: d ? undefined : 'createProfile',
    },
    {
      name: 'Not marked as placed',
      ok: d?.employmentType !== 'placed',
      detail: d?.employmentType
        ? `employmentType: "${d.employmentType}"`
        : 'employmentType not set (treated as internal)',
      fix: d?.employmentType === 'placed' ? 'setInternal' : undefined,
    },
    {
      name: 'Not suspended or inactive',
      ok: !d?.status || !['suspended', 'inactive'].includes(String(d.status)),
      detail: d?.status ? `status: "${d.status}"` : 'status not set',
      fix: d?.status && ['suspended', 'inactive'].includes(String(d.status)) ? 'setActive' : undefined,
    },
    {
      name: 'Has a staff role',
      ok: STAFF_ROLES.includes(role),
      detail: role ? `role: "${role}"` : 'role not set',
      fix: STAFF_ROLES.includes(role) ? undefined : 'setRole',
    },
  ];

  const breakGlass = BREAK_GLASS.includes(email);
  const passes = breakGlass || gates.every((g) => g.ok);
  const failing = gates.filter((g) => !g.ok);

  return NextResponse.json({
    email,
    found: true,
    uid: user.uid,
    name: d?.name || user.displayName || '',
    providers: (user.providerData || []).map((p) => p.providerId),
    breakGlass,
    passes,
    gates,
    summary: passes
      ? (breakGlass
        ? 'Passes — this address is a hardcoded owner and can never be locked out.'
        : 'Passes every check. If they still see nothing, it is not permissions.')
      : `Blocked by ${failing.length} check${failing.length === 1 ? '' : 's'}: ${failing.map((g) => g.name).join(', ')}. `
        + 'Everything internal reads back empty, which looks exactly like missing data.',
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: { email?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  // Only ever repairs a Nearwork address. Granting staff access to an outside
  // account would be the most damaging thing this endpoint could do, so it is
  // simply not possible here.
  if (!email.endsWith('@nearwork.co')) {
    return NextResponse.json({ error: 'Only @nearwork.co accounts can be granted staff access.' }, { status: 400 });
  }

  let user;
  try { user = await adminAuth().getUserByEmail(email); }
  catch { return NextResponse.json({ error: 'No login account with that email' }, { status: 404 }); }

  const ref = adminDb().collection('users').doc(user.uid);
  const snap = await ref.get();
  const d = (snap.exists ? snap.data() : {}) as { role?: string; name?: string };

  const role = STAFF_ROLES.includes(String(body.role || '')) ? body.role : (
    STAFF_ROLES.includes(String(d.role || '')) ? d.role : 'recruiter'
  );

  await ref.set({
    name: d.name || user.displayName || email.split('@')[0],
    email,
    role,
    staffRole: role,
    // The three fields the gate actually reads.
    employmentType: 'internal',
    status: 'active',
    updatedAt: GCFieldValue.serverTimestamp(),
    ...(snap.exists ? {} : { createdAt: GCFieldValue.serverTimestamp() }),
    accessFixedBy: staff,
  }, { merge: true });

  return NextResponse.json({ ok: true, uid: user.uid, role, created: !snap.exists });
}
