import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

// ─── POST /api/notify ─────────────────────────────────────────────────────────
// The ONE notification writer. Both the client App (app.nearwork.co) and Admin
// (admin.nearwork.co) call this after an action; it verifies the caller's
// Firebase ID token, resolves WHO should be notified, and writes notification
// docs via the Admin SDK. In-app only for now (no email).
//
// A notification doc is written with BOTH `userId` (the Admin bell reads this)
// and `recipientUid` (the client portal reads this) set to the same recipient,
// so a single collection serves both surfaces.
//
// Events:
//   client_request  — a client asked to advance/hire/reject/interview a candidate
//                     → notify the org's Nearwork account manager.
//   client_note     — a client left a note on a candidate
//                     → notify the org's Nearwork account manager.
//   request_resolved — staff handled/dismissed a client request
//                     → notify the client who raised it.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── CORS ── Called cross-origin from both app.nearwork.co and admin.nearwork.co.
// Requests are authorised by a Bearer token, not cookies. Mirrors remove-member.
const ALLOWED_ORIGINS = [
  'https://app.nearwork.co',
  'https://admin.nearwork.co',
];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

type NotifyEvent = 'client_request' | 'client_note' | 'request_resolved';
type RequestType = 'advance' | 'hire' | 'reject' | 'interview';

interface Body {
  event?: NotifyEvent;
  orgId?: string;
  pipelineCode?: string;
  candidateCode?: string;
  candidateName?: string;
  requestType?: RequestType;
  toStage?: string;
  reason?: string;
  noteExcerpt?: string;
  requestedByUid?: string;
  resolution?: 'handled' | 'dismissed';
  actorName?: string;
}

function json(data: unknown, status: number, origin: string | null) {
  return NextResponse.json(data, { status, headers: corsHeaders(origin) });
}

// Confirm the actor's user profile lists `orgId` as one of their orgs. Reads
// users/{uid} and checks orgId / organizationId / orgIds[]. Prevents a client
// from spamming an account manager for an org they don't belong to.
async function actorBelongsToOrg(uid: string, orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const db = adminDb();
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  const u = snap.data() as Record<string, unknown>;
  const orgs = new Set<string>();
  [u.orgId, u.organizationId].forEach((o) => { if (o) orgs.add(String(o)); });
  if (Array.isArray(u.orgIds)) u.orgIds.forEach((o) => { if (o) orgs.add(String(o)); });
  return orgs.has(orgId);
}

