import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue } from '@/lib/firebase-admin';

// ── /api/audit/accounts ───────────────────────────────────────────────────────
// GET  → login accounts that have no candidate record. Read-only.
// POST → create the missing records for the ids given.
//
// Someone can sign up — with Google especially — and get a login but no ATS
// record, which makes them invisible to staff: absent from the candidate list,
// the intake chart, and every match. This finds them.
//
// Who counts as a candidate is the hard part, and getting it wrong is expensive
// in both directions:
//   • Client users (a partner's team on their own domain) log into the client
//     portal. Listing them here would invite turning a customer into a candidate.
//   • Nearwork staff are not all on @nearwork.co — some sign in with personal
//     addresses, so a domain check alone misses them.
//   • An account with no users/{uid} document never finished signing up. That is
//     a normal, harmless state, not a lost candidate.
// So an account is only reported when its own profile says role: 'candidate',
// it belongs to no organization, and it has no candidate record.
//
// Presence is then judged on four keys, not just the derived document id.
// Records reach the candidates collection by more than one route (Talent
// onboarding, the job board, manual adds) and are keyed differently by each, so
// checking one key would "find" people already there under another and
// duplicate them. Duplicates are worse than the problem.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Orphan {
  uid: string;
  email: string;
  name: string;
  provider: string;
  createdAt: string;
  lastSignIn: string;
}

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

const codeForUid = (uid: string) =>
  `CAND-${uid.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase()}`;

const CLIENT_ROLES = new Set(['client', 'client_admin', 'client_user', 'viewer', 'user']);

/** Every email that belongs to a client organization's own team. */
async function clientEmails(): Promise<Set<string>> {
  const out = new Set<string>();
  const snap = await adminDb().collection('organizations').get();
  snap.docs.forEach((d) => {
    const org = d.data() as { orgUsers?: { email?: string }[]; pocContacts?: { email?: string }[] };
    [...(org.orgUsers || []), ...(org.pocContacts || [])].forEach((u) => {
      if (u?.email) out.add(String(u.email).toLowerCase().trim());
    });
  });
  return out;
}

