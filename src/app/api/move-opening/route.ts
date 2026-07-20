// ─── POST /api/move-opening ───────────────────────────────────────────────────
// Reassign an opening to a different organization. Runs server-side (Admin SDK)
// because the client SDK can't write kickoffBriefs (allow write: if false) — and
// the brief's orgId MUST change too, or the new client is locked out of it.
//
// Only the ownership fields change (orgId + orgName) on the opening, its pipeline
// and its kick-off brief. Document ids are untouched, so the jobs.nearwork.co
// link and the opening ID stay identical.
//
// Auth: Bearer ID token; caller must be Nearwork admin (super_admin / admin /
// recruiter, or an owner email) — mirroring the Firestore isAdmin() rule.

import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

const OWNER_EMAILS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];
const ADMIN_ROLES = ['super_admin', 'admin', 'sr_recruiter', 'recruiter'];

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data: unknown, status: number, origin: string | null) {
  return NextResponse.json(data, { status, headers: corsHeaders(origin) });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!token) return json({ ok: false, error: 'Missing auth token' }, 401, origin);

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    return json({ ok: false, error: 'Invalid auth token' }, 401, origin);
  }
  const email = (decoded.email ?? '').toLowerCase();
  if (!email.endsWith('@nearwork.co')) {
    return json({ ok: false, error: 'Nearwork staff only' }, 403, origin);
  }

  const db = adminDb();

  // Confirm admin: owner email, or an admin-tier role on the user doc.
  let isAdmin = OWNER_EMAILS.includes(email);
  if (!isAdmin) {
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const role = String(userSnap.data()?.role ?? '');
    isAdmin = ADMIN_ROLES.includes(role);
  }
  if (!isAdmin) return json({ ok: false, error: 'Admin access required to move an opening' }, 403, origin);

  let body: { openingId?: string; code?: string; orgId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400, origin);
  }
  const openingId = String(body.openingId ?? body.code ?? '').trim();
  const code = String(body.code ?? body.openingId ?? '').trim();
  const orgId = String(body.orgId ?? '').trim();
  if (!openingId || !orgId) return json({ ok: false, error: 'Missing opening or organization' }, 400, origin);

  // Resolve the target org's display name.
  const orgSnap = await db.collection('organizations').doc(orgId).get();
  if (!orgSnap.exists) return json({ ok: false, error: 'Organization not found' }, 404, origin);
  const orgName = String(orgSnap.data()?.name ?? '');

  const openingRef = db.collection('openings').doc(openingId);
  const openingDoc = await openingRef.get();
  if (!openingDoc.exists) return json({ ok: false, error: 'Opening not found' }, 404, origin);

  const stamp = { orgId, orgName, updatedAt: FieldValue.serverTimestamp() };

  // Update opening + (if present) its pipeline and brief in one atomic batch.
  const batch = db.batch();
  batch.set(openingRef, stamp, { merge: true });
  const [pipeDoc, briefDoc] = await Promise.all([
    db.collection('pipelines').doc(code).get(),
    db.collection('kickoffBriefs').doc(code).get(),
  ]);
  if (pipeDoc.exists) batch.set(db.collection('pipelines').doc(code), stamp, { merge: true });
  if (briefDoc.exists) batch.set(db.collection('kickoffBriefs').doc(code), stamp, { merge: true });
  await batch.commit();

  return json({
    ok: true,
    orgId,
    orgName,
    updated: { opening: true, pipeline: pipeDoc.exists, brief: briefDoc.exists },
  }, 200, origin);
}
