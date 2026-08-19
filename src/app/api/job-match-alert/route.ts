import { NextResponse } from 'next/server';
import { senderFields } from '@/lib/email-sender';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';
import { build } from '../send-email/templates/similar_role_alert';

// POST /api/job-match-alert
// Fired (best-effort) by the Admin openings UI right after a role is published.
// Emails available, opted-in candidates whose skills STRONGLY match the opening,
// scheduled 4 hours out but nudged into Colombia (COT) business hours so the
// alert lands while the candidate is awake and working.
//
// Body:
//   • { openingId: string }                       → real send (gated per-role)
//   • { openingId: string, preview: true }        → preview against that opening
//   • { skills: string[], preview: true }         → preview against raw skills
//                                                    (skips loading an opening;
//                                                    used for the live reach
//                                                    count in the role form)
//
// Idempotent: the opening carries `jobMatchAlertSentAt` once alerted, so a
// re-publish (or a double-fire from the client) won't re-send.
//
// Per-role switch: real sending only happens when the opening's
// `notifyCandidatesOnPublish === true`. When it's false/unset we still compute
// the matches (so the publish flow works) but send nothing and do NOT mark the
// opening as alerted — a future publish once the toggle is on still fires.
// Preview mode ignores both the switch and the dedup flag and never sends or
// mutates anything.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = ['https://admin.nearwork.co'];

// Cap on how many matches the preview response returns (the true count is
// always reported separately).
const PREVIEW_CAP = 50;

// ── Strong-match tuning knobs (easy to adjust) ──
// A candidate is a "strong" match when they share at least MATCH_MIN_SHARED
// skills AND at least MATCH_MIN_RATIO of the opening's skills.
const MATCH_MIN_SHARED = 3;
const MATCH_MIN_RATIO = 0.6;

// Delay before the (business-hours-adjusted) send. Overridable for testing.
const DELAY_HOURS = Number(process.env.JOB_ALERT_DELAY_HOURS || 4);

// Colombia is fixed UTC−5, no DST.
const COT_OFFSET_HOURS = 5;
const BUSINESS_START_HOUR = 9;   // 09:00 COT
const BUSINESS_END_HOUR = 18;    // 18:00 COT (exclusive — 18:00 is already too late)

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// Normalize a skills array to a set of lowercase-trimmed strings.
function normalizeSkills(skills: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(skills)) {
    for (const s of skills) {
      const v = String(s ?? '').trim().toLowerCase();
      if (v) out.add(v);
    }
  }
  return out;
}

type Match = { email: string; firstName: string; name: string; sharedSkills: string[] };

// Find available, opted-in candidates who STRONGLY match the given skills set.
// Same filters (marketingConsent + availability:'open' + valid email) and
// strong-match rule used by both the real send path and the preview paths.
async function matchCandidates(
  db: ReturnType<typeof adminDb>,
  targetSkills: Set<string>,
): Promise<Match[]> {
  const requiredShared = Math.max(MATCH_MIN_SHARED, Math.ceil(MATCH_MIN_RATIO * targetSkills.size));

  // Single-equality query (no composite index needed); filter the rest in memory.
  const candSnap = await db.collection('candidates').where('marketingConsent', '==', true).get();

  const matches: Match[] = [];
  candSnap.docs.forEach((d) => {
    const c = d.data() as Record<string, unknown>;
    if (String(c.availability || '') !== 'open') return;
    const email = String(c.email || '').trim();
    if (!email) return;

    const candSkills = normalizeSkills(c.skills);
    const sharedSkills: string[] = [];
    for (const s of candSkills) if (targetSkills.has(s)) sharedSkills.push(s);
    if (sharedSkills.length < requiredShared) return;

    const firstName =
      String(c.firstName || '').trim() ||
      String(c.name || '').trim().split(/\s+/)[0] ||
      'there';
    const name =
      String(c.name || '').trim() ||
      String(c.firstName || '').trim() ||
      email;
    matches.push({ email, firstName, name, sharedSkills });
  });

  return matches;
}