/** Everything already in `candidates`, indexed every way a record can be keyed. */
async function buildIndex() {
  const snap = await adminDb().collection('candidates').get();
  const byId = new Set<string>();
  const byOwner = new Set<string>();
  const byEmail = new Set<string>();

  snap.docs.forEach((d) => {
    const c = d.data() as { ownerUid?: string; uid?: string; authUid?: string; email?: string };
    byId.add(d.id);
    [c.ownerUid, c.uid, c.authUid].forEach((v) => { if (v) byOwner.add(String(v)); });
    if (c.email) byEmail.add(String(c.email).toLowerCase().trim());
  });

  return { byId, byOwner, byEmail, total: snap.size };
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) {
    return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  }

  const [index, clients] = await Promise.all([buildIndex(), clientEmails()]);
  const orphans: Orphan[] = [];
  let scanned = 0;
  const skippedCounts = { noProfile: 0, client: 0, staff: 0 };
  const providerCounts: Record<string, number> = {};

  let pageToken: string | undefined;
  do {
    const page = await adminAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      scanned++;
      const email = (u.email || '').toLowerCase().trim();
      const ids = (u.providerData || []).map((p) => p.providerId);
      const provider = ids.find((i) => i !== 'password') || ids[0] || 'password';

      if (email.endsWith('@nearwork.co')) { skippedCounts.staff++; continue; }
      if (email && clients.has(email)) { skippedCounts.client++; continue; }

      // Their own profile is the authority on what kind of account this is.
      const profSnap = await adminDb().collection('users').doc(u.uid).get().catch(() => null);
      if (!profSnap?.exists) { skippedCounts.noProfile++; continue; }
      const prof = profSnap.data() as { role?: string; staffRole?: string; orgId?: string };
      const role = String(prof.role || '').toLowerCase();

      if (prof.staffRole) { skippedCounts.staff++; continue; }
      if (prof.orgId || CLIENT_ROLES.has(role)) { skippedCounts.client++; continue; }
      // Anything that doesn't explicitly say "candidate" is left alone.
      if (role !== 'candidate') { skippedCounts.noProfile++; continue; }

      const present =
        index.byId.has(codeForUid(u.uid)) ||
        index.byOwner.has(u.uid) ||
        (!!email && index.byEmail.has(email));
      if (present) continue;

      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      orphans.push({
        uid: u.uid,
        email,
        name: u.displayName || '',
        provider,
        createdAt: u.metadata?.creationTime || '',
        lastSignIn: u.metadata?.lastSignInTime || '',
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  orphans.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));

  return NextResponse.json({
    scanned,
    candidateRecords: index.total,
    orphans,
    byProvider: providerCounts,
    excluded: skippedCounts,
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: { uids?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }
  const uids = (body.uids || []).slice(0, 200);
  if (!uids.length) return NextResponse.json({ error: 'uids required' }, { status: 400 });

  // Re-check against a FRESH index rather than trusting the list the page was
  // showing. It may be minutes old, and in that time the candidate could have
  // finished onboarding and created their own record.
  const index = await buildIndex();
  const created: string[] = [];
  const skipped: { uid: string; why: string }[] = [];

  for (const uid of uids) {
    let user;
    try { user = await adminAuth().getUser(uid); } catch { skipped.push({ uid, why: 'no login account' }); continue; }

    const email = (user.email || '').toLowerCase().trim();
    const code = codeForUid(uid);

    if (index.byId.has(code) || index.byOwner.has(uid) || (!!email && index.byEmail.has(email))) {
      skipped.push({ uid, why: 'already has a candidate record' });
      continue;
    }

    // Re-apply the same identity guard here. A uid arriving in this list is not
    // permission to create a candidate from a client or a staff member.
    if (email.endsWith('@nearwork.co')) { skipped.push({ uid, why: 'Nearwork staff' }); continue; }
    const profSnap = await adminDb().collection('users').doc(uid).get().catch(() => null);
    const prof = profSnap?.exists ? profSnap.data() as { role?: string; staffRole?: string; orgId?: string } : null;
    if (!prof) { skipped.push({ uid, why: 'never finished signing up' }); continue; }
    if (prof.staffRole) { skipped.push({ uid, why: 'Nearwork staff' }); continue; }
    if (prof.orgId || CLIENT_ROLES.has(String(prof.role || '').toLowerCase())) {
      skipped.push({ uid, why: 'client user' }); continue;
    }
    if (String(prof.role || '').toLowerCase() !== 'candidate') {
      skipped.push({ uid, why: 'not a candidate account' }); continue;
    }

    const ids = (user.providerData || []).map((p) => p.providerId);
    const provider = ids.find((i) => i !== 'password') || ids[0] || 'password';
    const today = new Date().toISOString().slice(0, 10);

    await adminDb().collection('candidates').doc(code).set({
      code, id: code, candidateCode: code,
      uid, ownerUid: uid, authUid: uid,
      name: user.displayName || 'Talent member',
      email,
      role: 'Nearwork candidate',
      skills: [],
      applied: today, lastContact: today,
      experience: 0,
      location: '', city: '', department: '', country: '',
      source: 'talent.nearwork.co',
      signupProvider: provider,
      status: 'active',
      score: 50,
      phone: '', whatsapp: '', currentRole: '',
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
      onboarded: false,
      needsOnboarding: true,
      // Their real sign-up date, not today's — otherwise the intake chart would
      // show a spike on the day we repaired them.
      createdAt: user.metadata?.creationTime ? new Date(user.metadata.creationTime) : new Date(),
      updatedAt: GCFieldValue.serverTimestamp(),
      repairedBy: staff,
    }, { merge: true });

    // Keep the in-memory index current so a duplicated uid in one request
    // can't create the same record twice.
    index.byId.add(code);
    index.byOwner.add(uid);
    if (email) index.byEmail.add(email);
    created.push(code);
  }

  return NextResponse.json({ created, skipped });
}