// A single notification doc, keyed so BOTH surfaces can read it.
async function writeNotification(opts: {
  recipientUid: string;
  recipientEmail?: string;
  category: string;
  title: string;
  body: string;
  link?: string;
  candidateCode?: string;
  pipelineCode?: string;
  orgId?: string;
  actorName?: string;
}): Promise<void> {
  const db = adminDb();
  await db.collection('notifications').add({
    userId: opts.recipientUid,        // Admin bell reads this
    recipientUid: opts.recipientUid,  // client portal reads this
    recipientEmail: opts.recipientEmail || '',
    type: 'status_change',
    category: opts.category,          // "Pipeline" | "Note"
    title: opts.title,
    body: opts.body,
    message: opts.body,               // client portal renders `message`
    link: opts.link || '',
    candidateCode: opts.candidateCode || '',
    pipelineCode: opts.pipelineCode || '',
    orgId: opts.orgId || '',
    actorName: opts.actorName || '',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');

  try {
    // ── Auth ──
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json({ ok: false, error: 'Missing auth token' }, 401, origin);

    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(token);
    } catch {
      return json({ ok: false, error: 'Invalid or expired session' }, 401, origin);
    }

    const actor = { uid: decoded.uid, email: (decoded.email ?? '').toLowerCase() };

    // ── Body ──
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, 400, origin);
    }

    const event = body.event;
    const orgId = String(body.orgId ?? '').trim();
    if (!event) return json({ ok: false, error: 'Missing event' }, 400, origin);

    const db = adminDb();
    const candidateName = String(body.candidateName ?? 'the candidate');
    const actorName = body.actorName ? String(body.actorName) : '';

    // ─────────────────────────────────────────────────────────────────────────
    // 1) client_request / client_note — a client acted → notify the org's AM.
    // ─────────────────────────────────────────────────────────────────────────
    if (event === 'client_request' || event === 'client_note') {
      if (!orgId) return json({ ok: false, error: 'orgId is required' }, 400, origin);

      // Security: real clients must belong to this org (blocks cross-org spam).
      // Nearwork staff (@nearwork.co) can act in any workspace — e.g. when a
      // staffer is working inside a client's portal via the org picker.
      const isStaffActor = actor.email.endsWith('@nearwork.co');
      if (!isStaffActor) {
        const belongs = await actorBelongsToOrg(actor.uid, orgId);
        if (!belongs) return json({ ok: false, error: 'Not authorised for this organization' }, 403, origin);
      }

      // Content.
      let title: string;
      let content: string;
      let category: string;

      if (event === 'client_request') {
        const who = actorName || 'A client';
        const requestType = body.requestType;
        switch (requestType) {
          case 'interview':
            title = `${who} requested an interview — ${candidateName}`;
            break;
          case 'advance':
            title = `${who} asked to advance ${candidateName}`;
            break;
          case 'hire':
            title = `${who} asked to hire ${candidateName}`;
            break;
          case 'reject':
            title = `${who} asked to decline ${candidateName}`;
            break;
          default:
            title = `${who} raised a request — ${candidateName}`;
        }
        const reason = String(body.reason ?? '').trim();
        const toStage = String(body.toStage ?? '').trim();
        content = reason ? `"${reason}"` : (toStage ? `To ${toStage}` : '');
        category = 'Pipeline';
      } else {
        // client_note
        title = `New client note — ${candidateName}`;
        content = String(body.noteExcerpt ?? '');
        category = 'Note';
      }

      // Resolve WHO to notify: the org's account manager (account-level) AND the
      // recruiter on this opening (pipeline-level). Each is stored as an email;
      // we look up the matching staff user's uid. Dedupe so nobody is pinged twice.
      const recipients: { uid: string; email: string }[] = [];

      const orgSnap = await db.collection('organizations').doc(orgId).get();
      const amEmail = String((orgSnap.exists ? orgSnap.data()?.accountManagerEmail : '') ?? '').trim();
      if (amEmail) {
        const amQuery = await db.collection('users').where('email', '==', amEmail).limit(1).get();
        if (!amQuery.empty) recipients.push({ uid: amQuery.docs[0].id, email: amEmail });
      }

      const pipelineCode = String(body.pipelineCode ?? '').trim();
      if (pipelineCode) {
        const openSnap = await db.collection('openings').where('code', '==', pipelineCode).limit(1).get();
        const recEmail = openSnap.empty ? '' : String(openSnap.docs[0].data()?.recruiterEmail ?? '').trim();
        if (recEmail) {
          const recQuery = await db.collection('users').where('email', '==', recEmail).limit(1).get();
          if (!recQuery.empty) recipients.push({ uid: recQuery.docs[0].id, email: recEmail });
        }
      }

      const seen = new Set<string>();
      let created = 0;
      for (const r of recipients) {
        if (seen.has(r.uid)) continue;
        seen.add(r.uid);
        await writeNotification({
          recipientUid: r.uid,
          recipientEmail: r.email,
          category,
          title,
          body: content,
          candidateCode: body.candidateCode,
          pipelineCode: body.pipelineCode,
          orgId,
          actorName,
        });
        created++;
      }

      return json({ ok: true, created }, 200, origin);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2) request_resolved — staff handled/dismissed → notify the client.
    // ─────────────────────────────────────────────────────────────────────────
    if (event === 'request_resolved') {
      // Security: only Nearwork staff may resolve.
      if (!actor.email.endsWith('@nearwork.co')) {
        return json({ ok: false, error: 'Only Nearwork staff can resolve requests' }, 403, origin);
      }

      const recipientUid = String(body.requestedByUid ?? '').trim();
      if (!recipientUid) return json({ ok: false, error: 'requestedByUid is required' }, 400, origin);

      // Recipient email — look it up from users/{uid} if available, else "".
      let recipientEmail = '';
      try {
        const rSnap = await db.collection('users').doc(recipientUid).get();
        if (rSnap.exists) recipientEmail = String(rSnap.data()?.email ?? '');
      } catch {
        // Non-critical — fall back to "".
      }

      const title = `Your request on ${candidateName} was handled`;
      const content = body.resolution === 'dismissed'
        ? 'Marked as not needed for now.'
        : 'The Nearwork team has actioned it.';

      await writeNotification({
        recipientUid,
        recipientEmail,
        category: 'Pipeline',
        title,
        body: content,
        candidateCode: body.candidateCode,
        pipelineCode: body.pipelineCode,
        orgId,
        actorName,
      });

      return json({ ok: true, created: 1 }, 200, origin);
    }

    return json({ ok: false, error: `Unknown event: ${event}` }, 400, origin);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    console.error('[notify API]', e);
    return json({ ok: false, error: msg }, 500, origin);
  }
}
