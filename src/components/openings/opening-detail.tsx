'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  auth,
  db,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  collection,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { OpeningAdminControls } from './opening-admin-controls';
import { SourcingTab } from './sourcing-tab';
import { MatchesTab } from './matches-tab';
import { scoreCandidate } from '@/lib/candidate-match';
import { approveApplicant, rejectApplicant, type ApplicantDoc } from '@/lib/applicant-actions';
import { fmtDate, fmtCurrency, initials } from '@/lib/utils';
import type { Opening, Organization, WorkMode, Pipeline, PipelineCandidate, Candidate } from '@/lib/types';
import { clientCandidateSnapshot } from '@/lib/client-candidate-snapshot';
import { WORK_MODE_LABELS, PIPELINE_STAGE_LABELS } from '@/lib/types';
import {
  Edit3, Briefcase, CheckCircle, Clock, AlertCircle,
  ChevronRight, FileText, Globe, ExternalLink, Pause, Play,
  Users, UserCheck, Calendar, Banknote, Radar, Mail,
} from 'lucide-react';
import { NW, MONO, Icon, Avatar as NWAvatar, Button as NWButton } from '@/components/nw/primitives';
import { HoldToDelete } from '@/components/ui/hold-to-delete';
import { PIPELINE_STAGES } from '@/components/pipeline/pipeline-page';

// ── Brief status badge (used by openings-page list too) ──────────────────────
export function ApprovalBadge({ status }: { status?: string }) {
  if (!status || status === 'draft') return null;
  if (status === 'pending_review') return (
    <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-700 text-amber-700">
      <Clock className="h-2.5 w-2.5" />Review
    </span>
  );
  if (status === 'approved') return (
    <span className="flex items-center gap-0.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-700 text-blue-700">
      <CheckCircle className="h-2.5 w-2.5" />Approved
    </span>
  );
  if (status === 'published') return (
    <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-700 text-green-700">
      <CheckCircle className="h-2.5 w-2.5" />Published
    </span>
  );
  return null;
}

export function BriefStatusBadge({ status, loading }: { status: string | null; loading?: boolean }) {
  if (loading) return <span className="text-[10px] text-[var(--light)]">checking…</span>;
  const map: Record<string, { cls: string; label: string }> = {
    draft:             { cls: 'bg-[var(--bg)] text-[var(--light)] border border-[var(--border)]',           label: '● Draft' },
    submitted:         { cls: 'bg-blue-50 text-blue-600 border border-blue-200',                            label: '⏳ Sent to client' },
    changes_requested: { cls: 'bg-amber-50 text-amber-800 border border-amber-200',                         label: '⚠️ Changes requested' },
    approved:          { cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200',                    label: '✅ Client approved' },
  };
  const s = status == null
    ? { cls: 'bg-[var(--bg)] text-[var(--light)] border border-dashed border-[var(--border2)]', label: 'Not started' }
    : (map[status] ?? map.draft);
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-700 ${s.cls}`}>{s.label}</span>;
}

// ── Unified opening detail ────────────────────────────────────────────────────
// Forward stages only — "Not Selected" is terminal and must never render as
// the last step of a funnel. Colours follow the design tokens.
const FORWARD_STAGES = [
  { key: 'applied', label: 'Applied', color: '#3B82F6' },
  { key: 'background-check', label: 'Background', color: '#EAB308' },
  { key: 'interview', label: 'Interview', color: '#AF7AC5' },
  { key: 'assessment', label: 'Assessment', color: '#AF7AC5' },
  { key: 'partner-review', label: 'Client review', color: '#16A085' },
  { key: 'partner-interview', label: 'Final round', color: '#12866E' },
  { key: 'hired', label: 'Hired', color: '#16A34A' },
];

// ── Row-based pipeline pieces ────────────────────────────────────────────────

/** A candidate row. The stage-coloured left border is the whole point: you can
 *  read the shape of the pipeline down the left edge without reading a word. */
function WorkRow({ accent, name, sub, right, onOpen }: {
  accent: string; name: string; sub?: string; right?: React.ReactNode; onOpen?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
        borderRadius: 12, background: NW.white,
        borderStyle: 'solid',
        borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
        borderTopColor: hover ? NW.gray200 : NW.gray100,
        borderRightColor: hover ? NW.gray200 : NW.gray100,
        borderBottomColor: hover ? NW.gray200 : NW.gray100,
        borderLeftColor: accent,
      }}
    >
      <div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: onOpen ? 'pointer' : 'default' }}>
        <NWAvatar initials={initials(name) || '—'} size={32} bg={accent} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: NW.black, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          {sub && <div style={{ fontSize: 11.5, color: NW.gray500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>{right}</div>
    </div>
  );
}

/** Progress at a glance. Stages already passed sit at reduced opacity so the
 *  current one reads as current rather than as one more filled dot. */
function StageDots({ current }: { current: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {FORWARD_STAGES.map((s, i) => {
        const reached = i <= current;
        const size = i === current ? 9 : 6;
        return (
          <span key={s.key} title={s.label} style={{ width: size, height: size, borderRadius: '50%', background: reached ? s.color : NW.gray200, opacity: reached && i < current ? 0.45 : 1 }} />
        );
      })}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const c = score >= 70 ? { bg: '#ECFDF5', fg: '#047857' }
    : score >= 45 ? { bg: '#FFFBEB', fg: '#B45309' }
    : { bg: '#F1F5F9', fg: '#64748B' };
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      {score}<span style={{ opacity: 0.6, fontWeight: 500 }}>/100</span>
    </span>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px dashed ${NW.gray200}`, borderRadius: 12, padding: 14, fontSize: 12.5, color: NW.gray400 }}>{children}</div>
  );
}

/** Reject needs a reason, so it's a menu rather than a bare button — a rejection
 *  with no recorded reason is a decision nobody can revisit later. */
