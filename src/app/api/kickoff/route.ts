import { NextResponse } from 'next/server';
import { adminAuth, adminDb, GCFieldValue as FieldValue } from '@/lib/firebase-admin';

// ─── POST /api/kickoff ────────────────────────────────────────────────────────
// Server-side state machine for the kick-off brief shared between admin.nearwork.co
// (Nearwork staff editor at /kickoff?code=) and app.nearwork.co (client review at
// /pipeline/[code]/kickoff). The brief lives at kickoffBriefs/{code}.
//
// All writes go through here so we can: verify the caller's Firebase ID token,
// enforce who may do what (staff vs. client), strip internal-only fields before a
// client ever sees them, and keep an append-only audit history.
//
// Actions:
//   get             — anyone authorised on the brief. Clients get internalNotes stripped.
//   save            — Nearwork staff only. Upserts draft fields.
//   submit          — Nearwork staff only. draft/changes_requested → submitted.
//   reopen          — Nearwork staff only. submitted/approved → draft.
//   approve         — client (org member) only. submitted → approved.
//   request_changes — client (org member) only. submitted → changes_requested.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── CORS ── App calls this cross-origin from app.nearwork.co. Echo any nearwork.co
// subdomain (or localhost in dev); the request is authorised by a Bearer token, not
// cookies, so this is safe.
function allowOrigin(origin: string | null): string {
  if (!origin) return 'https://app.nearwork.co';
  try {
    const u = new URL(origin);
    const ok =
      u.hostname === 'nearwork.co' ||
      u.hostname.endsWith('.nearwork.co') ||
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1';
    return ok ? origin : 'https://app.nearwork.co';
  } catch {
    return 'https://app.nearwork.co';
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

// ── Field allow-lists ── Only these keys are ever persisted from a save/submit body,
// so a caller can't write arbitrary fields onto the brief document.
const STRING_FIELDS = [
  'jobTitle', 'department', 'locationPolicy', 'employmentType', 'targetStartDate',
  'urgency', 'colombiaViable', 'locationNotes', 'currency', 'payFrequency',
  'signOnBonus', 'variablePay', 'equity', 'benefitsPackage', 'additionalPerks',
  'roleSummary', 'dayToDay', 'success30', 'success60', 'success90',
  'yearsOfExperience', 'educationLevel', 'fieldOfStudy', 'englishLevel',
  'otherLanguages', 'backgroundCheck', 'industryExperience', 'reportsToTitle',
  'reportsToName', 'workingStyle', 'worksCloselyWith', 'workingHours',
  'timezoneRequirements', 'remotePolicyDetails', 'teamCultureNotes',
  'interviewLanguage', 'timeToOffer', 'assessmentRequired', 'assessmentDetails',
  'rejectionCriteria', 'internalSystems', 'trainingProvided', 'trainingDetails',
  'assignedRecruiter', 'accountManager', 'sourcingStartDate', 'candidateDeadline',
  'reportingCadence', 'reportingFormat', 'searchStrategyNotes', 'internalNotes',
  'contractType', 'probationPeriod', 'noticePeriod', 'workAuthRequired',
  'nonCompeteNda', 'equipmentProvidedBy', 'additionalNotes', 'otherDiscussed',
] as const;

const NUMBER_FIELDS = [
  'numberOfPositions', 'salaryMin', 'salaryMax', 'teamSize', 'directReports',
  'totalInterviewStages', 'targetCandidateVolume',
] as const;

const STRING_ARRAY_FIELDS = [
  'keyResponsibilities', 'mustHaveSkills', 'niceToHaveSkills', 'requiredCertifications',
  'requiredTools', 'techStack', 'sourcingChannels',
] as const;

// Internal-only fields removed before a brief is returned to a client.
const CLIENT_HIDDEN_FIELDS = ['internalNotes'];

type Body = Record<string, unknown>;

// Build the persisted subset of a save/submit body, coercing types and dropping
// anything not on the allow-list.
// forSubmit=false → keep empty strings in arrays so in-progress DynamicList items
//   survive the auto-save → onSnapshot roundtrip without being wiped.
// forSubmit=true  → filter empty strings so the submitted brief is clean.
function sanitizeBriefFields(body: Body, forSubmit = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STRING_FIELDS) {
    if (body[k] != null) out[k] = String(body[k]);
  }
  for (const k of NUMBER_FIELDS) {
    if (body[k] != null && body[k] !== '') {
      const n = Number(body[k]);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  for (const k of STRING_ARRAY_FIELDS) {
    if (Array.isArray(body[k])) {
      const items = (body[k] as unknown[]).map((v) => String(v).trim());
      out[k] = forSubmit ? items.filter(Boolean) : items;
    }
  }
  if (Array.isArray(body.interviewStages)) {
    out.interviewStages = (body.interviewStages as Array<Record<string, unknown>>)
      .map((s) => ({
        name: String(s?.name ?? '').trim(),
        format: String(s?.format ?? '').trim(),
        interviewer: String(s?.interviewer ?? '').trim(),
        duration: String(s?.duration ?? '').trim(),
      }))
      .filter((s) => s.name);
  }
  return out;
}

interface HistoryEntry {
  action: string;
  by: string;
  byRole: 'nearwork' | 'client';
  timestamp: string;
  note?: string;
}

function json(data: unknown, status: number, origin: string | null) {
  return NextResponse.json(data, { status, headers: corsHeaders(origin) });
}

// Map a brief's locationPolicy string to { wfh, workMode } for the opening doc.
function mapLocationPolicy(lp: string): { wfh: string; workMode: string } {
  const l = (lp ?? '').toLowerCase();
  if (l.includes('hybrid')) return { wfh: 'Hybrid', workMode: 'hybrid' };
  if (l.includes('on-site') || l.includes('onsite') || l.includes('office') || l.includes('in-office')) return { wfh: 'On-site', workMode: 'onsite' };
  return { wfh: 'Remote', workMode: 'remote' };
}

// Collect every org a client belongs to, then check membership of `orgId`.
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

  const uid = decoded.uid;
  const email = (decoded.email ?? '').toLowerCase();
  const isNearwork = email.endsWith('@nearwork.co');
  const actorName = decoded.name || email || 'Unknown';

  // ── Body ──
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400, origin);
  }

  const action = String(body.action ?? '');
  const code = String(body.code ?? '').trim();
  if (!action) return json({ ok: false, error: 'Missing action' }, 400, origin);
  if (!code) return json({ ok: false, error: 'Missing code' }, 400, origin);

  const db = adminDb();
  const ref = db.collection('kickoffBriefs').doc(code);

  // ── GET ── read-only; clients get internal fields stripped ──
  if (action === 'get') {
    const snap = await ref.get();
    if (!snap.exists) return json({ ok: true, brief: null }, 200, origin);
    const data = { id: snap.id, ...snap.data() } as Record<string, unknown>;

    if (!isNearwork) {
      const orgId = String(data.orgId ?? '');
      const allowed = await clientBelongsToOrg(uid, email, orgId);
      if (!allowed) return json({ ok: false, error: 'Not authorised for this brief' }, 403, origin);
      for (const f of CLIENT_HIDDEN_FIELDS) delete data[f];
    }
    return json({ ok: true, brief: data }, 200, origin);
  }

  // ── Staff write actions ──
  if (action === 'save' || action === 'submit' || action === 'reopen') {
    if (!isNearwork) return json({ ok: false, error: 'Only Nearwork staff can edit this brief' }, 403, origin);

    const snap = await ref.get();
    const existing = (snap.exists ? snap.data() : null) as Record<string, unknown> | null;
    const currentStatus = String(existing?.status ?? 'draft');
    const history: HistoryEntry[] = Array.isArray(existing?.history) ? [...(existing!.history as HistoryEntry[])] : [];
    const now = new Date().toISOString();

    if (action === 'save') {
      if (currentStatus === 'submitted' || currentStatus === 'approved') {
        return json({ ok: false, error: 'Brief is locked while in review. Reopen it to edit.' }, 409, origin);
      }
      const update: Record<string, unknown> = {
        ...sanitizeBriefFields(body),
        openingCode: code,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.orgId != null) update.orgId = String(body.orgId);
      if (!snap.exists) {
        update.status = 'draft';
        update.createdAt = FieldValue.serverTimestamp();
        update.history = [{ action: 'created', by: actorName, byRole: 'nearwork', timestamp: now }];
      }
      await ref.set(update, { merge: true });
      return json({ ok: true }, 200, origin);
    }

    if (action === 'submit') {
      const update: Record<string, unknown> = {
        ...sanitizeBriefFields(body, true),
        openingCode: code,
        status: 'submitted',
        submittedAt: FieldValue.serverTimestamp(),
        nearworkApprovedBy: actorName,
        nearworkUid: uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.orgId != null) update.orgId = String(body.orgId);
      if (!snap.exists) update.createdAt = FieldValue.serverTimestamp();
      history.push({ action: 'submitted', by: actorName, byRole: 'nearwork', timestamp: now });
      update.history = history;
      await ref.set(update, { merge: true });
      // Sync briefStatus (and orgId) to opening + pipeline so the org page can query them
      const briefOrgId = body.orgId ? String(body.orgId) : String(existing?.orgId ?? '');
      const briefOrgName = body.orgName ? String(body.orgName) : String(existing?.orgName ?? '');
      const briefSync: Record<string, unknown> = {
        briefStatus: 'submitted',
        updatedAt: FieldValue.serverTimestamp(),
        ...(briefOrgId ? { orgId: briefOrgId, orgName: briefOrgName } : {}),
      };
      await Promise.allSettled([
        db.collection('openings').doc(code).set(briefSync, { merge: true }),
        db.collection('pipelines').doc(code).set(briefSync, { merge: true }),
      ]);
      // Write client notifications — notify all active org members that the brief needs review
      try {
        const orgId = body.orgId ? String(body.orgId) : '';
        const jobTitle = String(body.jobTitle ?? existing?.jobTitle ?? code);
        if (orgId) {
          const membersSnap = await db.collection('orgMembers').where('orgId', '==', orgId).get();
          const clientUids = membersSnap.docs
            .map((d) => d.data() as Record<string, unknown>)
            .filter((m) => String(m.status ?? 'active').toLowerCase() === 'active')
            .map((m) => String(m.uid ?? ''))
            .filter(Boolean);
          await Promise.allSettled(
            clientUids.map((recipientUid) =>
              db.collection('notifications').add({
                recipientUid,
                title: 'Kick-off brief ready for review',
                message: `The kick-off brief for "${jobTitle}" is ready for your review and approval.`,
                read: false,
                pipelineCode: code,
                type: 'brief_submitted',
                createdAt: FieldValue.serverTimestamp(),
              })
            )
          );
        }
      } catch {
        // Non-critical — notifications can fail silently
      }
      return json({ ok: true }, 200, origin);
    }

    // reopen
    if (!snap.exists) return json({ ok: false, error: 'Brief not found' }, 404, origin);
    history.push({ action: 'reopened', by: actorName, byRole: 'nearwork', timestamp: now });
    await ref.set({ status: 'draft', updatedAt: FieldValue.serverTimestamp(), history }, { merge: true });
    const reopenOrgId = String(existing?.orgId ?? '');
    const reopenOrgName = String(existing?.orgName ?? '');
    const reopenSync: Record<string, unknown> = {
      briefStatus: 'draft',
      updatedAt: FieldValue.serverTimestamp(),
      ...(reopenOrgId ? { orgId: reopenOrgId, orgName: reopenOrgName } : {}),
    };
    await Promise.allSettled([
      db.collection('openings').doc(code).set(reopenSync, { merge: true }),
      db.collection('pipelines').doc(code).set(reopenSync, { merge: true }),
    ]);
    return json({ ok: true }, 200, origin);
  }

  // ── Client decision actions ──
  if (action === 'approve' || action === 'request_changes') {
    const snap = await ref.get();
    if (!snap.exists) return json({ ok: false, error: 'Brief not found' }, 404, origin);
    const existing = snap.data() as Record<string, unknown>;

    // Clients may only act on their own org's brief. Nearwork staff are blocked from
    // the client-side decision so the two-party approval stays honest — except for
    // orgs flagged `internal` (e.g. Nearwork's own lead-tracking org), where staff
    // are the only "client" there is.
    const orgId = String(existing.orgId ?? '');
    if (isNearwork) {
      const orgSnap = orgId ? await db.collection('organizations').doc(orgId).get() : null;
      const isInternalOrg = !!orgSnap?.exists && orgSnap.data()?.internal === true;
      if (!isInternalOrg) return json({ ok: false, error: 'Client approval must come from the client' }, 403, origin);
    } else {
      const allowed = await clientBelongsToOrg(uid, email, orgId);
      if (!allowed) return json({ ok: false, error: 'Not authorised for this brief' }, 403, origin);
    }

    if (String(existing.status ?? 'draft') !== 'submitted') {
      return json({ ok: false, error: 'This brief is not awaiting your review.' }, 409, origin);
    }

    const history: HistoryEntry[] = Array.isArray(existing.history) ? [...(existing.history as HistoryEntry[])] : [];
    const now = new Date().toISOString();

    // Helper: write an admin notification to whoever submitted the brief
    async function notifyNearworkStaff(title: string, bodyText: string) {
      try {
        const nearworkUid = String(existing.nearworkUid ?? '');
        if (!nearworkUid) return;
        await db.collection('notifications').add({
          userId: nearworkUid,
          type: 'status_change',
          title,
          body: bodyText,
          link: `/openings/${code}`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch {
        // Non-critical
      }
    }

    const jobTitle = String(existing.jobTitle ?? code);

    if (action === 'approve') {
      history.push({ action: 'approved', by: actorName, byRole: isNearwork ? 'nearwork' : 'client', timestamp: now });
      await ref.set({
        status: 'approved',
        clientApprovedBy: actorName,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        history,
      }, { merge: true });

      // ── Auto-publish: map brief fields → opening doc and go live immediately ──
      const locMode = mapLocationPolicy(String(existing.locationPolicy ?? ''));
      const mustHaveSkills  = Array.isArray(existing.mustHaveSkills)  ? (existing.mustHaveSkills  as string[]) : [];
      const niceToHaveSkills = Array.isArray(existing.niceToHaveSkills) ? (existing.niceToHaveSkills as string[]) : [];
      const keyResponsibilities = Array.isArray(existing.keyResponsibilities) ? (existing.keyResponsibilities as string[]) : [];
      const techStack = Array.isArray(existing.techStack) ? (existing.techStack as string[]) : [];
      // Merge mustHaveSkills + techStack for skills chips, deduped, max 10
      const allSkills = [...new Set([...mustHaveSkills, ...techStack])].slice(0, 10);
      const salaryMin = Number(existing.salaryMin ?? 0) || null;
      const salaryMax = Number(existing.salaryMax ?? 0) || null;
      const currency  = String(existing.currency ?? existing.salaryCurrency ?? 'USD');
      const seniority = String(existing.yearsOfExperience ?? '');
      const autoPublishPayload: Record<string, unknown> = {
        briefStatus:      'approved',
        status:           'open',
        published:        true,
        publishedAt:      FieldValue.serverTimestamp(),
        approvalStatus:   'published',
        code,
        // Content fields (displayed on jobs.nearwork.co job cards and detail page)
        publicSummary:           String(existing.roleSummary ?? ''),
        content_about:           String(existing.roleSummary ?? ''),
        content_responsibilities: keyResponsibilities,
        content_qualifications:  mustHaveSkills,
        content_benefits:        [],    // admin fills this in the Opening Sheet after approval
        niceToHave:              niceToHaveSkills,
        skills:                  allSkills,
        // Salary
        ...(salaryMin ? { salaryMin } : {}),
        ...(salaryMax ? { salaryMax } : {}),
        currency,
        salaryCurrency:  currency,
        // Work meta
        wfh:             locMode.wfh,
        workMode:        locMode.workMode,
        exp:             seniority,
        'sb-exp':        seniority,
        seniority,
        industry:  String(existing.industryExperience ?? ''),
        contract:  String(existing.contractType       ?? ''),
        tz:        String(existing.timezoneRequirements ?? ''),
        timezone:  String(existing.timezoneRequirements ?? ''),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Always carry orgId/orgName through so the org page can find this opening + pipeline
      const pubOrgId = String(existing.orgId ?? '');
      const pubOrgName = String(existing.orgName ?? '');
      if (pubOrgId) {
        autoPublishPayload.orgId = pubOrgId;
        autoPublishPayload.orgName = pubOrgName;
      }
      await Promise.allSettled([
        db.collection('openings').doc(code).set(autoPublishPayload, { merge: true }),
        db.collection('pipelines').doc(code).set({
          briefStatus: 'approved',
          updatedAt: FieldValue.serverTimestamp(),
          ...(pubOrgId ? { orgId: pubOrgId, orgName: pubOrgName } : {}),
        }, { merge: true }),
      ]);
      await notifyNearworkStaff(
        `Brief approved — ${jobTitle}`,
        `${actorName} approved the kick-off brief. The role is now live on jobs.nearwork.co — you can edit or pause it from the Opening Sheet.`
      );
      return json({ ok: true }, 200, origin);
    }

    // request_changes
    const note = String(body.note ?? '').trim();
    if (!note) return json({ ok: false, error: 'A note describing the requested changes is required' }, 400, origin);
    history.push({ action: 'changes_requested', by: actorName, byRole: isNearwork ? 'nearwork' : 'client', timestamp: now, note });
    await ref.set({
      status: 'changes_requested',
      updatedAt: FieldValue.serverTimestamp(),
      history,
    }, { merge: true });
    const changesSync = { briefStatus: 'changes_requested', updatedAt: FieldValue.serverTimestamp() };
    await Promise.allSettled([
      db.collection('openings').doc(code).set(changesSync, { merge: true }),
      db.collection('pipelines').doc(code).set(changesSync, { merge: true }),
    ]);
    await notifyNearworkStaff(
      `Changes requested — ${jobTitle}`,
      `${actorName} requested changes on the kick-off brief: "${note}"`
    );
    return json({ ok: true }, 200, origin);
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400, origin);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error';
    console.error('[kickoff API]', e);
    return json({ ok: false, error: msg }, 500, origin);
  }
}
