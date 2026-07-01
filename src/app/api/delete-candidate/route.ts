import { NextResponse } from 'next/server';
import type { DocumentReference } from '@google-cloud/firestore';
import { adminAuth, adminDb } from '@/lib/firebase-admin';

// POST /api/delete-candidate
// Fully removes a candidate when a Nearwork staff member deletes them from the
// Admin ATS: their Firebase Auth account, users/{uid} + candidates/{code|id}
// profile docs, and every linked applications / assessments / activity /
// notifications / notes / notificationPreferences doc, plus their entry in any
// pipeline's candidates[] array. This lets the person sign up again later.
//
// Business records (placements / hired profiles / payroll / performance /
// time-off) are intentionally KEPT — same policy as the Talent self-delete.
//
// Admin-created candidates have no Auth account, so the Auth user is resolved by
// email (best-effort). Requires the Vercel OIDC -> GCP WIF credential.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://admin.nearwork.co'];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// GET /api/delete-candidate → read-only audit.
// Cross-checks every Firebase Auth user against candidate records and returns
// the "orphans": non-staff, non-client accounts that have a login but NO
// candidate profile — i.e. leftovers from the old delete (which never removed
// the Auth account) or abandoned sign-ups. Deletes nothing.
export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));
  const staff = await requireStaff(req);
  if (!staff) return NextResponse.json({ ok: false, error: 'Staff only' }, { status: 401, headers: cors });

  try {
    const db = adminDb();
    const [candSnap, usersSnap] = await Promise.all([
      db.collection('candidates').get(),
      db.collection('users').get(),
    ]);

    const candById = new Set<string>();
    const candByEmail = new Set<string>();
    const candByCode = new Set<string>();
    candSnap.docs.forEach((d) => {
      candById.add(d.id);
      const data = d.data() as Record<string, unknown>;
      const em = String(data.email || '').toLowerCase();
      if (em) candByEmail.add(em);
      const code = String(data.code || '');
      if (code) candByCode.add(code);
    });

    const usersById = new Map<string, Record<string, unknown>>();
    usersSnap.docs.forEach((d) => usersById.set(d.id, d.data() as Record<string, unknown>));

    const orphans: Array<{
      uid: string; email: string; name: string;
      createdAt: string | null; lastSignIn: string | null; hasUsersDoc: boolean;
    }> = [];
    let scanned = 0;
    let pageToken: string | undefined;
    do {
      const page = await adminAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        scanned++;
        const email = (u.email || '').toLowerCase();
        if (email.endsWith('@nearwork.co')) continue;            // staff — never touch
        const udoc = usersById.get(u.uid);
        if (udoc && (udoc.orgId || udoc.organizationId)) continue; // client / partner — skip
        const code = udoc ? String(udoc.candidateCode || '') : '';
        const hasCandidate = candById.has(u.uid) || (!!email && candByEmail.has(email)) || (!!code && candByCode.has(code));
        if (hasCandidate) continue;                               // active candidate — skip
        orphans.push({
          uid: u.uid,
          email: u.email || '(no email)',
          name: u.displayName || (udoc ? String(udoc.name || '') : '') || '',
          createdAt: u.metadata?.creationTime || null,
          lastSignIn: u.metadata?.lastSignInTime || null,
          hasUsersDoc: !!udoc,
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);

    orphans.sort((a, b) => a.email.localeCompare(b.email));
    return NextResponse.json({ ok: true, scanned, orphans }, { headers: cors });
  } catch (e) {
    console.error('[delete-candidate audit] failed:', e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message || 'Scan failed' }, { status: 500, headers: cors });
  }
}

type Db = ReturnType<typeof adminDb>;

