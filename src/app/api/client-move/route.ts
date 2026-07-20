// ─── POST /api/client-move ────────────────────────────────────────────────────
// The client (partner) moving a candidate in a SOURCING pipeline. Sourcing hands
// the process to the client after 'submitted', so — unlike full recruitment,
// where clients only *request* moves — here the client performs the move directly.
//
// Runs server-side (Admin SDK) so the browser never writes the pipeline doc: we
// verify the caller owns the org, that the pipeline is sourcing, and that the
// transition is one of the allowed ones (submitted/in-progress → in-progress /
// hired / not-selected). Then we stamp the outcome and notify Nearwork staff.
//
// Called by the client portal (app.nearwork.co) with the client's Firebase token.

import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const ALLOWED_ORIGINS = ['https://app.nearwork.co', 'https://admin.nearwork.co'];

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data: unknown, status: number, origin: string | null) {
  return NextResponse.json(data, { status, headers: cors(origin) });
}
export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

// Client-allowed sourcing transitions (mirrors lib/pipeline-stages.clientCanMove).
const CLIENT_TARGETS = ['in-progress', 'hired', 'not-selected'];
function clientCanMove(from: string, to: string): boolean {
  const fromOk = from === 'submitted' || from === 'in-progress';
  return fromOk && CLIENT_TARGETS.includes(to);
}

async function clientBelongsToOrg(uid: string, email: string, orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const db = adminDb();
  const orgs = new Set<string>();
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists) {
    const u = userSnap.data() as Record<string, unknown>;
    [u.orgId, u.organizationId, u.activeOrgId].forEach((o) => { if (o) orgs.add(String(o)); });
    if (Array.isArray(u.orgIds)) u.orgIds.forEach((o) => { if (o) orgs.add(String(o)); });
  }
  if (orgs.has(orgId)) return true;
  const collect = (snap: FirebaseFirestore.QuerySnapshot) => {
    snap.docs.forEach((d) => {
      const m = d.data() as Record<string, unknown>;
      if (String(m.status ?? 'active').toLowerCase() !== 'active') return;
      if (m.orgId) orgs.add(String(m.orgId));
    });
  };
  collect(await db.collection('orgMembers').where('uid', '==', uid).get());
  if (orgs.has(orgId)) return true;
  if (email) collect(await db.collection('orgMembers').where('email', '==', email).get());
  return orgs.has(orgId);
}

// Notify the pipeline's Nearwork staff (recruiter + account manager) in-app.
async function notifyStaff(pipeline: Record<string, unknown>, title: string, body: string, link: string) {
  const db = adminDb();
  const emails = [pipeline.recruiterEmail, pipeline.accountManagerEmail]
    .map((e) => String(e ?? '').toLowerCase().trim())
    .filter(Boolean);
  const uids = new Set<string>();
  for (const email of emails) {
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!snap.empty) uids.add(snap.docs[0].id);
  }
  await Promise.all(
    [...uids].map((uid) =>
      db.collection('notifications').add({
        userId: uid,
        type: 'status_change',
        title,
        body,
        link,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {}),
    ),
  );
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
  const uid = decoded.uid;
  const email = (decoded.email ?? '').toLowerCase();

  let body: { pipelineCode?: string; candidateId?: string; toStage?: string; comment?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400, origin); }
  const pipelineCode = String(body.pipelineCode ?? '').trim();
  const candidateId = String(body.candidateId ?? '').trim();
  const toStage = String(body.toStage ?? '').trim().toLowerCase();
  const comment = String(body.comment ?? '').trim().slice(0, 2000);
  if (!pipelineCode || !candidateId || !toStage) {
    return json({ ok: false, error: 'pipelineCode, candidateId and toStage are required' }, 400, origin);
  }
  if (!CLIENT_TARGETS.includes(toStage)) {
    return json({ ok: false, error: 'That move is not allowed.' }, 403, origin);
  }

  const db = adminDb();
  const ref = db.collection('pipelines').doc(pipelineCode);
  const snap = await ref.get();
  if (!snap.exists) return json({ ok: false, error: 'Pipeline not found' }, 404, origin);
  const pipeline = snap.data() as Record<string, unknown>;

  if (String(pipeline.pipelineType ?? 'full') !== 'sourcing') {
    return json({ ok: false, error: 'This role is not a sourcing pipeline.' }, 400, origin);
  }
  const allowed = await clientBelongsToOrg(uid, email, String(pipeline.orgId ?? ''));
  if (!allowed) return json({ ok: false, error: 'Not authorised for this pipeline' }, 403, origin);

  const candidates = Array.isArray(pipeline.candidates) ? [...(pipeline.candidates as Record<string, unknown>[])] : [];
  const idx = candidates.findIndex((c) => String(c.candidateId) === candidateId);
  if (idx === -1) return json({ ok: false, error: 'Candidate not in this pipeline' }, 404, origin);

  const from = String(candidates[idx].stage ?? '').toLowerCase();
  if (!clientCanMove(from, toStage)) {
    return json({ ok: false, error: `You can move a candidate from Submitted or In Progress only. (from “${from}”)` }, 409, origin);
  }

  const actor = decoded.name || email || 'The partner';
  const nowStamp = FieldValue.serverTimestamp();
  candidates[idx] = {
    ...candidates[idx],
    stage: toStage,
    clientOutcome: toStage,
    clientOutcomeBy: actor,
    // Hire date drives per-hire billing. Store an ISO stamp on the entry (array
    // elements can't take a serverTimestamp sentinel).
    ...(toStage === 'hired' ? { hiredAt: new Date().toISOString() } : {}),
    ...(toStage === 'not-selected' && comment ? { dropOffNote: comment, clientComment: comment } : {}),
  };

  await ref.set({ candidates, updatedAt: nowStamp }, { merge: true });

  const candName = String(candidates[idx].name ?? 'A candidate');
  const roleTitle = String(pipeline.title ?? pipelineCode);
  const link = `/pipeline?focus=${encodeURIComponent(pipelineCode)}`;
  const labels: Record<string, string> = { 'in-progress': 'In Progress', hired: 'Hired', 'not-selected': 'Not Selected' };
  const verb = toStage === 'hired' ? 'hired' : toStage === 'not-selected' ? 'passed on' : 'started the process with';
  await notifyStaff(
    pipeline,
    `${roleTitle}: ${labels[toStage]} — ${candName}`,
    `${actor} ${verb} ${candName}${comment ? ` — “${comment}”` : ''}.`,
    link,
  );

  return json({ ok: true, toStage, candidateId }, 200, origin);
}