function RejectMenu({ onPick }: { onPick: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const REASONS = [
    'Not enough experience', 'Wrong discipline', 'English level', 'Salary expectation',
    'Not in LATAM', 'Applied to a better-fit role', 'Incomplete application',
    'No CV attached', 'Duplicate application', 'Other',
  ];
  return (
    <span style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ font: 'inherit', fontSize: 12, fontWeight: 600, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >Reject ▾</button>
      {open && (
        <>
          {/* Click-away layer, so the menu closes without a document listener. */}
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 21, background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.14)', padding: 5, minWidth: 210 }}>
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => { setOpen(false); onPick(r); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', fontSize: 12.5, color: NW.gray700, background: 'transparent', border: 'none', borderRadius: 7, padding: '7px 10px', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = NW.gray50; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >{r}</button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

export function OpeningDetail({
  opening,
  orgs,
  currentRole,
  currentEmail,
  onClose,
  onRefresh,
}: {
  opening: Opening;
  orgs: Organization[];
  currentRole?: string;
  currentEmail?: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const router = useRouter();

  const briefCode = opening.code ?? opening.id;

  // ── Brief status (live from Firestore) ──
  const [briefStatus, setBriefStatus] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setBriefLoading(true);
    getDoc(doc(db, 'kickoffBriefs', briefCode))
      .then((snap) => {
        if (!alive) return;
        setBriefStatus(snap.exists() ? ((snap.data().status as string) ?? 'draft') : null);
      })
      .catch(() => { if (alive) setBriefStatus(null); })
      .finally(() => { if (alive) setBriefLoading(false); });
    return () => { alive = false; };
  }, [briefCode]);

  // ── Redesign tabs (Pipeline & sourcing | Kick-off notes | Jobs listing) ──
  const [tab, setTab] = useState<'pipeline' | 'matches' | 'sourcing' | 'notes' | 'jobs'>('pipeline');
  // Talent-pool multi-select for bulk outreach.

  // Pipeline for this opening (shared code) — candidates by stage.
  const [pipeCandidates, setPipeCandidates] = useState<PipelineCandidate[]>([]);
  useEffect(() => {
    getDoc(doc(db, 'pipelines', briefCode))
      .then((snap) => setPipeCandidates(snap.exists() ? (((snap.data() as Pipeline).candidates) ?? []) : []))
      .catch(() => setPipeCandidates([]));
  }, [briefCode]);

  // Talent pool search + "add back to pipeline" (e.g. a candidate removed by mistake).

  // Pending applicants (applied via Jobs, not yet pulled into the pipeline).
  const [applicantCount, setApplicantCount] = useState(0);
  useEffect(() => {
    getDocs(query(collection(db, 'applications'), where('openingCode', '==', briefCode)))
      .then((snap) => setApplicantCount(snap.docs.filter((d) => {
        const a = d.data() as { status?: string; inPipeline?: boolean };
        return !a.inPipeline && (!a.status || a.status === 'applied' || a.status === 'pending');
      }).length))
      .catch(() => setApplicantCount(0));
  }, [briefCode]);

  // The applicants themselves, not just the count — the Pipeline tab lists them.
  const [applicants, setApplicants] = useState<ApplicantDoc[]>([]);
  const [applicantProfiles, setApplicantProfiles] = useState<Record<string, Candidate>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'applications'), where('openingCode', '==', briefCode));
    const unsub = onSnapshot(q, (snap) => {
      setApplicants(snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ApplicantDoc & { status?: string; inPipeline?: boolean })
        .filter((a) => !a.inPipeline && (!a.status || a.status === 'applied' || a.status === 'pending')));
    }, () => setApplicants([]));
    return () => unsub();
  }, [briefCode]);

  // Profiles for scoring the applicant rows. Best-effort — a row without a
  // profile simply shows no score rather than disappearing.
  useEffect(() => {
    const missing = applicants.map((a) => a.candidateCode || a.candidateId).filter((id) => id && !applicantProfiles[id]);
    if (!missing.length) return;
    Promise.all(missing.map((id) => getDoc(doc(db, 'candidates', id)).catch(() => null))).then((snaps) => {
      const next: Record<string, Candidate> = {};
      snaps.forEach((sn) => { if (sn?.exists()) next[sn.id] = { id: sn.id, ...sn.data() } as Candidate; });
      if (Object.keys(next).length) setApplicantProfiles((prev) => ({ ...prev, ...next }));
    });
  }, [applicants, applicantProfiles]);

  // Best fit first. Anyone without a score yet sorts last rather than to the
  // top — an unscored applicant is unknown, not strong.
  const rankedApplicants = applicants
    .map((a) => {
      const prof = applicantProfiles[a.candidateCode || a.candidateId];
      return { a, m: opening.reqs && prof ? scoreCandidate(prof, opening.reqs) : undefined };
    })
    .sort((x, y) => (y.m?.score ?? -1) - (x.m?.score ?? -1));

  async function approve(a: ApplicantDoc) {
    setApprovingId(a.id);
    try {
      // The pipeline doc id IS the opening code — same convention the manual
      // add above uses.
      await approveApplicant(a, { id: briefCode, code: briefCode, title: opening.title, orgName: opening.orgName });
      showToast(`${a.candidateName || 'Applicant'} approved — added to Applied`, 'success');
      await onRefresh();
    } catch (e) {
      showToast('Approve failed: ' + (e instanceof Error ? e.message : 'Unknown'), 'error');
    } finally {
      setApprovingId(null);
    }
  }

  // Talent pool — candidates not already in this pipeline, matched on the
  // opening's skills when set. Loaded once.

  // Reading the opening's requirements is the one paid step (~1c, once). It also
  // runs automatically the first time X-ray sources for this opening, so most
  // openings never need this button.

  // ── Opening core edit state ──
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editForm, setEditForm] = useState({
    title:          opening.title          ?? '',
    description:    opening.description    ?? '',
    sourcer:        opening.sourcer        ?? '',
    recruiter:      opening.recruiter      ?? '',
    recruiterEmail: opening.recruiterEmail ?? '',
    hiringManager:  opening.hiringManager  ?? '',
    accountManager: opening.accountManager ?? '',
    status:         opening.status,
    priority:       opening.priority       ?? 'medium',
    salaryMin:      String(opening.salaryMin ?? ''),
    salaryMax:      String(opening.salaryMax ?? ''),
    hideSalary:     opening.hideSalary    ?? false,
    hideLocation:   opening.hideLocation  ?? false,
    hideBenefits:   opening.hideBenefits  ?? false,
    location:       opening.location      ?? '',
    notifyCandidatesOnPublish: opening.notifyCandidatesOnPublish ?? false,
  });

  // ── Opening sheet state ──
  const toLines = (v: string[] | string | undefined): string =>
    Array.isArray(v) ? v.join('\n') : (v ?? '');
  const [sheet, setSheet] = useState({
    content_about:           opening.content_about ?? opening.publicSummary ?? opening.description ?? '',
    content_responsibilities: toLines(opening.content_responsibilities ?? opening.responsibilities),
    content_qualifications:  toLines(opening.content_qualifications),
    content_benefits:        toLines(opening.content_benefits),
    niceToHave:              toLines(opening.niceToHave),
    skills:                  (opening.skills ?? []).join(', '),
    industry:                opening.industry  ?? '',
    seniority:               opening.seniority ?? '',
    workMode:                (opening.workMode ?? (opening.remote ? 'remote' : 'onsite')) as WorkMode,
    city:                    opening.city ?? opening.location ?? '',
    contract:                opening.contract ?? '',
    timezone:                opening.timezone ?? opening.tz ?? '',
  });
  const [sheetSaving, setSheetSaving] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);

  // ── Job-match preview (see who would be alerted, without sending) ──
  type PreviewMatch = { name: string; email: string; sharedSkills: string[] };
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMatches, setPreviewMatches] = useState<PreviewMatch[]>([]);
  const [previewCount, setPreviewCount] = useState(0);

  // ── Live "reach" estimate as skills are typed in the sheet ──
  const [reachCount, setReachCount] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  useEffect(() => {
    const skills = sheet.skills.split(',').map((s) => s.trim()).filter(Boolean);
    if (skills.length === 0) {
      setReachCount(null);
      setReachLoading(false);
      return;
    }
    // Only apply the latest request's result (guard against out-of-order responses).
    let cancelled = false;
    setReachLoading(true);
    const t = setTimeout(async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Not signed in');
        const res = await fetch('/api/job-match-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ skills, preview: true }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; count?: number };
        if (cancelled) return;
        if (res.ok && data.ok && typeof data.count === 'number') setReachCount(data.count);
      } catch {
        /* best-effort — never block the form */
      } finally {
        if (!cancelled) setReachLoading(false);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sheet.skills]);

  async function previewJobMatches() {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewMatches([]);
    setPreviewCount(0);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/job-match-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ openingId: opening.id, preview: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        matches?: PreviewMatch[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Preview failed');
      setPreviewMatches(Array.isArray(data.matches) ? data.matches : []);
      setPreviewCount(typeof data.count === 'number' ? data.count : 0);
    } catch (e) {
      setPreviewError((e as Error)?.message || 'Could not load matches');
    } finally {
      setPreviewLoading(false);
    }
  }

  function buildSheetFields() {
    const skills   = sheet.skills.split(',').map((s) => s.trim()).filter(Boolean);
    const toArr    = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);
    const about    = sheet.content_about.trim();
    return {
      publicSummary:           about,
      content_about:           about,
      content_responsibilities: toArr(sheet.content_responsibilities),
      content_qualifications:  toArr(sheet.content_qualifications),
      content_benefits:        toArr(sheet.content_benefits),
      niceToHave:              toArr(sheet.niceToHave),
      skills,
      industry:   sheet.industry.trim(),
      seniority:  sheet.seniority.trim(),
      workMode:   sheet.workMode,
      city:       sheet.city.trim(),
      contract:   sheet.contract.trim(),
      tz:         sheet.timezone.trim(),
      timezone:   sheet.timezone.trim(),
      currency:   opening.salaryCurrency ?? 'USD',
      wfh:        WORK_MODE_LABELS[sheet.workMode],
      exp:        sheet.seniority.trim(),
      'sb-exp':   sheet.seniority.trim(),
    };
  }

  const sheetReady =
    sheet.content_about.trim().length > 0 &&
    sheet.skills.split(',').some((s) => s.trim());

  async function saveSheet() {
    setSheetSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        ...buildSheetFields(),
        updatedAt: serverTimestamp(),
      });
      showToast(opening.published ? 'Sheet saved & live listing updated' : 'Opening sheet saved', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to save opening sheet', 'error');
    } finally {
      setSheetSaving(false);
    }
  }

  async function publishToJobs() {
    if (!sheetReady) {
      showToast('Add a public summary and at least one skill before publishing', 'error');
      return;
    }
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        ...buildSheetFields(),
        published:      true,
        publishedAt:    serverTimestamp(),
        approvalStatus: 'published',
        status:         'open',
        code:           opening.code ?? opening.id,
        updatedAt:      serverTimestamp(),
      });
      showToast('Published to jobs.nearwork.co', 'success');
      // Best-effort: alert available, opted-in candidates whose skills strongly
      // match. Non-blocking — never affects the publish UX.
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          await fetch('/api/job-match-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ openingId: opening.id }),
          });
        }
      } catch { /* best-effort */ }
      await onRefresh();
    } catch {
      showToast('Failed to publish', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  // Pause: take a live listing down from jobs.nearwork.co without resetting
  // the approval/sheet state, so it can be reactivated with one click later.
  async function pauseOpening() {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        published: false,
        status:    'paused',
        updatedAt: serverTimestamp(),
      });
      // Keep the pipeline in sync so its list badge reflects the paused opening.
      updateDoc(doc(db, 'pipelines', opening.code || opening.id), { status: 'paused', updatedAt: serverTimestamp() }).catch(() => {});
      showToast('Opening paused — removed from the job board', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to pause opening', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  // Resume: put a paused opening back live. publishedAt is bumped to now so
  // "active since" reflects the most recent reactivation date.
  async function resumeOpening() {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        published:   true,
        status:      'open',
        publishedAt: serverTimestamp(),
        updatedAt:   serverTimestamp(),
      });
      updateDoc(doc(db, 'pipelines', opening.code || opening.id), { status: 'active', updatedAt: serverTimestamp() }).catch(() => {});
      showToast('Opening active again on the job board', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to activate opening', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const goneFromJobs = ['paused', 'cancelled', 'filled'].includes(editForm.status);
      await updateDoc(doc(db, 'openings', opening.id), {
        title:          editForm.title,
        location:       editForm.location,
        description:    editForm.description,
        sourcer:        editForm.sourcer,
        recruiter:      editForm.recruiter,
        recruiterEmail: editForm.recruiterEmail,
        hiringManager:  editForm.hiringManager,
        accountManager: editForm.accountManager || null,
        status:         editForm.status,
        priority:       editForm.priority,
        salaryMin:      editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax:      editForm.salaryMax ? Number(editForm.salaryMax) : null,
        hideSalary:     editForm.hideSalary,
        hideLocation:   editForm.hideLocation,
        hideBenefits:   editForm.hideBenefits,
        notifyCandidatesOnPublish: editForm.notifyCandidatesOnPublish,
        ...(goneFromJobs && opening.published ? { published: false } : {}),
        updatedAt: serverTimestamp(),
      });
      // Mirror the opening status onto the pipeline so its list badge stays accurate.
      const pipeStatus = editForm.status === 'paused' ? 'paused' : editForm.status === 'cancelled' ? 'cancelled' : 'active';
      updateDoc(doc(db, 'pipelines', opening.code || opening.id), { status: pipeStatus, updatedAt: serverTimestamp() }).catch(() => {});
      showToast(
        goneFromJobs && opening.published
          ? 'Opening updated · removed from the job board'
          : 'Opening updated',
        'success',
      );
      setEditing(false);
      await onRefresh();
    } catch {
      showToast('Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const code = opening.code ?? opening.id;
      await deleteDoc(doc(db, 'openings', opening.id));
      await Promise.allSettled([
        deleteDoc(doc(db, 'pipelines', code)),
        deleteDoc(doc(db, 'kickoffBriefs', code)),
      ]);
      showToast('Opening, pipeline, and kick-off brief deleted', 'success');
      onClose();
    } catch {
      showToast('Failed to delete opening', 'error');
      setDeleting(false);
    }
  }

  const org            = orgs.find((o) => o.id === opening.orgId);
  const approvalStatus = opening.approvalStatus ?? 'draft';
  // Owner break-glass mirrors the Firestore rules: byron/stephany are admins by
  // email even if their stored `role` isn't set to super_admin, so the owners can
  // never be locked out of admin controls. (The actual writes are still enforced
  // server-side by the rules, so this only affects what the UI shows.)
  const OWNER_EMAILS = ['byron.giraldo@nearwork.co', 'stephany.picos@nearwork.co'];
  const isAdmin        = currentRole === 'super_admin' || currentRole === 'admin'
                         || OWNER_EMAILS.includes((currentEmail ?? '').toLowerCase());

  // ── Unified workflow steps ────────────────────────────────────────────────
  // Step 1: Brief   (briefStatus: null→draft→submitted→changes_requested→approved)
  // Step 2: Opening (approvalStatus: draft→approved→published)
  // Step 3: Jobs    (opening.published)
  const briefDone      = briefStatus === 'approved';
  const briefActive    = !briefDone;
  const openingDone    = approvalStatus === 'published';
  const openingActive  = briefDone && !openingDone;
  const jobsDone       = opening.published === true;
  // Published before but currently taken down — eligible for one-click resume.
  const isPaused       = approvalStatus === 'published' && !jobsDone;

  const APPROVAL_STEPS = ['draft', 'pending_review', 'approved', 'published'] as const;
  const stepIdx = APPROVAL_STEPS.indexOf(approvalStatus as typeof APPROVAL_STEPS[number]);

  // ── Redesign header / stat-strip / sourcing derivations ──
  const STAGE_COLOR: Record<string, string> = {
    applied: NW.gray400, 'background-check': NW.blue500, interview: '#6366F1', assessment: NW.violet500,
    'partner-review': NW.yellow500, 'partner-interview': NW.teal500, hired: NW.green600, 'not-selected': NW.gray300,
  };
  const orgName = org?.name ?? opening.orgName ?? '';
  const orgColor = (() => {
    const seed = opening.orgId || orgName || opening.id;
    const palette = [NW.teal500, NW.rose500, NW.violet500, NW.blue500, NW.teal600, '#EAB308', '#EC5290'];
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  })();
  const daysOpen = (() => {
    const start = (opening.publishedAt ?? opening.createdAt) as { seconds?: number } | string | undefined;
    let ms = 0;
    if (start && typeof start === 'object' && 'seconds' in start && start.seconds) ms = start.seconds * 1000;
    else if (typeof start === 'string') ms = Date.parse(start) || 0;
    return ms ? Math.max(0, Math.floor((Date.now() - ms) / 86400000)) : null;
  })();
  const sCur = opening.salaryCurrency || 'USD';
  const sMin = opening.salaryMin && opening.salaryMin > 0 ? opening.salaryMin : null;
  const sMax = opening.salaryMax && opening.salaryMax > 0 ? opening.salaryMax : null;
  const band = opening.hideSalary ? 'Hidden'
    : sMin && sMax ? `${fmtCurrency(sMin, sCur)}–${fmtCurrency(sMax, sCur)}`
    : sMin ? `${fmtCurrency(sMin, sCur)}+`
    : sMax ? `Up to ${fmtCurrency(sMax, sCur)}` : '—';
  // Compact band for the stat card: the sub-line already says "USD · monthly",
  // so repeating the code on both ends only made the value overflow the card.
  const money = (n: number) => `$${n.toLocaleString('en-US')}`;
  const bandCompact = opening.hideSalary ? 'Hidden'
    : sMin && sMax ? `${money(sMin)}–${money(sMax)}`
    : sMin ? `${money(sMin)}+`
    : sMax ? `Up to ${money(sMax)}` : '—';

  const inPipelineCount = pipeCandidates.filter((c) => c.stage !== 'not-selected').length;
  const pipeIds = new Set(pipeCandidates.map((c) => c.candidateId));

  const scoredPipe = pipeCandidates.filter((c) => typeof c.score === 'number');
  const avgScore = scoredPipe.length ? Math.round(scoredPipe.reduce((s, c) => s + (c.score ?? 0), 0) / scoredPipe.length) : null;


  const stageCounts = pipeCandidates.reduce<Record<string, number>>((acc, c) => {
    const k = String(c.stage || 'applied');
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const statCards: {
    label: string; value: string | number; sub: string; accent: string;
    flag?: { text: string; bg: string; fg: string };
  }[] = [
    { label: 'In pipeline', value: inPipelineCount, sub: 'candidates active', accent: '#16A085' },
    {
      label: 'To pre-qualify', value: applicantCount, sub: 'new applicants', accent: '#E74C7C',
      // Only flagged when there is actually something to do.
      ...(applicantCount > 0 ? { flag: { text: 'Action', bg: '#FEF0F5', fg: '#CC3666' } } : {}),
    },
    {
      label: 'Days open', value: daysOpen != null ? `${daysOpen}d` : '—', sub: 'since posted', accent: '#EAB308',
      ...(daysOpen != null && daysOpen > 21 ? { flag: { text: 'Over 21d', bg: '#FEFCE8', fg: '#A16207' } } : {}),
    },
    {
      label: 'Avg. score', value: avgScore ?? '—', accent: '#AF7AC5',
      // An empty score isn't a gap — it's just that nobody has been scored yet.
      sub: avgScore == null ? 'score after pre-qualify' : 'pipeline quality',
    },
    { label: 'Budget', value: bandCompact, sub: bandCompact === '—' ? 'not set' : `${sCur} · monthly`, accent: '#BDBDBD' },
  ];

  // ── Read-only kick-off notes (the approved brief) ──
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter(Boolean).map(String)
      : typeof v === 'string' && v.trim() ? v.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const briefRoleOverview = String(opening.content_about ?? opening.publicSummary ?? opening.description ?? '');
  const briefRequirements = asArr(opening.content_qualifications ?? opening.requirements);
  const briefNiceToHave = asArr(opening.niceToHave);
  const briefSeniority = String(opening.seniority ?? '');
  const ENGAGEMENT: Record<string, string> = { managed_team: 'Managed team', eor: 'EOR & benefits', spp: 'SPP', direct: 'Placement' };
  const contractVal = opening.contract ? String(opening.contract).trim() : '';
  const briefEngagement = contractVal ? (ENGAGEMENT[contractVal] ?? contractVal) : 'Placement';
  const briefApproved = briefStatus === 'approved';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
          <span style={{ width: 56, height: 56, borderRadius: 13, background: orgColor, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22, flexShrink: 0 }}>{initials(orgName) || 'NW'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: NW.black }}>{opening.title || 'Untitled role'}</h1>
              <Badge label={opening.status} variant="status" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 13.5, color: NW.gray600 }}>
              {orgName && <span style={{ fontWeight: 600, color: NW.black }}>{orgName}</span>}
              {opening.location && <><span style={{ color: NW.gray300 }}>·</span><span>{opening.location}</span></>}
              {opening.seniority && <><span style={{ color: NW.gray300 }}>·</span><span>{opening.seniority}</span></>}
              <span style={{ color: NW.gray300 }}>·</span><span style={{ fontFamily: MONO, fontSize: 11.5, color: NW.gray500 }}>{briefCode}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <NWButton variant="secondary" size="md" icon="arrow-left" onClick={onClose}>All openings</NWButton>
          <NWButton variant="primary" size="md" iconRight="arrow-right" onClick={() => router.push(`/pipeline?focus=${encodeURIComponent(briefCode)}`)}>Open pipeline</NWButton>
        </div>
      </div>

      {/* Stat cards. The old strip was five identical grey numbers — nothing
          told you which one needed doing something about. Each card now carries
          its own accent and, where it matters, a flag. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
        {statCards.map((c) => (
          <div key={c.label} style={{ position: 'relative', overflow: 'hidden', background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: '15px 16px 14px' }}>
            {/* Label + flag on one flex row — a flag positioned absolutely
                collides with the label at narrow widths. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: NW.gray400 }}>{c.label}</span>
              {c.flag && (
                <span style={{ flex: 'none', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 7px', background: c.flag.bg, color: c.flag.fg }}>{c.flag.text}</span>
              )}
            </div>
            <div title={String(c.value)} style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 6, color: c.value === '—' ? NW.gray300 : NW.black }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: NW.gray500, marginTop: 2 }}>{c.sub}</div>
            <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: c.accent }} />
          </div>
        ))}
      </div>

      {/* Stage ribbon — where the pipeline actually stands. Forward stages only:
          a terminal rejection must not read as the last step of a funnel. */}
      <div style={{ display: 'flex', background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 14, padding: 6, margin: '12px 0 20px', flexWrap: 'wrap' }}>
        {FORWARD_STAGES.map((st, i) => {
          const n = stageCounts[st.key] || 0;
          return (
            <div key={st.key} style={{ flex: '1 1 120px', padding: '10px 14px', borderLeft: i === 0 ? 'none' : `1px solid ${NW.gray100}`, display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: n ? st.color : NW.gray200, flexShrink: 0 }} />
              <span style={{ fontSize: 17, fontWeight: 700, color: n ? NW.black : NW.gray300 }}>{n}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: n ? NW.gray600 : NW.gray300, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${NW.gray100}`, marginBottom: 18, flexWrap: 'wrap' }}>
        {([
          ['pipeline', 'Pipeline & sourcing', 'kanban-square'],
          ['matches', 'Talent we have', 'users'],
          ['sourcing', 'Sourcing (X-ray)', 'radar'],
          ['notes', 'Kick-off notes', 'clipboard-check'],
          ['jobs', 'Jobs listing', 'megaphone'],
        ] as const).map(([k, label, icon]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: on ? 700 : 500, color: on ? NW.black : NW.gray500, background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? NW.teal500 : 'transparent'}`, padding: '10px 14px', marginBottom: -1, cursor: 'pointer' }}>
              <Icon name={icon} size={15} color={on ? NW.teal600 : NW.gray400} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'matches' && <MatchesTab op={opening} />}

      {tab === 'sourcing' && <SourcingTab op={opening} />}

      {/* minmax(0, …) on the tracks — grid items default to min-width:auto, so a
          long unbroken line (a match reason) blows the column out past the page
          instead of ellipsising inside it. */}
      {tab === 'pipeline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {/* ── Pre-qualify ───────────────────────────────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 2px 10px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: applicants.length ? '#E74C7C' : NW.gray300 }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.black }}>Pre-qualify</span>
              <span style={{ fontSize: 12.5, color: NW.gray500 }}>
                {applicants.length ? `${applicants.length} applied — approve or reject` : 'Nobody waiting'}
              </span>
            </div>
            {applicants.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rankedApplicants.map(({ a, m }) => {
                  return (
                    <WorkRow
                      key={a.id}
                      accent="#E74C7C"
                      name={a.candidateName || a.candidateEmail || 'No name'}
                      sub={m?.reasons[0] || a.candidateEmail || ''}
                      onOpen={() => router.push(`/candidates/${a.candidateCode || a.candidateId}`)}
                      right={
                        <>
                          {m && <ScorePill score={m.score} />}
                          <RejectMenu onPick={(reason) => rejectApplicant(a, reason).then(
                            () => showToast(`${a.candidateName || 'Applicant'} rejected`, 'success'),
                            (e) => showToast('Reject failed: ' + (e instanceof Error ? e.message : ''), 'error'),
                          )} />
                          <button
                            onClick={() => approve(a)}
                            disabled={approvingId === a.id}
                            style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, color: '#fff', background: NW.teal500, border: 'none', borderRadius: 999, padding: '5px 14px', cursor: approvingId === a.id ? 'default' : 'pointer', opacity: approvingId === a.id ? 0.6 : 1, whiteSpace: 'nowrap' }}
                          >{approvingId === a.id ? 'Adding…' : 'Approve'}</button>
                        </>
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyBlock>No new applicants right now.</EmptyBlock>
            )}
          </div>

          {/* ── In pipeline ───────────────────────────────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 2px 10px' }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: NW.black }}>In pipeline</span>
              <span style={{ fontSize: 12.5, color: NW.gray500 }}>{inPipelineCount} candidate{inPipelineCount === 1 ? '' : 's'}</span>
              <button
                onClick={() => router.push(`/pipeline?code=${encodeURIComponent(briefCode)}`)}
                style={{ marginLeft: 'auto', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: NW.teal700, background: 'transparent', border: 'none', cursor: 'pointer' }}
              >Open board →</button>
            </div>
            {inPipelineCount ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pipeCandidates.filter((c) => c.stage !== 'not-selected').map((c) => {
                  const idx = FORWARD_STAGES.findIndex((s) => s.key === String(c.stage));
                  const st = FORWARD_STAGES[idx] || FORWARD_STAGES[0];
                  return (
                    <WorkRow
                      key={c.candidateId}
                      accent={st.color}
                      name={c.name || c.email || 'No name'}
                      sub={c.email || ''}
                      onOpen={() => router.push(`/candidates/${c.candidateId}`)}
                      right={
                        <>
                          <StageDots current={idx < 0 ? 0 : idx} />
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: NW.gray600, minWidth: 84 }}>{st.label}</span>
                          {typeof c.score === 'number' && <ScorePill score={c.score} />}
                          {/* Vetting opens where the work happens — a page someone
                              has to remember to visit stays empty. */}
                          <button
                            onClick={() => router.push(`/vetting/${opening.id}/${c.candidateId}`)}
                            title="Interview questions, notes and the internal record"
                            style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, color: NW.teal700, background: NW.teal50, border: `1px solid ${NW.teal500}33`, borderRadius: 999, padding: '5px 13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >Vetting</button>
                          <button
                            onClick={() => router.push(`/pipeline?code=${encodeURIComponent(briefCode)}`)}
                            style={{ font: 'inherit', fontSize: 12.5, fontWeight: 600, color: NW.gray700, background: NW.white, border: `1px solid ${NW.gray200}`, borderRadius: 999, padding: '5px 13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >Move on →</button>
                        </>
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyBlock>No one in the pipeline yet — approve an applicant to add them.</EmptyBlock>
            )}
          </div>

          {/* ── Meta strip — replaces the Contacts / Details cards ────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, background: NW.offWhite, border: `1px solid ${NW.gray100}`, borderRadius: 12, padding: '11px 15px', fontSize: 12.5, color: NW.gray500 }}>
            <span>Hiring manager <b style={{ color: NW.gray700, fontWeight: 600 }}>{opening.hiringManager || '—'}</b></span>
            <span>Recruiter <b style={{ color: NW.gray700, fontWeight: 600 }}>{opening.recruiter || '—'}</b></span>
            <span>Account <b style={{ color: NW.gray700, fontWeight: 600 }}>{opening.accountManager || '—'}</b></span>
            <span>{[opening.location, opening.seniority].filter(Boolean).join(' · ') || '—'}</span>
            <span>{opening.pipelineType === 'sourcing' ? 'Sourcing only' : 'Full placement'}</span>
          </div>
        </div>
      )}

      {tab === 'notes' && (
      <div className="space-y-4">

      {/* ── Read-only kick-off notes (the approved brief) ─────────────── */}
      <div className="rounded-2xl border p-5" style={{ background: briefApproved ? NW.teal50 : NW.offWhite, borderColor: (briefApproved ? NW.teal500 : NW.gray200) + '40' }}>
        <div className="flex items-center gap-3">
          <span style={{ color: briefApproved ? NW.teal600 : '#A16207' }}>{briefApproved ? <CheckCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: NW.black }}>{briefApproved ? `Brief approved${orgName ? ` by ${orgName}` : ''}` : 'Kick-off brief not yet approved'}</div>
            <div style={{ fontSize: 12.5, color: NW.gray600, marginTop: 2 }}>{briefApproved ? 'This is the requisition the client signed off on. Sourcing works against these notes.' : 'These notes become final once the client approves the kick-off brief.'}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {briefRoleOverview && (
            <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: NW.black, marginBottom: 10 }}>Role overview</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: NW.gray600, margin: 0 }}>{briefRoleOverview}</p>
            </div>
          )}
          <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: NW.black }}>Requirements</div>
            <div style={{ fontSize: 12, color: NW.gray500, marginTop: 1, marginBottom: 14 }}>Must-have qualifications</div>
            {briefRequirements.length ? (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {briefRequirements.map((r, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: NW.gray700 }}>
                    <CheckCircle className="h-4 w-4" style={{ color: NW.teal500, flexShrink: 0, marginTop: 1 }} />{r}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 13, color: NW.gray400 }}>No requirements captured yet — fill them in the kick-off brief.</div>
            )}
          </div>
          {briefNiceToHave.length > 0 && (
            <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: NW.black, marginBottom: 12 }}>Nice to have</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {briefNiceToHave.map((r, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, color: NW.gray600 }}>
                    <span style={{ color: NW.gray300, marginTop: 1 }}>+</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: NW.black, marginBottom: 8 }}>Compensation &amp; engagement</div>
            {[['Budget', <span key="b" style={{ fontFamily: MONO }}>{band}</span>], ['Seniority', briefSeniority || '—'], ['Location', opening.location || '—'], ['Engagement', briefEngagement]].map(([l, v], i, arr) => (
              <div key={String(l)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid ${NW.gray100}` : 'none' }}>
                <span style={{ fontSize: 12.5, color: NW.gray500 }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: NW.black }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ background: NW.white, border: `1px solid ${NW.gray100}`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: NW.black, marginBottom: 8 }}>Owners</div>
            {[['Hiring manager', opening.hiringManager || '—'], ['Account manager', opening.accountManager || '—'], ['Recruiter', opening.recruiter || '—']].map(([l, v], i, arr) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid ${NW.gray100}` : 'none' }}>
                <span style={{ fontSize: 12.5, color: NW.gray500 }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: NW.black }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      </div>
      )}

      {tab === 'jobs' && (
      <div className="space-y-4">

      {/* ── Unified status bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-[#EBEBEB] bg-white px-5 py-3">
        {/* Step 1: Brief */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-700 ${
          briefDone  ? 'bg-emerald-50 text-emerald-700' :
          briefStatus === 'submitted' ? 'bg-blue-50 text-blue-700' :
          briefStatus === 'changes_requested' ? 'bg-amber-50 text-amber-800' :
          'bg-[var(--bg)] text-[var(--mid)]'
        }`}>
          {briefDone ? <CheckCircle className="h-3 w-3" /> :
           briefStatus === 'submitted' ? <Clock className="h-3 w-3" /> :
           briefStatus === 'changes_requested' ? <AlertCircle className="h-3 w-3" /> :
           <span className="h-3 w-3 rounded-full border-2 border-current inline-block" />}
          Kick-off Brief
          {briefLoading ? null :
           briefStatus === null    ? <span className="font-400 opacity-60">· Not started</span> :
           briefStatus === 'draft' ? <span className="font-400 opacity-60">· Draft</span> :
           briefStatus === 'submitted' ? <span className="font-400">· Pending client</span> :
           briefStatus === 'changes_requested' ? <span className="font-400">· Changes requested</span> :
           briefStatus === 'approved' ? <span className="font-400">· Approved ✓</span> : null}
        </div>

        <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />

        {/* Step 2: Opening */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-700 ${
          openingDone   ? 'bg-emerald-50 text-emerald-700' :
          openingActive ? 'bg-[var(--green)] text-white' :
          'bg-[var(--bg)] text-[var(--light)]'
        }`}>
          {openingDone ? <CheckCircle className="h-3 w-3" /> :
           openingActive ? null : <span className="h-3 w-3 rounded-full border-2 border-current inline-block" />}
          Opening
          {approvalStatus === 'draft' && !briefDone    ? <span className="font-400 opacity-60">· Waiting for brief</span> : null}
          {approvalStatus === 'draft' && briefDone     ? <span className="font-400">· Ready to open</span> : null}
          {approvalStatus === 'approved'               ? <span className="font-400">· Approved</span> : null}
          {approvalStatus === 'published'              ? <span className="font-400">· Published ✓</span> : null}
        </div>

        <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />

        {/* Step 3: Jobs */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-700 ${
          jobsDone ? 'bg-emerald-50 text-emerald-700' :
          isPaused ? 'bg-amber-50 text-amber-800' :
          openingDone ? 'bg-[var(--green)] text-white' :
          'bg-[var(--bg)] text-[var(--light)]'
        }`}>
          {jobsDone ? <CheckCircle className="h-3 w-3" /> :
           isPaused ? <Pause className="h-3 w-3" /> :
           <Globe className="h-3 w-3" />}
          Jobs
          {jobsDone ? <span className="font-400">· Active since {fmtDate(opening.publishedAt)}</span> :
           isPaused ? <span className="font-400">· Paused</span> :
           <span className="font-400 opacity-60">· Not published</span>}
        </div>

        {/* Action buttons inline */}
        <div className="ml-auto flex items-center gap-2">
          {(approvalStatus === 'approved' || approvalStatus === 'published') && (
            <button
              onClick={previewJobMatches}
              disabled={previewLoading}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-60"
              title="See which candidates would be alerted — nothing is sent"
            >
              {previewLoading ? <Spinner size="sm" /> : <Radar className="h-3.5 w-3.5" />}
              Preview job-match candidates
            </button>
          )}
          {approvalStatus === 'draft' && briefDone && (
            <button
              onClick={async () => {
                setApprovalSaving(true);
                try {
                  await updateDoc(doc(db, 'openings', opening.id), { approvalStatus: 'approved', updatedAt: serverTimestamp() });
                  showToast('Opening approved', 'success');
                  await onRefresh();
                } catch { showToast('Failed', 'error'); }
                finally { setApprovalSaving(false); }
              }}
              disabled={approvalSaving}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
              style={{ background: 'var(--green)' }}
            >
              {approvalSaving ? <Spinner size="sm" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Approve opening
            </button>
          )}
          {approvalStatus === 'approved' && (
            <button
              onClick={publishToJobs}
              disabled={approvalSaving || !sheetReady}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-50"
              style={{ background: 'var(--green)' }}
              title={!sheetReady ? 'Fill the opening sheet first' : undefined}
            >
              {approvalSaving ? <Spinner size="sm" /> : <Globe className="h-3.5 w-3.5" />}
              Publish to Jobs
            </button>
          )}
          {approvalStatus === 'published' && (
            <div className="flex items-center gap-2">
              {jobsDone && (
                <a
                  href={`https://jobs.nearwork.co/apply.html?code=${opening.code ?? opening.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--green)] hover:border-[var(--green)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />View on Jobs
                </a>
              )}
              {jobsDone ? (
                <button
                  onClick={pauseOpening}
                  disabled={approvalSaving}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-amber-300 hover:text-amber-700 disabled:opacity-60"
                >
                  {approvalSaving ? <Spinner size="sm" /> : <Pause className="h-3.5 w-3.5" />}
                  Pause
                </button>
              ) : (
                <button
                  onClick={resumeOpening}
                  disabled={approvalSaving}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
                  style={{ background: 'var(--green)' }}
                >
                  {approvalSaving ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" />}
                  Activate
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Kick-off Brief ─────────────────────────────────────────────── */}
      <div className="rounded-[16px] border border-[#EBEBEB] bg-white p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
            >
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-700 text-[var(--black)]">Kick-off Brief</h3>
                <BriefStatusBadge status={briefStatus} loading={briefLoading} />
              </div>
              <p className="mt-1 max-w-xl text-xs text-[var(--light)]">
                The intake from the kick-off call. Sent to the client for approval before sourcing begins.
              </p>
            </div>
          </div>
          <button
            onClick={() => router.push(`/kickoff?code=${encodeURIComponent(briefCode)}`)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-600 text-white"
            style={{ background: 'var(--green)' }}
          >
            <FileText className="h-3.5 w-3.5" />
            {briefStatus == null ? 'Start kick-off brief' : 'Open kick-off brief'}
          </button>
        </div>
      </div>

      {/* ── Linked pipeline ────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-4 rounded-[16px] border border-[#EBEBEB] bg-white px-5 py-3 cursor-pointer hover:border-[var(--green)]"
        onClick={() => router.push(`/pipeline?focus=${encodeURIComponent(briefCode)}`)}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Pipeline</span>
          <span className="text-xs font-600 text-[var(--mid)] font-mono">{briefCode}</span>
          <span className="text-xs text-[var(--light)]">· {opening.title || 'Untitled'}</span>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />
      </div>

      {/* ── Admin controls: reassign org + record offline brief approval ── */}
      {isAdmin && (
        <OpeningAdminControls
          opening={opening}
          orgs={orgs}
          briefStatus={briefStatus}
          onChanged={onRefresh}
          showToast={showToast}
        />
      )}

      {/* ── Opening details ────────────────────────────────────────────── */}
      <div className="rounded-[16px] border border-[#EBEBEB] bg-white p-6">
        <div className="mb-5 flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-lg"
            style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
          >
            <Briefcase className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-700 text-[var(--black)]">{opening.title || '—'}</h2>
            <p className="text-xs text-[var(--light)]">
              {org?.name ?? opening.orgName ?? '—'} · {opening.department ?? 'General'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge label={opening.status} variant="status" />
            <button
              onClick={() => setEditing((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-[var(--green)] hover:text-[var(--green)]"
            >
              <Edit3 className="h-3.5 w-3.5" />Edit
            </button>
            <HoldToDelete onConfirm={handleDelete} busy={deleting} size="sm" label="Hold to delete" title="Delete this opening" />
          </div>
        </div>

        {!editing ? (
          <div className="grid gap-4 sm:grid-cols-3 text-xs">
            {[
              { label: 'ID',              value: opening.code ?? opening.id },
              { label: 'Location',        value: opening.location ? (opening.hideLocation ? `🔒 ${opening.location} (hidden from Jobs)` : opening.location) : undefined },
              { label: 'Type',            value: opening.type?.replace('_', ' ') },
              { label: 'Priority',        value: opening.priority },
              { label: 'Salary',          value: opening.salaryMin && opening.salaryMax ? `${opening.hideSalary ? '🔒 ' : ''}$${opening.salaryMin}–$${opening.salaryMax}/mo${opening.hideSalary ? ' (hidden from Jobs)' : ''}` : '—' },
              { label: 'Sourcer',         value: opening.sourcer },
              { label: 'Recruiter',       value: opening.recruiter },
              { label: 'Hiring Manager',  value: opening.hiringManager },
              { label: 'Account Manager', value: opening.accountManager },
              { label: 'Created',         value: fmtDate(opening.createdAt) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</p>
                <p className="mt-0.5 capitalize text-[var(--black)]">{value ?? '—'}</p>
              </div>
            ))}
            {opening.description && (
              <div className="sm:col-span-3">
                <p className="text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Description</p>
                <p className="mt-0.5 text-[var(--mid)]">{opening.description}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'title',    label: 'Title' },
              { key: 'location', label: 'Location' },
              { key: 'sourcer',  label: 'Sourcer' },
              { key: 'hiringManager', label: 'Hiring Manager' },
              { key: 'salaryMin', label: 'Salary min', type: 'number' },
              { key: 'salaryMax', label: 'Salary max', type: 'number' },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</label>
                <input
                  type={type ?? 'text'}
                  value={(editForm as unknown as Record<string, string>)[key]}
                  onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
            ))}
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                id="hideSalary"
                type="checkbox"
                checked={editForm.hideSalary}
                onChange={(e) => setEditForm((f) => ({ ...f, hideSalary: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
              />
              <label htmlFor="hideSalary" className="text-xs text-[var(--mid)]">
                Hide salary on jobs.nearwork.co (listing will show &quot;Salary on request&quot;)
              </label>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                id="hideLocation"
                type="checkbox"
                checked={editForm.hideLocation}
                onChange={(e) => setEditForm((f) => ({ ...f, hideLocation: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
              />
              <label htmlFor="hideLocation" className="text-xs text-[var(--mid)]">
                Hide location on jobs.nearwork.co
              </label>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <input
                id="hideBenefits"
                type="checkbox"
                checked={editForm.hideBenefits}
                onChange={(e) => setEditForm((f) => ({ ...f, hideBenefits: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
              />
              <label htmlFor="hideBenefits" className="text-xs text-[var(--mid)]">
                Hide benefits &amp; perks section on jobs.nearwork.co
              </label>
            </div>
            <div className="sm:col-span-2 flex items-start gap-2">
              <input
                id="notifyCandidatesOnPublish"
                type="checkbox"
                checked={editForm.notifyCandidatesOnPublish}
                onChange={(e) => setEditForm((f) => ({ ...f, notifyCandidatesOnPublish: e.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--green)]"
              />
              <label htmlFor="notifyCandidatesOnPublish" className="text-xs text-[var(--mid)]">
                Notify matching candidates when this role is published
                <span className="mt-0.5 block text-[11px] text-[var(--light)]">
                  Off until the role is ready. When on, publishing emails candidates whose skills strongly match.
                </span>
              </label>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
              <StaffPicker compact value={editForm.recruiter} onChange={(name) => setEditForm((f) => ({ ...f, recruiter: name }))} onPick={(opt) => setEditForm((f) => ({ ...f, recruiterEmail: opt?.email ?? '' }))} placeholder="Search team" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Account Manager (optional)</label>
              <StaffPicker compact value={editForm.accountManager} onChange={(name) => setEditForm((f) => ({ ...f, accountManager: name }))} placeholder="Search team" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Opening['status'] }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                {(['open','paused','filled','cancelled','draft'] as const).map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
                {saving && <Spinner size="sm" />}Save
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── "Next step" callout when brief is approved but sheet not yet filled ── */}
      {briefStatus === 'approved' && !sheetReady && !opening.published && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <span className="text-xl flex-shrink-0">🎉</span>
          <div>
            <p className="text-sm font-700 text-emerald-800">Brief approved — next: fill the Opening Sheet</p>
            <p className="mt-0.5 text-xs text-emerald-700">
              The client approved the kick-off brief. Fill the public summary, skills, and details below,
              then click <strong>Publish to Jobs</strong> to make this role live on jobs.nearwork.co.
            </p>
          </div>
        </div>
      )}

      {/* ── Opening sheet (for jobs.nearwork.co) ───────────────────────── */}
      <div className={`rounded-[16px] border bg-white ${briefStatus === 'approved' && !sheetReady && !opening.published ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-[#EBEBEB]'}`}>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--border)]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-700 text-[var(--black)]">Opening sheet</h3>
              <p className="mt-0.5 text-xs text-[var(--light)]">
                Public listing shown on jobs.nearwork.co — auto-filled from the brief, editable here.
                {!sheetReady && <span className="ml-1 text-amber-600">⚠ Role overview + one skill required to publish.</span>}
              </p>
            </div>
          </div>
          {opening.published && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-700 text-green-700 shrink-0">
              <Globe className="h-3 w-3" />Live
            </span>
          )}
        </div>

        {/* ── Content sections ── */}
        <div className="divide-y divide-[var(--border)]">

          {/* Section 1: Role overview */}
          <div className="px-6 py-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-700 text-white" style={{ background: 'var(--green)' }}>1</span>
              <span className="text-xs font-700 text-[var(--black)] uppercase tracking-wider">Role overview</span>
              <span className="text-[10px] text-red-500 font-600">required</span>
            </div>
            <p className="mb-2 text-[11px] text-[var(--light)]">Candidate-facing summary: what the role is, who it's for, and why it's exciting.</p>
            <textarea
              value={sheet.content_about}
              onChange={(e) => setSheet((s) => ({ ...s, content_about: e.target.value }))}
              rows={5}
              placeholder="e.g. We're looking for a Senior Full-Stack Engineer to join our product team. You'll own end-to-end features from design to deployment in a fast-moving SaaS environment…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>

          {/* Section 2: Responsibilities */}
          <div className="px-6 py-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-700 text-white" style={{ background: 'var(--green)' }}>2</span>
              <span className="text-xs font-700 text-[var(--black)] uppercase tracking-wider">Responsibilities</span>
              <span className="text-[10px] text-[var(--light)]">one per line</span>
            </div>
            <p className="mb-2 text-[11px] text-[var(--light)]">What they'll own day-to-day — shown as a checklist on the job listing.</p>
            <textarea
              value={sheet.content_responsibilities}
              onChange={(e) => setSheet((s) => ({ ...s, content_responsibilities: e.target.value }))}
              rows={5}
              placeholder={"Design and ship new product features end-to-end\nCollaborate with PMs and designers on requirements\nParticipate in code reviews and improve engineering standards"}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white font-mono"
            />
          </div>

          {/* Section 3: What you bring */}
          <div className="px-6 py-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-700 text-white" style={{ background: 'var(--green)' }}>3</span>
              <span className="text-xs font-700 text-[var(--black)] uppercase tracking-wider">What you bring</span>
              <span className="text-[10px] text-[var(--light)]">requirements · one per line</span>
            </div>
            <p className="mb-2 text-[11px] text-[var(--light)]">Must-have skills and experience for the role.</p>
            <textarea
              value={sheet.content_qualifications}
              onChange={(e) => setSheet((s) => ({ ...s, content_qualifications: e.target.value }))}
              rows={4}
              placeholder={"5+ years of experience with React and TypeScript\nStrong understanding of REST APIs and state management\nB2+ English level for daily communication with US teams"}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white font-mono"
            />
            <div className="mt-3">
              <label className="mb-1.5 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Nice to have <span className="normal-case font-400">(one per line)</span></label>
              <textarea
                value={sheet.niceToHave}
                onChange={(e) => setSheet((s) => ({ ...s, niceToHave: e.target.value }))}
                rows={2}
                placeholder={"Experience with GraphQL or tRPC\nFamiliarity with AWS or GCP"}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white font-mono"
              />
            </div>
          </div>

          {/* Section 4: What you get */}
          <div className="px-6 py-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-700 text-white" style={{ background: 'var(--green)' }}>4</span>
              <span className="text-xs font-700 text-[var(--black)] uppercase tracking-wider">What you get</span>
              <span className="text-[10px] text-[var(--light)]">benefits · one per line</span>
            </div>
            <p className="mb-2 text-[11px] text-[var(--light)]">Benefits and perks shown on the job listing.</p>
            <textarea
              value={sheet.content_benefits}
              onChange={(e) => setSheet((s) => ({ ...s, content_benefits: e.target.value }))}
              rows={4}
              placeholder={"Competitive USD salary paid monthly\nHealth insurance for you and your family\n$1,000/year learning budget\n100% remote — work from anywhere in Colombia"}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white font-mono"
            />
          </div>

          {/* Meta fields grid */}
          <div className="px-6 py-5">
            <p className="mb-3 text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Job metadata — shown as chips on the card</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
                  Skills chips <span className="text-red-500">*</span> <span className="normal-case font-400">(comma-separated)</span>
                </label>
                <input
                  value={sheet.skills}
                  onChange={(e) => setSheet((s) => ({ ...s, skills: e.target.value }))}
                  placeholder="React, TypeScript, Node.js, GraphQL"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
                />
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--light)]">
                  {reachLoading ? (
                    <><Spinner size="sm" /> counting…</>
                  ) : reachCount === null ? (
                    <>Add skills to preview reach</>
                  ) : (
                    <><Radar className="h-3 w-3" style={{ color: NW.teal600 }} /> ~{reachCount} candidate{reachCount === 1 ? '' : 's'} match these skills</>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Industry</label>
                <input value={sheet.industry} onChange={(e) => setSheet((s) => ({ ...s, industry: e.target.value }))} placeholder="SaaS / Fintech" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Seniority level</label>
                <input value={sheet.seniority} onChange={(e) => setSheet((s) => ({ ...s, seniority: e.target.value }))} placeholder="Mid / Senior / Lead" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Work mode</label>
                <select value={sheet.workMode} onChange={(e) => setSheet((s) => ({ ...s, workMode: e.target.value as WorkMode }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]">
                  {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((m) => (
                    <option key={m} value={m}>{WORK_MODE_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City / location</label>
                <input value={sheet.city} onChange={(e) => setSheet((s) => ({ ...s, city: e.target.value }))} placeholder="Bogotá / Colombia-wide" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Contract type</label>
                <input value={sheet.contract} onChange={(e) => setSheet((s) => ({ ...s, contract: e.target.value }))} placeholder="Full-time / Contract" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Timezone</label>
                <input value={sheet.timezone} onChange={(e) => setSheet((s) => ({ ...s, timezone: e.target.value }))} placeholder="EST / CST overlap required" className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-[var(--border)]">
          <button onClick={saveSheet} disabled={sheetSaving} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60" style={{ background: 'var(--green)' }}>
            {sheetSaving ? <Spinner size="sm" /> : <Globe className="h-3.5 w-3.5" />}
            Save sheet
          </button>
          {opening.published && (
            <a
              href={`https://jobs.nearwork.co/apply.html?code=${opening.code ?? opening.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-600 text-[var(--green)] hover:border-[var(--green)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />Preview live listing
            </a>
          )}
        </div>
      </div>
    </div>
      )}

      {/* ── Job-match preview modal (who would be alerted; nothing sent) ── */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Job-match preview" size="lg">
        {previewLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--light)]">
            <Spinner size="sm" /> Finding matching candidates…
          </div>
        ) : previewError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {previewError}
          </div>
        ) : previewCount === 0 ? (
          <div className="py-6 text-center">
            <Radar className="mx-auto mb-3 h-6 w-6 text-[var(--light)]" />
            <p className="text-sm font-600 text-[var(--black)]">No candidates match this role&apos;s skills yet.</p>
            <p className="mt-1 text-xs text-[var(--light)]">
              Alerts go to available, opted-in candidates who strongly match the opening&apos;s skills.
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: NW.teal50, color: NW.teal600 }}>
                <Mail className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-700 text-[var(--black)]">
                  {previewCount} candidate{previewCount === 1 ? '' : 's'} would be alerted
                </p>
                <p className="text-xs text-[var(--light)]">
                  Preview only — no emails have been sent.
                  {previewMatches.length < previewCount && ` Showing the first ${previewMatches.length}.`}
                </p>
              </div>
            </div>
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {previewMatches.map((m, i) => (
                <div key={`${m.email}-${i}`} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-600 text-[var(--black)]">{m.name}</div>
                    <div className="truncate text-xs text-[var(--light)]">{m.email}</div>
                    {m.sharedSkills.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.sharedSkills.map((s) => (
                          <span
                            key={s}
                            className="rounded-full px-2 py-0.5 text-[10px] font-600"
                            style={{ background: NW.teal50, color: NW.teal700 }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
