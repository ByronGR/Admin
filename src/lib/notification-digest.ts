// ─── Notification email digest ───────────────────────────────────────────────
// When a notification is written for a recipient who has EMAIL enabled for that
// type, we don't fire an email per event — we BATCH them. Each new item holds
// the send back ~10 minutes (a rolling window), capped at 30 minutes from the
// first item, then ONE summary email lists every pending item.
//
// The mechanism mirrors /api/stage-email: schedule a Resend email with
// `scheduled_at`, and CANCEL the previously scheduled one when a newer item
// arrives, so only the final (fullest) digest actually sends. State lives in the
// Firestore queue collection `notificationDigestQueue`, keyed by recipient uid.
//
// This is best-effort: everything is wrapped so it NEVER throws into the caller
// (the in-app notification write must not be blocked by an email hiccup). If
// RESEND_API_KEY is missing we skip silently, exactly like stage-email does.

import { adminDb } from '@/lib/firebase-admin';
import { NOTIFICATION_DIGEST_HTML } from '@/lib/notification-digest-template';
import { senderFields } from '@/lib/email-sender';

// Rolling window (minutes) added on each new item; env-overridable like
// STAGE_EMAIL_DELAY_MINUTES.
const DELAY_MINUTES = Number(process.env.NOTIF_DIGEST_DELAY_MINUTES || 10);
// Hard cap: never delay a send more than this many minutes past the FIRST item.
const CAP_MINUTES = 30;

export interface DigestItem {
  notifId: string;
  category: string;
  title: string;
  body?: string;
  link?: string;
}

interface QueueDoc {
  email: string;
  firstName?: string;
  isStaff?: boolean;
  items: DigestItem[];
  resendId?: string | null;
  firstAtISO: string;
  scheduledForISO: string;
}

// Accent colour per notification category (Byron's spec). Falls back to teal.
const ACCENT_BY_CATEGORY: Record<string, string> = {
  Pipeline: '#16A085',
  Note: '#AF7AC5',
  Kickoff: '#AF7AC5',
  Team: '#16A085',
  Access: '#16A085',
  Billing: '#E74C7C',
};
const accentFor = (category: string) => ACCENT_BY_CATEGORY[category] || '#16A085';

