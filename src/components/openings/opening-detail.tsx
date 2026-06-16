'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from '@/lib/firebase';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { StaffPicker } from '@/components/ui/staff-picker';
import { fmtDate } from '@/lib/utils';
import type { Opening, Organization, WorkMode } from '@/lib/types';
import { WORK_MODE_LABELS } from '@/lib/types';
import {
  Edit3, Briefcase, Trash2, CheckCircle, Clock, AlertCircle,
  ChevronRight, FileText, Globe, ExternalLink, Pause, Play,
} from 'lucide-react';

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
export function OpeningDetail({
  opening,
  orgs,
  currentRole,
  onClose,
  onRefresh,
}: {
  opening: Opening;
  orgs: Organization[];
  currentRole?: string;
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

  // ── Opening core edit state ──
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editForm, setEditForm] = useState({
    title:          opening.title          ?? '',
    description:    opening.description    ?? '',
    sourcer:        opening.sourcer        ?? '',
    recruiter:      opening.recruiter      ?? '',
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
      showToast('Opening paused — removed from jobs.nearwork.co', 'success');
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
      showToast('Opening active again on jobs.nearwork.co', 'success');
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
        hiringManager:  editForm.hiringManager,
        accountManager: editForm.accountManager || null,
        status:         editForm.status,
        priority:       editForm.priority,
        salaryMin:      editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax:      editForm.salaryMax ? Number(editForm.salaryMax) : null,
        hideSalary:     editForm.hideSalary,
        hideLocation:   editForm.hideLocation,
        hideBenefits:   editForm.hideBenefits,
        ...(goneFromJobs && opening.published ? { published: false } : {}),
        updatedAt: serverTimestamp(),
      });
      showToast(
        goneFromJobs && opening.published
          ? 'Opening updated · removed from jobs.nearwork.co'
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
      setConfirmDelete(false);
    }
  }

  const org            = orgs.find((o) => o.id === opening.orgId);
  const approvalStatus = opening.approvalStatus ?? 'draft';
  const isAdmin        = currentRole === 'super_admin' || currentRole === 'admin';

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

  return (
    <div className="space-y-4">

      {/* ── Unified status bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-5 py-3">
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
      <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
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
        className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-white px-5 py-3 cursor-pointer hover:border-[var(--green)]"
        onClick={() => router.push(`/pipeline?focus=${encodeURIComponent(briefCode)}`)}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-700 uppercase tracking-wider text-[var(--light)]">Pipeline</span>
          <span className="text-xs font-600 text-[var(--mid)] font-mono">{briefCode}</span>
          <span className="text-xs text-[var(--light)]">· {opening.title || 'Untitled'}</span>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />
      </div>

      {/* ── Opening details ────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
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
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-500">Delete this opening?</span>
                <button onClick={handleDelete} disabled={deleting} className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60">
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-[var(--mid)] hover:underline">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-500 hover:border-red-400 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />Delete
              </button>
            )}
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
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
              <StaffPicker compact value={editForm.recruiter} onChange={(name) => setEditForm((f) => ({ ...f, recruiter: name }))} placeholder="Search team" />
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
      <div className={`rounded-2xl border bg-white ${briefStatus === 'approved' && !sheetReady && !opening.published ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-[var(--border)]'}`}>

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
  );
}
