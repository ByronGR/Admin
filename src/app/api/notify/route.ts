import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';
import { enqueueDigestItem, reconcileDigestOnRead } from '@/lib/notification-digest';

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
//   broadcast       — Nearwork staff acted on a role (stage move, shared note, …)
//                     → notify every CLIENT user who FOLLOWS that role (the
//                       `follows` collection maps uid → entityType/entityId).

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

type NotifyEvent = 'client_request' | 'client_note' | 'request_resolved' | 'broadcast' | 'notification_read';
type RequestType = 'advance' | 'hire' | 'reject' | 'interview';
type BroadcastType =
  | 'new_candidate'
  | 'stage_move'
  | 'assessment_ready'
  | 'candidate_declined'
  | 'staff_note'
  | 'new_hire'
  | 'brief_revised';

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
  // broadcast fields
  broadcastType?: BroadcastType;
  entityType?: string;   // e.g. 'opening'
  entityId?: string;     // e.g. the opening/pipeline code
  stage?: string;        // client-facing stage label (for stage_move)
  // notification_read fields
  notifId?: string;      // the notifications/{id} doc marked read in-app
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

// Types that are IN-APP ON by default (the important/actionable ones). Everything
// else (assessmentReady, declined, newHire, weekly, pipelineActivity…) is OFF
// until the user opts in. Email is always opt-in.
const DEFAULT_ON = new Set<string>([
  'newCandidate', 'stageMove', 'notes', 'requests', 'kickoff',
  'clientRequests', 'clientNotes', 'kickoffDecisions',
]);

// A recipient's preference for a notification type. Missing = the type's default
// (in-app for DEFAULT_ON types, off otherwise); email is always opt-in. "Off" = neither.
async function prefFor(uid: string, key: string): Promise<{ app: boolean; email: boolean }> {
  const defaultApp = DEFAULT_ON.has(key);
  try {
    const snap = await adminDb().collection('notificationPreferences').doc(uid).get();
    const prefs = (snap.exists ? (snap.data()?.preferences as Record<string, { app?: boolean; email?: boolean }>) : undefined) || {};
    const p = prefs[key];
    if (!p) return { app: defaultApp, email: false };
    return { app: p.app === true, email: p.email === true };
  } catch {
    return { app: defaultApp, email: false };
  }
}