// HTML-escape a value before it goes into the email markup.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Tiny Handlebars-subset renderer ──────────────────────────────────────────
// Supports exactly what the digest template uses, in this order:
//   1. {{#each items}}…{{/each}}  → repeat the inner block per item, rendering
//      the item's own {{#if}} / {{var}} against that item's scope.
//   2. {{#if key}}…{{/if}}        → keep the block only if key is truthy.
//   3. {{var}}                    → substitute (HTML-escaped).
// Values are escaped; there is no triple-brace / raw output.
function renderIfs(tpl: string, scope: Record<string, string>): string {
  return tpl.replace(/\{\{#if\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, key: string, inner: string) =>
    scope[key] ? inner : '',
  );
}

function renderVars(tpl: string, scope: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    key in scope ? esc(scope[key]) : '',
  );
}

function renderDigest(
  top: Record<string, string>,
  items: Array<Record<string, string>>,
): string {
  // 1) Expand the {{#each items}}…{{/each}} block first.
  let html = NOTIFICATION_DIGEST_HTML.replace(
    /\{\{#each\s+items\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_m, block: string) =>
      items
        .map((item) => renderVars(renderIfs(block, item), item))
        .join(''),
  );
  // 2) Then the top-level {{#if}} (none today) and {{var}} substitutions.
  html = renderVars(renderIfs(html, top), top);
  return html;
}

// Cancel a previously scheduled Resend email. Best-effort — mirrors stage-email.
async function cancelResendEmail(resendId: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !resendId) return;
  try {
    await fetch(`https://api.resend.com/emails/${resendId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    /* best-effort */
  }
}

// Derive a friendly first name: explicit → email local part → "there".
function deriveFirstName(firstName: string | undefined, email: string): string {
  const explicit = (firstName || '').trim();
  if (explicit) return explicit.split(/\s+/)[0];
  const local = (email.split('@')[0] || '').replace(/[._-]+/g, ' ').trim();
  if (local) {
    const w = local.split(/\s+/)[0];
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return 'there';
}

// ── Render + schedule a digest email for a given item list. ──────────────────
// Shared by enqueueDigestItem (append/reschedule) and reconcileDigestOnRead
// (re-render the trimmed list at the SAME send time). Renders the template with
// the full `items` list, POSTs a scheduled Resend email at `scheduledForISO`,
// and returns the new resendId (or null on failure). Assumes RESEND_API_KEY is
// present (callers guard). Best-effort within: a failed POST logs and returns
// null so callers can still persist the trimmed items.
async function scheduleDigestEmail(opts: {
  key: string;
  recipientEmail: string;
  firstName: string;
  isStaff: boolean;
  items: DigestItem[];
  scheduledForISO: string;
}): Promise<string | null> {
  const appUrl = opts.isStaff ? 'https://admin.nearwork.co' : 'https://app.nearwork.co';
  const top = {
    first_name: opts.firstName,
    app_url: appUrl,
    preferences_url: `${appUrl}/settings`,
  };
  const itemScopes = opts.items.map((it) => ({
    item_category: it.category || '',
    item_title: it.title || '',
    item_body: it.body || '',
    item_link: it.link || '',
    item_time: 'Just now',
    item_accent: accentFor(it.category || ''),
  }));
  const html = renderDigest(top, itemScopes);

  const subject =
    opts.items.length === 1
      ? opts.items[0].title
      : `You have ${opts.items.length} Nearwork updates`;

  const sender = senderFields('client');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
    body: JSON.stringify({
      ...sender,
      to: [opts.recipientEmail],
      subject,
      html,
      scheduled_at: opts.scheduledForISO,
    }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return data?.id ?? null;
  }
  const err = await res.json().catch(() => ({}));
  console.error('[notification-digest] Resend schedule failed:', err);
  return null;
}

/**
 * Queue one item into the recipient's rolling notification digest. Called
 * (best-effort) whenever an in-app notification is written for a recipient who
 * has email enabled for that type. Never throws.
 */
export async function enqueueDigestItem(opts: {
  recipientUid: string;
  recipientEmail: string;
  firstName?: string;
  isStaff?: boolean;
  item: DigestItem;
}): Promise<void> {
  try {
    const recipientEmail = (opts.recipientEmail || '').trim();
    if (!opts.recipientUid || !recipientEmail) return;

    // Guard: no key → skip silently (same as stage-email).
    const key = process.env.RESEND_API_KEY;
    if (!key) return;

    const db = adminDb();
    const ref = db.collection('notificationDigestQueue').doc(opts.recipientUid);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as QueueDoc) : null;

    const now = new Date();

    // ── Fresh cycle vs. append ──
    // A fresh cycle starts when there's no queue doc, OR the previous digest's
    // scheduled send is already in the PAST (it has been sent — this new item
    // belongs to a brand-new batch, not the delivered one).
    const prevScheduledMs = existing ? Date.parse(existing.scheduledForISO) : NaN;
    const prevStillPending =
      !!existing && Number.isFinite(prevScheduledMs) && prevScheduledMs > now.getTime();

    const items: DigestItem[] = prevStillPending ? [...(existing!.items || [])] : [];
    items.push(opts.item);

    const firstAtISO = prevStillPending ? existing!.firstAtISO : now.toISOString();

    // ── Compute send time: rolling 10-min window, capped 30 min from first. ──
    const rollingMs = now.getTime() + DELAY_MINUTES * 60_000;
    const capMs = Date.parse(firstAtISO) + CAP_MINUTES * 60_000;
    const sendAt = new Date(Math.min(rollingMs, capMs));
    const scheduledForISO = sendAt.toISOString();

    // ── Cancel the still-pending previous send before scheduling the new one. ──
    if (prevStillPending && existing!.resendId) {
      await cancelResendEmail(existing!.resendId);
    }

    // ── Render + schedule the email with the FULL current item list. ──
    // (A failed schedule returns null; we still persist the accumulated items so
    // the next call keeps the batch — without a resendId there's nothing to
    // cancel next time.)
    const isStaff = opts.isStaff ?? recipientEmail.endsWith('@nearwork.co');
    const firstName = deriveFirstName(
      // Prefer the firstName saved on the pending cycle if the current call
      // didn't supply one, so the batch stays consistent.
      opts.firstName || (prevStillPending ? existing!.firstName : undefined),
      recipientEmail,
    );

    const resendId = await scheduleDigestEmail({
      key,
      recipientEmail,
      firstName,
      isStaff,
      items,
      scheduledForISO,
    });

    // ── Persist the new queue state. ──
    const doc: QueueDoc = {
      email: recipientEmail,
      firstName,
      isStaff,
      items,
      resendId,
      firstAtISO,
      scheduledForISO,
    };
    await ref.set(doc);
  } catch (e) {
    // Best-effort: never throw into the notification writer.
    console.error('[notification-digest] enqueue failed:', e);
  }
}

/**
 * When a notification is marked read IN-APP before its digest email has sent,
 * drop that item from the pending digest — and cancel the email entirely if
 * nothing's left to send. Matched by the notification's Firestore doc id, which
 * we carry through the digest queue on each item.
 *
 * Best-effort: everything is wrapped so it NEVER throws into the caller. A user
 * can only reconcile their OWN queue (keyed by recipientUid).
 */
export async function reconcileDigestOnRead(
  recipientUid: string,
  notifId: string,
): Promise<void> {
  try {
    if (!recipientUid || !notifId) return;

    // Respect the missing-key guard (same as enqueue): nothing was ever
    // scheduled, so there's nothing to reconcile.
    const key = process.env.RESEND_API_KEY;
    if (!key) return;

    const db = adminDb();
    const ref = db.collection('notificationDigestQueue').doc(recipientUid);
    const snap = await ref.get();
    if (!snap.exists) return; // 1) No pending digest.
    const existing = snap.data() as QueueDoc;

    // 2) Already sent (scheduled time is in the past) → nothing to reconcile.
    const scheduledMs = Date.parse(existing.scheduledForISO);
    if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now()) return;

    // 3) Drop the read item. If nothing was removed, it wasn't pending.
    const remaining = (existing.items || []).filter((it) => it.notifId !== notifId);
    if (remaining.length === (existing.items || []).length) return;

    // 4) Cancel the currently-scheduled email (if any).
    if (existing.resendId) {
      await cancelResendEmail(existing.resendId);
    }

    // 6) Nothing left → delete the queue doc so no email goes out.
    if (remaining.length === 0) {
      await ref.delete();
      return;
    }

    // 5) Items remain → re-render + reschedule at the SAME send time (do NOT
    // extend the window), then persist the trimmed list + new resendId.
    const resendId = await scheduleDigestEmail({
      key,
      recipientEmail: existing.email,
      firstName: deriveFirstName(existing.firstName, existing.email),
      isStaff: existing.isStaff ?? existing.email.endsWith('@nearwork.co'),
      items: remaining,
      scheduledForISO: existing.scheduledForISO,
    });

    const doc: QueueDoc = {
      ...existing,
      items: remaining,
      resendId,
    };
    await ref.set(doc);
  } catch (e) {
    // Best-effort: never throw into the caller.
    console.error('[notification-digest] reconcile failed:', e);
  }
}
