'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  db,
  collection,
  getDocs,
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
  X, Edit3, Briefcase, Trash2, CheckCircle, Clock, AlertCircle,
  ChevronRight, FileText, Globe, ExternalLink,
} from 'lucide-react';

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
    draft: { cls: 'bg-[var(--bg)] text-[var(--light)] border border-[var(--border)]', label: '● Draft' },
    submitted: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: '⏳ Sent to client' },
    changes_requested: { cls: 'bg-amber-50 text-amber-800 border border-amber-200', label: '⚠️ Changes requested' },
    approved: { cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200', label: '✅ Client approved' },
  };
  const s = status == null
    ? { cls: 'bg-[var(--bg)] text-[var(--light)] border border-dashed border-[var(--border2)]', label: 'Not started' }
    : (map[status] ?? map.draft);
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-700 ${s.cls}`}>{s.label}</span>;
}

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
  const [editing, setEditing] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const briefCode = opening.code ?? opening.id;
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

  const [editForm, setEditForm] = useState({
    title: opening.title,
    description: opening.description ?? '',
    sourcer: opening.sourcer ?? '',
    recruiter: opening.recruiter ?? '',
    hiringManager: opening.hiringManager ?? '',
    accountManager: opening.accountManager ?? '',
    status: opening.status,
    priority: opening.priority ?? 'medium',
    salaryMin: String(opening.salaryMin ?? ''),
    salaryMax: String(opening.salaryMax ?? ''),
    location: opening.location ?? '',
  });
  const [saving, setSaving] = useState(false);

  const [sheet, setSheet] = useState({
    publicSummary: opening.publicSummary ?? opening.description ?? '',
    skills: (opening.skills ?? []).join(', '),
    industry: opening.industry ?? '',
    seniority: opening.seniority ?? '',
    workMode: (opening.workMode ?? (opening.remote ? 'remote' : 'onsite')) as WorkMode,
    city: opening.city ?? opening.location ?? '',
    benefits: opening.benefits ?? '',
  });
  const [sheetSaving, setSheetSaving] = useState(false);

  function buildSheetFields() {
    const skills = sheet.skills.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      publicSummary: sheet.publicSummary.trim(),
      skills,
      industry: sheet.industry.trim(),
      seniority: sheet.seniority.trim(),
      workMode: sheet.workMode,
      city: sheet.city.trim(),
      benefits: sheet.benefits.trim(),
      currency: opening.salaryCurrency ?? 'USD',
      wfh: WORK_MODE_LABELS[sheet.workMode],
      exp: sheet.seniority.trim(),
      'sb-exp': sheet.seniority.trim(),
    };
  }

  const sheetReady =
    sheet.publicSummary.trim().length > 0 &&
    sheet.skills.split(',').some((s) => s.trim());

  async function saveSheet() {
    setSheetSaving(true);
    try {
      const fields = buildSheetFields();
      await updateDoc(doc(db, 'openings', opening.id), {
        ...fields,
        updatedAt: serverTimestamp(),
      });
      showToast(
        opening.published ? 'Opening sheet saved & live listing updated' : 'Opening sheet saved',
        'success',
      );
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
        published: true,
        publishedAt: serverTimestamp(),
        approvalStatus: 'published',
        status: 'open',
        code: opening.code ?? opening.id,
        updatedAt: serverTimestamp(),
      });
      showToast('Published to jobs.nearwork.co', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to publish', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  async function unpublish() {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        published: false,
        approvalStatus: 'approved',
        updatedAt: serverTimestamp(),
      });
      showToast('Removed from jobs.nearwork.co', 'success');
      await onRefresh();
    } catch {
      showToast('Failed to unpublish', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const goneFromJobs = ['paused', 'cancelled', 'filled'].includes(editForm.status);
      await updateDoc(doc(db, 'openings', opening.id), {
        title: editForm.title,
        location: editForm.location,
        description: editForm.description,
        sourcer: editForm.sourcer,
        recruiter: editForm.recruiter,
        hiringManager: editForm.hiringManager,
        accountManager: editForm.accountManager || null,
        status: editForm.status,
        priority: editForm.priority,
        salaryMin: editForm.salaryMin ? Number(editForm.salaryMin) : null,
        salaryMax: editForm.salaryMax ? Number(editForm.salaryMax) : null,
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
      await deleteDoc(doc(db, 'openings', opening.id));
      showToast('Opening deleted', 'success');
      onClose();
    } catch {
      showToast('Failed to delete opening', 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function updateApproval(newStatus: string) {
    setApprovalSaving(true);
    try {
      await updateDoc(doc(db, 'openings', opening.id), {
        approvalStatus: newStatus,
        updatedAt: serverTimestamp(),
      });
      showToast(
        newStatus === 'pending_review' ? 'Submitted for review' :
        newStatus === 'approved' ? 'Opening approved' :
        newStatus === 'published' ? 'Opening published' : 'Status updated',
        'success',
      );
      await onRefresh();
    } catch {
      showToast('Failed to update approval status', 'error');
    } finally {
      setApprovalSaving(false);
    }
  }

  const org = orgs.find((o) => o.id === opening.orgId);
  const approvalStatus = opening.approvalStatus ?? 'draft';
  const isAdmin = currentRole === 'super_admin' || currentRole === 'admin';

  const APPROVAL_STEPS = ['draft', 'pending_review', 'approved', 'published'] as const;
  const stepIdx = APPROVAL_STEPS.indexOf(approvalStatus as typeof APPROVAL_STEPS[number]);

  return (
    <div className="space-y-4">
      {/* Stage 1 · Kick-off Brief */}
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
                <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-700 text-[var(--mid)]">STAGE 1</span>
                <h3 className="text-sm font-700 text-[var(--black)]">Kick-off Brief</h3>
                <BriefStatusBadge status={briefStatus} loading={briefLoading} />
              </div>
              <p className="mt-1 max-w-xl text-xs text-[var(--light)]">
                The intake captured on the kick-off call. This is the document sent to the client
                for their approval before sourcing begins.
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

      {/* Stage 2 · Opening & Publishing */}
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] font-700 text-[var(--mid)]">STAGE 2</span>
        <span className="text-xs font-600 text-[var(--mid)]">Opening &amp; Publishing</span>
      </div>

      {/* Approval flow bar */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            {([
              { key: 'draft', label: 'Draft' },
              { key: 'pending_review', label: 'In Review' },
              { key: 'approved', label: 'Approved' },
              { key: 'published', label: 'Published' },
            ] as const).map((step, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={step.key} className="flex items-center gap-1">
                  <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-700 ${
                    done ? 'bg-green-100 text-green-700' :
                    active ? 'bg-[var(--green)] text-white' :
                    'bg-[var(--bg)] text-[var(--light)]'
                  }`}>
                    {done && <CheckCircle className="h-3 w-3" />}
                    {active && step.key === 'pending_review' && <Clock className="h-3 w-3" />}
                    {active && step.key === 'draft' && <AlertCircle className="h-3 w-3" />}
                    {step.label}
                  </div>
                  {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-[var(--light)]" />}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {approvalStatus === 'draft' && (
              <button
                onClick={() => updateApproval('pending_review')}
                disabled={approvalSaving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {approvalSaving ? <Spinner size="sm" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Submit for review
              </button>
            )}
            {approvalStatus === 'pending_review' && isAdmin && (
              <button
                onClick={() => updateApproval('approved')}
                disabled={approvalSaving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {approvalSaving ? <Spinner size="sm" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Approve opening
              </button>
            )}
            {approvalStatus === 'pending_review' && !isAdmin && (
              <span className="text-xs text-[var(--light)]">Awaiting admin approval</span>
            )}
            {approvalStatus === 'approved' && (
              <div className="flex items-center gap-2">
                {!sheetReady && (
                  <span className="text-[10px] text-[var(--light)]">Fill the opening sheet first</span>
                )}
                <button
                  onClick={publishToJobs}
                  disabled={approvalSaving || !sheetReady}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-600 text-white disabled:opacity-50"
                  style={{ background: 'var(--green)' }}
                >
                  {approvalSaving ? <Spinner size="sm" /> : <Globe className="h-3.5 w-3.5" />}
                  Publish to Jobs
                </button>
              </div>
            )}
            {approvalStatus === 'published' && (
              <div className="flex items-center gap-2">
                <a
                  href={`https://jobs.nearwork.co/apply.html?code=${opening.code ?? opening.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-600 text-[var(--green)] hover:border-[var(--green)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on Jobs
                </a>
                <button
                  onClick={unpublish}
                  disabled={approvalSaving}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-500 text-[var(--mid)] hover:border-red-300 hover:text-red-600 disabled:opacity-60"
                >
                  {approvalSaving ? <Spinner size="sm" /> : <X className="h-3.5 w-3.5" />}
                  Unpublish
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Opening core details */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="mb-5 flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-lg"
            style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
          >
            <Briefcase className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-700 text-[var(--black)]">{opening.title}</h2>
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
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-500">Delete this opening?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs font-700 text-red-600 hover:underline disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-[var(--mid)] hover:underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-500 text-red-500 hover:border-red-400 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
        </div>

        {!editing ? (
          <div className="grid gap-4 sm:grid-cols-3 text-xs">
            {[
              { label: 'ID', value: opening.code ?? opening.id },
              { label: 'Location', value: opening.location },
              { label: 'Type', value: opening.type?.replace('_', ' ') },
              { label: 'Priority', value: opening.priority },
              { label: 'Salary', value: opening.salaryMin && opening.salaryMax ? `$${opening.salaryMin}–$${opening.salaryMax}/mo` : '—' },
              { label: 'Sourcer', value: opening.sourcer },
              { label: 'Recruiter', value: opening.recruiter },
              { label: 'Hiring Manager', value: opening.hiringManager },
              { label: 'Account Manager', value: opening.accountManager },
              { label: 'Created', value: fmtDate(opening.createdAt) },
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
              { key: 'title', label: 'Title' },
              { key: 'location', label: 'Location' },
              { key: 'sourcer', label: 'Sourcer' },
              { key: 'hiringManager', label: 'Hiring Manager' },
              { key: 'salaryMin', label: 'Salary min', type: 'number' },
              { key: 'salaryMax', label: 'Salary max', type: 'number' },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">{label}</label>
                <input
                  type={type ?? 'text'}
                  value={(editForm as Record<string, string>)[key]}
                  onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Recruiter</label>
              <StaffPicker
                compact
                value={editForm.recruiter}
                onChange={(name) => setEditForm((f) => ({ ...f, recruiter: name }))}
                placeholder="Search team for recruiter"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Account Manager (optional)</label>
              <StaffPicker
                compact
                value={editForm.accountManager}
                onChange={(name) => setEditForm((f) => ({ ...f, accountManager: name }))}
                placeholder="Search team for account manager"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Status</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Opening['status'] }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none focus:border-[var(--green)]"
              >
                <option value="open">Open</option>
                <option value="paused">Paused</option>
                <option value="filled">Filled</option>
                <option value="cancelled">Cancelled</option>
                <option value="draft">Draft</option>
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
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
                style={{ background: 'var(--green)' }}
              >
                {saving && <Spinner size="sm" />}
                Save
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-500 text-[var(--mid)]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Opening sheet (Stage 2) */}
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="mb-4 flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'var(--green-soft)', color: 'var(--green)' }}
          >
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-700 text-[var(--black)]">Opening sheet</h3>
            <p className="mt-0.5 text-xs text-[var(--light)]">
              The public, candidate-facing listing shown on jobs.nearwork.co. Fill it in, then publish.
            </p>
          </div>
          {opening.published && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-700 text-green-700">
              <Globe className="h-3 w-3" />Live
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Public summary <span className="text-red-500">*</span>
            </label>
            <textarea
              value={sheet.publicSummary}
              onChange={(e) => setSheet((s) => ({ ...s, publicSummary: e.target.value }))}
              rows={4}
              placeholder="What the role is, who it's for, and why it's exciting — written for candidates."
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">
              Skills <span className="text-red-500">*</span> <span className="normal-case font-400">(comma-separated)</span>
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
            <input
              value={sheet.industry}
              onChange={(e) => setSheet((s) => ({ ...s, industry: e.target.value }))}
              placeholder="SaaS / Fintech"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Seniority</label>
            <input
              value={sheet.seniority}
              onChange={(e) => setSheet((s) => ({ ...s, seniority: e.target.value }))}
              placeholder="Mid / Senior / Lead"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Work mode</label>
            <select
              value={sheet.workMode}
              onChange={(e) => setSheet((s) => ({ ...s, workMode: e.target.value as WorkMode }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            >
              {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((m) => (
                <option key={m} value={m}>{WORK_MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">City</label>
            <input
              value={sheet.city}
              onChange={(e) => setSheet((s) => ({ ...s, city: e.target.value }))}
              placeholder="Bogotá"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-600 uppercase tracking-wider text-[var(--light)]">Benefits</label>
            <textarea
              value={sheet.benefits}
              onChange={(e) => setSheet((s) => ({ ...s, benefits: e.target.value }))}
              rows={2}
              placeholder="Health insurance, remote stipend, learning budget…"
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)] focus:bg-white"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={saveSheet}
            disabled={sheetSaving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-600 text-white disabled:opacity-60"
            style={{ background: 'var(--green)' }}
          >
            {sheetSaving ? <Spinner size="sm" /> : <FileText className="h-3.5 w-3.5" />}
            Save sheet
          </button>
          {!sheetReady && (
            <span className="text-[10px] text-[var(--light)]">
              Public summary + at least one skill are required to publish.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