// Given a base send time, return the next time that falls inside Colombia
// business hours (Mon–Fri, 09:00–17:59 COT). All arithmetic is done in "COT
// wall-clock" by shifting UTC by −5h, adjusting, then shifting back to UTC.
//
// Rules:
//   • Inside a business-day window (Mon–Fri, 09:00–17:59 COT) → keep `base`.
//   • Before 09:00 on a business day → bump to 09:00 COT the same day.
//   • At/after 18:00 COT, or on a weekend → 09:00 COT the next business day.
export function nextBusinessSendTime(base: Date): Date {
  // Shift into COT wall-clock: a UTC Date whose UTC fields now read as COT local.
  const cot = new Date(base.getTime() - COT_OFFSET_HOURS * 3_600_000);

  // Read COT wall-clock fields via the UTC getters on the shifted date.
  let year = cot.getUTCFullYear();
  let month = cot.getUTCMonth();
  let day = cot.getUTCDate();
  let dow = cot.getUTCDay();          // 0 = Sun … 6 = Sat
  const hour = cot.getUTCHours();

  // Advance to 09:00 COT of the next business day.
  const toNextBusinessMorning = () => {
    // Move to the next calendar day, then skip weekends.
    const d = new Date(Date.UTC(year, month, day));
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    year = d.getUTCFullYear();
    month = d.getUTCMonth();
    day = d.getUTCDate();
    dow = d.getUTCDay();
  };

  const isWeekend = dow === 0 || dow === 6;

  let sendHour: number;
  if (isWeekend) {
    // Weekend → next business morning.
    toNextBusinessMorning();
    sendHour = BUSINESS_START_HOUR;
  } else if (hour < BUSINESS_START_HOUR) {
    // Business day but too early → same day at 09:00 COT.
    sendHour = BUSINESS_START_HOUR;
  } else if (hour >= BUSINESS_END_HOUR) {
    // Business day but too late → next business morning.
    toNextBusinessMorning();
    sendHour = BUSINESS_START_HOUR;
  } else {
    // Inside the window → keep base exactly as-is.
    return base;
  }

  // Rebuild the chosen COT wall-clock time (minutes/seconds zeroed at 09:00),
  // then shift back to UTC by adding the +5h offset.
  const cotChosen = Date.UTC(year, month, day, sendHour, 0, 0, 0);
  return new Date(cotChosen + COT_OFFSET_HOURS * 3_600_000);
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'));

  const staff = await requireStaff(req);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Staff only' }, { status: 401, headers: cors });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      openingId?: string;
      preview?: boolean;
      skills?: unknown;
    };
    const openingId = String(body.openingId || '').trim();
    const preview = body.preview === true;

    const db = adminDb();

    // ── Skills-only preview (live reach count in the role form). ──
    // Match directly against the provided skills — no opening is loaded.
    if (preview && Array.isArray(body.skills)) {
      const providedSkills = normalizeSkills(body.skills);
      if (providedSkills.size === 0) {
        return NextResponse.json({ ok: true, preview: true, count: 0, matches: [] }, { headers: cors });
      }
      const matches = await matchCandidates(db, providedSkills);
      return NextResponse.json({
        ok: true,
        preview: true,
        count: matches.length,
        matches: matches.slice(0, PREVIEW_CAP).map((m) => ({
          name: m.name,
          email: m.email,
          sharedSkills: m.sharedSkills,
        })),
      }, { headers: cors });
    }

    if (!openingId) {
      return NextResponse.json({ ok: false, error: 'openingId is required' }, { status: 400, headers: cors });
    }

    const openingSnap = await db.collection('openings').doc(openingId).get();
    if (!openingSnap.exists) {
      return preview
        ? NextResponse.json({ ok: true, preview: true, count: 0, matches: [] }, { headers: cors })
        : NextResponse.json({ ok: true, sent: 0 }, { headers: cors });
    }
    const opening = openingSnap.data() as Record<string, unknown>;
    if (opening.published !== true) {
      return preview
        ? NextResponse.json({ ok: true, preview: true, count: 0, matches: [] }, { headers: cors })
        : NextResponse.json({ ok: true, sent: 0 }, { headers: cors });
    }

    // Dedup: never alert twice for the same opening. Preview ignores this so it
    // still works after a real send has already fired.
    if (!preview && opening.jobMatchAlertSentAt) {
      return NextResponse.json({ ok: true, sent: 0, skipped: 'already alerted' }, { headers: cors });
    }

    const openingSkills = normalizeSkills(opening.skills);
    const title = String(opening.title || 'a new role');
    const code = String(opening.code || openingId);

    // Per-role switch: real sending only when the opening opted in.
    const notifyEnabled = opening.notifyCandidatesOnPublish === true;

    // No skills on the opening → nothing to match against.
    if (openingSkills.size === 0) {
      if (preview) {
        return NextResponse.json({ ok: true, preview: true, count: 0, matches: [] }, { headers: cors });
      }
      // Only mark dedup when the per-role toggle is on.
      if (notifyEnabled) {
        await openingSnap.ref.update({ jobMatchAlertSentAt: FieldValue.serverTimestamp() });
        return NextResponse.json({ ok: true, sent: 0, matched: 0 }, { headers: cors });
      }
      return NextResponse.json({ ok: true, sent: 0, matched: 0, disabled: true }, { headers: cors });
    }

    const matches = await matchCandidates(db, openingSkills);

    // ── Preview mode: report matches, send nothing, mutate nothing. ──
    if (preview) {
      return NextResponse.json({
        ok: true,
        preview: true,
        count: matches.length,
        matches: matches.slice(0, PREVIEW_CAP).map((m) => ({
          name: m.name,
          email: m.email,
          sharedSkills: m.sharedSkills,
        })),
      }, { headers: cors });
    }

    // ── Per-role switch: matching ran, but this role hasn't opted in. ──
    // Do NOT send and do NOT mark dedup, so a future publish (once the toggle
    // is on) still fires for this opening.
    if (!notifyEnabled) {
      return NextResponse.json({ ok: true, sent: 0, matched: matches.length, disabled: true }, { headers: cors });
    }

    const sendAt = nextBusinessSendTime(new Date(Date.now() + DELAY_HOURS * 3_600_000));
    const jobUrl = `https://jobs.nearwork.co/apply.html?code=${code}`;

    const key = process.env.RESEND_API_KEY;
    let sent = 0;
    if (key && matches.length) {
      const sender = senderFields('candidate');
      for (const m of matches) {
        try {
          const { subject, html } = build({ firstName: m.firstName, roleTitle: title, jobUrl });
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ ...sender, to: [m.email], subject, html, scheduled_at: sendAt.toISOString() }),
          });
          if (res.ok) sent++;
          else console.error('[job-match-alert] Resend failed:', await res.json().catch(() => ({})));
        } catch (e) {
          console.error('[job-match-alert] send failed for', m.email, e);
        }
      }
    }
    // If RESEND_API_KEY is missing we skip sending silently (sent stays 0).

    // Mark the opening as alerted so we never double-send.
    await openingSnap.ref.update({ jobMatchAlertSentAt: FieldValue.serverTimestamp() });

    return NextResponse.json({ ok: true, sent, matched: matches.length }, { headers: cors });
  } catch (e) {
    console.error('[job-match-alert] failed:', e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message || 'job-match-alert failed' }, { status: 500, headers: cors });
  }
}
