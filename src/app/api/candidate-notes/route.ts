import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// GET /api/candidate-notes?candidateId=<id>&candidateCode=<code>
//
// Privileged staff read of the shared `candidateNotes` collection (Admin + the
// client portal write into the same collection). Uses the Admin SDK so it
// bypasses Firestore rules — this returns the full staff view without the risk
// of a rules-rejected query, and lets us HIDE the client's team-only notes.
//
// Staff see:
//   • their own notes (side:"nearwork", scope staff_internal or client_visible)
//   • the client's shared notes (side:"client", scope client_visible)
// Staff MUST NOT see the client's team-only notes (scope client_internal) — those
// are filtered out here so they never leave the server.
//
// Notes written from the App may carry only `candidateCode` (no candidateId), so
// when a code is supplied we run a second query and merge/dedupe by doc id.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://admin.nearwork.co'];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

// Verify the caller is a signed-in Nearwork staff member. Returns their email or null.
async function requireStaff(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    return email.endsWith('@nearwork.co') ? email : null;
  } catch {
    return null;
  }
}

function tsSeconds(v: unknown): number {
  if (v && typeof v === 'object' && 'seconds' in (v as Record<string, unknown>)) {
    return Number((v as { seconds?: number }).seconds ?? 0);
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? 0 : Math.floor(t / 1000);
  }
  if (typeof v === 'number') return v;
  return 0;
}

export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ error: 'Staff only' }, { status: 401, headers: cors });
  }

  const { searchParams } = new URL(req.url);
  const candidateId = (searchParams.get('candidateId') || '').trim();
  const candidateCode = (searchParams.get('candidateCode') || '').trim();
  if (!candidateId && !candidateCode) {
    return NextResponse.json({ error: 'candidateId or candidateCode is required' }, { status: 400, headers: cors });
  }

  try {
    const db = adminDb();
    const col = db.collection('candidateNotes');

    const queries = [];
    if (candidateId) queries.push(col.where('candidateId', '==', candidateId).get());
    if (candidateCode) queries.push(col.where('candidateCode', '==', candidateCode).get());
    const snaps = await Promise.all(queries);

    const byId = new Map<string, Record<string, unknown>>();
    snaps.forEach((snap) =>
      snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...(d.data() as Record<string, unknown>) })),
    );

    const notes = Array.from(byId.values())
      // Hide the client's team-only notes from staff.
      .filter((n) => {
        const s = String(n.scope ?? n.visibility ?? '');
        return s !== 'client_internal';
      })
      .map((n) => ({
        id: String(n.id),
        body: (n.body as string) ?? (n.text as string) ?? '',
        text: (n.text as string) ?? (n.body as string) ?? '',
        scope: (n.scope as string) ?? (n.visibility as string) ?? 'staff_internal',
        side: (n.side as string) ?? 'nearwork',
        authorName: (n.authorName as string) ?? '',
        author: (n.author as string) ?? '',
        createdAt: n.createdAt ?? null,
      }))
      .sort((a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt));

    return NextResponse.json({ notes }, { headers: cors });
  } catch (e) {
    console.error('[candidate-notes] failed:', e);
    return NextResponse.json(
      { error: (e as Error)?.message || 'Failed to load notes' },
      { status: 500, headers: cors },
    );
  }
}