// Collect every doc where `field` equals any of `values` into `refs` (de-duped).
async function collect(
  db: Db,
  coll: string,
  field: string,
  values: string[],
  seen: Set<string>,
  refs: DocumentReference[],
) {
  for (const value of values) {
    if (!value) continue;
    const snap = await db.collection(coll).where(field, '==', value).get();
    snap.docs.forEach((d) => {
      if (!seen.has(d.ref.path)) {
        seen.add(d.ref.path);
        refs.push(d.ref);
      }
    });
  }
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  // ── Auth: only signed-in Nearwork staff may purge a candidate ──
  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Only Nearwork staff can delete candidates' }, { status: 401, headers: cors });
  }

  const body = (await req.json().catch(() => ({}))) as { candidateId?: string; code?: string; email?: string; uid?: string };
  const docId = String(body.candidateId || body.code || '').trim();
  const code = String(body.code || body.candidateId || '').trim();
  const bodyUid = String(body.uid || '').trim();
  let email = String(body.email || '').trim().toLowerCase();
  if (!docId && !email && !bodyUid) {
    return NextResponse.json({ ok: false, error: 'candidateId, uid or email is required' }, { status: 400, headers: cors });
  }

  try {
    const db = adminDb();

    // Read the candidate doc for any stored uid + email we weren't given.
    let storedUid = '';
    if (docId) {
      const cs = await db.collection('candidates').doc(docId).get();
      if (cs.exists) {
        const cd = (cs.data() || {}) as Record<string, unknown>;
        email = email || String(cd.email || '').toLowerCase();
        storedUid = String(cd.ownerUid || cd.authUid || cd.uid || '');
      }
    }

    // Resolve the Firebase Auth user. Admin-created candidates have none;
    // orphan-cleanup passes the uid directly.
    let uid = bodyUid || storedUid;
    if (!uid && email) {
      try { uid = (await adminAuth().getUserByEmail(email)).uid; } catch { /* no auth account for this email */ }
    }

    const ids = [docId, code, uid].filter(Boolean) as string[];
    const seen = new Set<string>();
    const refs: DocumentReference[] = [];

    // ── Gather every linked doc across candidate-owned collections ──
    await collect(db, 'applications', 'candidateId', ids, seen, refs);
    if (uid) await collect(db, 'applications', 'ownerUid', [uid], seen, refs);
    if (email) await collect(db, 'applications', 'candidateEmail', [email], seen, refs);

    await collect(db, 'assessments', 'candidateId', ids, seen, refs);
    if (code) await collect(db, 'assessments', 'candidateCode', [code], seen, refs);
    if (uid) await collect(db, 'assessments', 'candidateUid', [uid], seen, refs);
    if (email) await collect(db, 'assessments', 'candidateEmail', [email], seen, refs);

    await collect(db, 'candidateActivity', 'candidateId', ids, seen, refs);
    await collect(db, 'candidateNotes', 'candidateId', ids, seen, refs);

    if (uid) await collect(db, 'notifications', 'recipientUid', [uid], seen, refs);
    if (email) await collect(db, 'notifications', 'recipientEmail', [email], seen, refs);

    if (uid) {
      const prefRef = db.collection('notificationPreferences').doc(uid);
      if ((await prefRef.get()).exists && !seen.has(prefRef.path)) {
        seen.add(prefRef.path);
        refs.push(prefRef);
      }
    }

    // ── Strip this candidate out of any pipeline's candidates[] array ──
    const pipelinesSnap = await db.collection('pipelines').get();
    const pipelineUpdates: Promise<unknown>[] = [];
    pipelinesSnap.docs.forEach((d) => {
      const data = d.data() as { candidates?: Array<{ candidateId?: string; candidateCode?: string }> };
      const cands = Array.isArray(data.candidates) ? data.candidates : [];
      const filtered = cands.filter(
        (c) => !ids.includes(c?.candidateId ?? '') && !ids.includes(c?.candidateCode ?? ''),
      );
      if (filtered.length !== cands.length) pipelineUpdates.push(d.ref.update({ candidates: filtered }));
    });
    await Promise.all(pipelineUpdates);

    // ── Profile docs (deleted last among Firestore writes) ──
    if (docId) refs.push(db.collection('candidates').doc(docId));
    if (code && code !== docId) refs.push(db.collection('candidates').doc(code));
    if (uid) refs.push(db.collection('users').doc(uid));

    // De-dup and commit deletes in batches (Firestore caps a batch at 500).
    const finalRefs: DocumentReference[] = [];
    const paths = new Set<string>();
    for (const r of refs) {
      if (!paths.has(r.path)) { paths.add(r.path); finalRefs.push(r); }
    }
    for (let i = 0; i < finalRefs.length; i += 450) {
      const batch = db.batch();
      finalRefs.slice(i, i + 450).forEach((r) => batch.delete(r));
      await batch.commit();
    }

    // ── Auth user last, so a partial failure above stays retryable ──
    let authDeleted = false;
    if (uid) {
      try { await adminAuth().deleteUser(uid); authDeleted = true; } catch { /* already gone */ }
    }

    return NextResponse.json(
      { ok: true, authDeleted, uid: uid || null, docsDeleted: finalRefs.length },
      { headers: cors },
    );
  } catch (e) {
    console.error('[delete-candidate] failed:', e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message || 'Failed to delete candidate' }, { status: 500, headers: cors });
  }
}