// Write a notification for one recipient, honoring their preference for `prefKey`.
// Returns whether it was written (in-app) and whether email was requested (for the
// digest, wired in the email phase). Keyed so BOTH bells read it.
async function writeNotification(opts: {
  recipientUid: string;
  recipientEmail?: string;
  prefKey: string;
  category: string;
  title: string;
  body: string;
  link?: string;
  candidateCode?: string;
  pipelineCode?: string;
  orgId?: string;
  actorName?: string;
}): Promise<{ written: boolean; email: boolean }> {
  const pref = await prefFor(opts.recipientUid, opts.prefKey);
  if (!pref.app && !pref.email) return { written: false, email: false };
  const db = adminDb();
  const ref = await db.collection('notifications').add({
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
  // pref.email → the recipient wants this by email too. Batch it into the rolling
  // digest (best-effort — must NOT block or fail the in-app write above).
  if (pref.email) {
    const recipientEmail = opts.recipientEmail || '';
    // Look up the recipient's first name if easy; undefined is fine (the digest
    // derives from the email local-part).
    let firstName: string | undefined;
    try {
      const uSnap = await db.collection('users').doc(opts.recipientUid).get();
      if (uSnap.exists) {
        const u = uSnap.data() as Record<string, unknown>;
        const fn = String(u.firstName || u.name || '').trim();
        if (fn) firstName = fn;
      }
    } catch {
      /* non-critical */
    }
    await enqueueDigestItem({
      recipientUid: opts.recipientUid,
      recipientEmail,
      firstName,
      isStaff: recipientEmail.endsWith('@nearwork.co'),
      item: {
        notifId: ref.id,
        category: opts.category,
        title: opts.title,
        body: opts.body,
        link: opts.link,
      },
    });
  }
  return { written: true, email: pref.email };
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

      const prefKey = event === 'client_request' ? 'clientRequests' : 'clientNotes';
      const seen = new Set<string>();
      let created = 0;
      for (const r of recipients) {
        if (seen.has(r.uid)) continue;
        seen.add(r.uid);
        const res = await writeNotification({
          recipientUid: r.uid,
          recipientEmail: r.email,
          prefKey,
          category,
          title,
          body: content,
          candidateCode: body.candidateCode,
          pipelineCode: body.pipelineCode,
          orgId,
          actorName,
        });
        if (res.written) created++;
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

      const res = await writeNotification({
        recipientUid,
        recipientEmail,
        prefKey: 'requests',
        category: 'Pipeline',
        title,
        body: content,
        candidateCode: body.candidateCode,
        pipelineCode: body.pipelineCode,
        orgId,
        actorName,
      });

      return json({ ok: true, created: res.written ? 1 : 0 }, 200, origin);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3) broadcast — Nearwork staff acted on a role → notify its FOLLOWERS.
    // ─────────────────────────────────────────────────────────────────────────
    if (event === 'broadcast') {
      // Security: only Nearwork staff may broadcast to a role's followers.
      if (!actor.email.endsWith('@nearwork.co')) {
        return json({ ok: false, error: 'Only Nearwork staff can broadcast' }, 403, origin);
      }

      const entityType = String(body.entityType ?? '').trim();
      const entityId = String(body.entityId ?? '').trim();
      if (!entityType || !entityId) {
        return json({ ok: false, error: 'entityType and entityId are required' }, 400, origin);
      }

      const broadcastType = body.broadcastType;
      const cName = String(body.candidateName ?? 'A candidate');
      const stage = String(body.stage ?? '').trim();
      const noteExcerpt = String(body.noteExcerpt ?? '');

      // prefKey by broadcastType — one granular client key per event so each can be
      // toggled independently (some default off, per DEFAULT_ON).
      const prefKeyByType: Record<BroadcastType, string> = {
        new_candidate: 'newCandidate',
        stage_move: 'stageMove',
        assessment_ready: 'assessmentReady',
        candidate_declined: 'declined',
        staff_note: 'notes',
        new_hire: 'newHire',
        brief_revised: 'kickoff',
      };

      // Content by broadcastType.
      let title: string;
      let content: string;
      let category: string;
      switch (broadcastType) {
        case 'stage_move':
          title = `${cName} moved to ${stage}`;
          content = '';
          category = 'Pipeline';
          break;
        case 'new_candidate':
          title = 'New candidate for your role';
          content = `${cName} was added to the pipeline.`;
          category = 'Pipeline';
          break;
        case 'assessment_ready':
          title = `Assessment ready — ${cName}`;
          content = '';
          category = 'Pipeline';
          break;
        case 'candidate_declined':
          title = `${cName} wasn't moved forward`;
          content = '';
          category = 'Pipeline';
          break;
        case 'staff_note':
          title = `New note on ${cName}`;
          content = noteExcerpt || '';
          category = 'Note';
          break;
        case 'new_hire':
          title = `${cName} joined the team`;
          content = '';
          category = 'Team';
          break;
        case 'brief_revised':
          title = 'Kickoff brief updated';
          content = "We've made the requested changes.";
          category = 'Kickoff';
          break;
        default:
          return json({ ok: false, error: `Unknown broadcastType: ${String(broadcastType)}` }, 400, origin);
      }
      const prefKey = prefKeyByType[broadcastType];

      // Resolve followers: every uid following this entity (deduped).
      const followSnap = await db
        .collection('follows')
        .where('entityKey', '==', `${entityType}:${entityId}`)
        .get();
      const followerUids = Array.from(
        new Set(
          followSnap.docs
            .map((d) => String(d.data()?.uid ?? '').trim())
            .filter(Boolean),
        ),
      );

      let created = 0;
      for (const uid of followerUids) {
        // Best-effort email lookup ('' if missing).
        let recipientEmail = '';
        try {
          const uSnap = await db.collection('users').doc(uid).get();
          if (uSnap.exists) recipientEmail = String(uSnap.data()?.email ?? '');
        } catch {
          /* non-critical — fall back to '' */
        }
        const res = await writeNotification({
          recipientUid: uid,
          recipientEmail,
          prefKey,
          category,
          title,
          body: content,
          candidateCode: body.candidateCode,
          pipelineCode: entityId,
          orgId,
          actorName,
        });
        if (res.written) created++;
      }

      return json({ ok: true, created }, 200, origin);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4) notification_read — a user marked a notification read IN-APP. If its
    //    digest email hasn't sent yet, drop it from the pending digest (and
    //    cancel the email entirely if nothing's left).
    // ─────────────────────────────────────────────────────────────────────────
    if (event === 'notification_read') {
      const notifId = String(body.notifId ?? '').trim();
      if (!notifId) return json({ ok: false, error: 'notifId is required' }, 400, origin);

      // A user can only reconcile their OWN digest, so the recipientUid IS the
      // authenticated actor. No further authorization needed.
      await reconcileDigestOnRead(actor.uid, notifId);

      return json({ ok: true }, 200, origin);
    }

    return json({ ok: false, error: `Unknown event: ${event}` }, 400, origin);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    console.error('[notify API]', e);
    return json({ ok: false, error: msg }, 500, origin);
  }
}
