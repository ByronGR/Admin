import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// ── /api/audit/display-names ─────────────────────────────────────────────────
// Who is being shown to their own team as an email address.
//
// The portal falls back to the email whenever a profile has no name, and until
// recently that fallback was the raw address — in the greeting, in the sidebar,
// and written permanently into the author line of every note and request they
// posted. The code no longer does that, but the accounts with no name are still
// out there and the records they already wrote still say what they said.
//
// GET  → client accounts with no usable name, and records already stamped with
//        an email address
// POST → set a name on one account { uid, name }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CLIENT_ROLES = ['client', 'client_admin', 'client_user', 'viewer', 'user'];
const AUTHORED = [
  { coll: 'candidateNotes', field: 'author' },
  { coll: 'openingChats', field: 'author' },
  { coll: 'pipeline_messages', field: 'author' },
  { coll: 'pipelineRequests', field: 'by' },
];

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

/** The same rule the portal uses, so this page agrees with what people see. */
function usableName(d: { name?: string; firstName?: string; lastName?: string }): string {
  const n = (d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || '').trim();
  // A "name" that is an address is not a name — some records store the email in
  // the name field, which is exactly how the address reached the greeting.
  return n && !n.includes('@') ? n : '';
}

/** What the portal will show today, given no name: the email's local part. */
function guessFrom(email: string): string {
  const local = String(email || '').split('@')[0];
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => (/\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export async function GET(req: Request) {
  if (!(await requireStaff(req))) return NextResponse.json({ error: 'Staff only' }, { status: 401 });
  const db = adminDb();

  const usersSnap = await db.collection('users').get();
  const people: {
    uid: string; email: string; role: string; orgName: string;
    showsAs: string; guess: string; posts: number;
  }[] = [];

  for (const doc of usersSnap.docs) {
    const d = doc.data() as { role?: string; portalRole?: string; email?: string; orgName?: string; name?: string; firstName?: string; lastName?: string };
    const isClient = CLIENT_ROLES.includes(String(d.role || '')) || CLIENT_ROLES.includes(String(d.portalRole || ''));
    if (!isClient) continue;
    if (usableName(d)) continue;
    const email = String(d.email || '').toLowerCase();
    people.push({
      uid: doc.id, email,
      role: d.role || d.portalRole || '—',
      orgName: d.orgName || '—',
      // Before the fix this was the raw address; now it is the guess. Showing
      // both is the point: it says what changed and what is still a guess.
      showsAs: guessFrom(email) || email || '(no email)',
      guess: guessFrom(email),
      posts: 0,
    });
  }

  // Records already written with an email address in the author line. These are
  // history — nothing rewrites them — but staff should know they exist.
  const byEmail = new Map<string, number>();
  let stamped = 0;
  for (const { coll, field } of AUTHORED) {
    const snap = await db.collection(coll).get().catch(() => null);
    if (!snap) continue;
    for (const doc of snap.docs) {
      const author = String((doc.data() as Record<string, unknown>)[field] || '');
      if (!author.includes('@')) continue;
      stamped++;
      byEmail.set(author.toLowerCase(), (byEmail.get(author.toLowerCase()) || 0) + 1);
    }
  }
  for (const p of people) p.posts = byEmail.get(p.email) || 0;
  people.sort((a, b) => b.posts - a.posts || a.email.localeCompare(b.email));

  return NextResponse.json({
    people,
    stamped,
    stampedBy: [...byEmail.entries()].map(([email, count]) => ({ email, count })).sort((a, b) => b.count - a.count),
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ error: 'Staff only' }, { status: 401 });

  let body: { uid?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Expected JSON' }, { status: 400 }); }
  const uid = (body.uid || '').trim();
  const name = (body.name || '').trim().replace(/\s+/g, ' ');
  if (!uid || !name) return NextResponse.json({ error: 'uid and name are required' }, { status: 400 });
  if (name.includes('@')) return NextResponse.json({ error: 'That is an email address, not a name.' }, { status: 400 });

  const parts = name.split(' ');
  await adminDb().collection('users').doc(uid).set({
    name,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    nameSetBy: staff,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return NextResponse.json({ ok: true, name });
}
