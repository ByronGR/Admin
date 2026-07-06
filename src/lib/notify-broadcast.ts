import { adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';
import { enqueueDigestItem } from '@/lib/notification-digest';

// ─── Shared notification helpers ──────────────────────────────────────────────
// The single notification writer (`writeNotification`) plus the follower-broadcast
// fan-out (`broadcastToFollowers`) live here so that BOTH the /api/notify route
// and any server route (assessment upload, kickoff, …) can write notifications
// directly, with identical behavior (pref checks + rolling digest enqueue).

export type BroadcastType =
  | 'new_candidate'
  | 'stage_move'
  | 'assessment_ready'
  | 'candidate_declined'
  | 'staff_note'
  | 'new_hire'
  | 'brief_revised';

// Types that are IN-APP ON by default (the important/actionable ones). Everything
// else (assessmentReady, declined, newHire, weekly, pipelineActivity…) is OFF
// until the user opts in. Email is always opt-in.
export const DEFAULT_ON = new Set<string>([
  'newCandidate', 'stageMove', 'notes', 'requests', 'kickoff',
  'clientRequests', 'clientNotes', 'kickoffDecisions',
]);

// A recipient's preference for a notification type. Missing = the type's default
// (in-app for DEFAULT_ON types, off otherwise); email is always opt-in. "Off" = neither.
export async function prefFor(uid: string, key: string): Promise<{ app: boolean; email: boolean }> {
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
export async function writeNotification(opts: {
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

// ─── broadcastToFollowers ─────────────────────────────────────────────────────
// Resolve every CLIENT user who FOLLOWS an entity (the `follows` collection maps
// uid → entityType/entityId) and write each of them a notification for
// `broadcastType`, honoring their per-type preference. Returns the count written.
export async function broadcastToFollowers(input: {
  broadcastType: BroadcastType;
  entityType: string;
  entityId: string;
  orgId?: string;
  candidateName?: string;
  candidateCode?: string;
  stage?: string;
  noteExcerpt?: string;
  actorName?: string;
}): Promise<number> {
  const db = adminDb();

  const entityType = String(input.entityType ?? '').trim();
  const entityId = String(input.entityId ?? '').trim();
  if (!entityType || !entityId) return 0;

  const broadcastType = input.broadcastType;
  const cName = String(input.candidateName ?? 'A candidate');
  const stage = String(input.stage ?? '').trim();
  const noteExcerpt = String(input.noteExcerpt ?? '');

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
      // Unknown broadcastType — nothing to write.
      return 0;
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
      candidateCode: input.candidateCode,
      pipelineCode: entityId,
      orgId: input.orgId,
      actorName: input.actorName,
    });
    if (res.written) created++;
  }

  return created;
}
